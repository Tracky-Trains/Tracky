/**
 * Real-time train tracking service
 * Fetches live positions and delays from Transitdocs GTFS-RT feed
 */

import { Alert } from 'react-native';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { gtfsParser } from '../utils/gtfs-parser';
import { extractTrainNumber } from '../utils/train-helpers';
import { logger } from '../utils/logger';
import { fetchWithTimeout } from '../utils/fetch-with-timeout';

// Track last error alert time to avoid spamming user
let lastErrorAlertTime = 0;
const ERROR_ALERT_COOLDOWN = 60000; // Only show alert once per minute
let consecutiveErrors = 0;
const MAX_SILENT_ERRORS = 3; // Show alert after 3 consecutive errors

export interface RealtimePosition {
  trip_id: string;
  latitude: number;
  longitude: number;
  bearing?: number;
  speed?: number;
  timestamp: number;
  vehicle_id?: string;
  train_number?: string; // Extracted train number for matching
}

export interface RealtimeUpdate {
  trip_id: string;
  stop_id?: string;
  arrival_delay?: number; // seconds
  departure_delay?: number; // seconds
  schedule_relationship?: 'SCHEDULED' | 'SKIPPED' | 'NO_DATA';
}

export interface RealtimeAlert {
  trip_id?: string;
  route_id?: string;
  header: string;
  description: string;
  severity?: 'INFO' | 'WARNING' | 'SEVERE';
}

// Transitdocs GTFS-RT endpoint (consolidates vehicle positions and trip updates)
const TRANSITDOCS_GTFS_RT_URL = 'https://asm-backend.transitdocs.com/gtfs/amtrak';

// Cache for real-time data (15 seconds TTL for more frequent updates)
const CACHE_TTL = 15000;
let positionsCache: { data: Map<string, RealtimePosition>; timestamp: number } | null = null;
let updatesCache: { data: Map<string, RealtimeUpdate[]>; timestamp: number } | null = null;

// Shared fetch to avoid fetching + decoding the same protobuf twice
let pendingFetch: Promise<Uint8Array> | null = null;

async function fetchSharedProtobuf(): Promise<Uint8Array> {
  if (!pendingFetch) {
    pendingFetch = fetchProtobuf(TRANSITDOCS_GTFS_RT_URL).finally(() => {
      pendingFetch = null;
    });
  }
  return pendingFetch;
}

/**
 * Show error alert to user (rate-limited)
 */
function showRealtimeErrorAlert(status: number): void {
  consecutiveErrors++;

  // Only show alert if enough consecutive errors and cooldown has passed
  const now = Date.now();
  if (consecutiveErrors >= MAX_SILENT_ERRORS && now - lastErrorAlertTime > ERROR_ALERT_COOLDOWN) {
    lastErrorAlertTime = now;

    let message = 'Unable to fetch live train positions. ';
    if (status === 503) {
      message +=
        'The Transitdocs service is temporarily unavailable. Train positions will update when service is restored.';
    } else if (status === 429) {
      message += 'Too many requests. Please wait a moment.';
    } else {
      message += `Server returned error ${status}. Please try again later.`;
    }

    Alert.alert('Live Data Unavailable', message, [{ text: 'OK', style: 'default' }]);
  }
}

/**
 * Reset error counter on successful fetch
 */
function resetErrorCounter(): void {
  consecutiveErrors = 0;
}

/**
 * Fetch GTFS-RT protobuf data
 */
async function fetchProtobuf(url: string): Promise<Uint8Array> {
  const response = await fetchWithTimeout(url, { timeoutMs: 15000 });
  if (!response.ok) {
    showRealtimeErrorAlert(response.status);
    throw new Error(`GTFS-RT fetch failed: ${response.status}`);
  }
  resetErrorCounter();
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

// extractTrainNumber is now imported from utils/train-helpers

/**
 * Parse GTFS-RT protobuf for vehicle positions.
 * Returns both the positions map and a tripId→trainNumber mapping so that
 * parseTripUpdates can index delays by the correct train number.
 */
function parseVehiclePositions(buffer: Uint8Array): { positions: Map<string, RealtimePosition>; trainNumberMap: Map<string, string> } {
  const positions = new Map<string, RealtimePosition>();
  const trainNumberMap = new Map<string, string>();

  try {
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);

    for (const entity of feed.entity) {
      if (entity.vehicle && entity.vehicle.position && entity.vehicle.trip) {
        const tripId = entity.vehicle.trip.tripId || '';
        const vehicleId = entity.vehicle.vehicle?.id ?? '';
        const vehicleIdMatch = vehicleId.match(/_(\d+)$/);
        const trainNumber = vehicleIdMatch
          ? vehicleIdMatch[1]
          : extractTrainNumber(tripId);

        trainNumberMap.set(tripId, trainNumber);

        positions.set(tripId, {
          trip_id: tripId,
          train_number: trainNumber,
          latitude: entity.vehicle.position.latitude,
          longitude: entity.vehicle.position.longitude,
          bearing: entity.vehicle.position.bearing ?? undefined,
          speed: entity.vehicle.position.speed ?? undefined,
          timestamp: entity.vehicle.timestamp
            ? Number(entity.vehicle.timestamp) * 1000 // Convert to milliseconds
            : Date.now(),
          vehicle_id: entity.vehicle.vehicle?.id ?? undefined,
        });

        // Also index by train number for easier lookup
        if (trainNumber !== tripId) {
          positions.set(trainNumber, positions.get(tripId)!);
        }
      }
    }
  } catch (error) {
    logger.error('Error parsing vehicle positions:', error);
  }

  return { positions, trainNumberMap };
}

/**
 * Parse GTFS-RT protobuf for trip updates
 * Accepts an optional tripId→trainNumber map (from vehicle positions) so that
 * updates for numeric-only GTFS-RT trip IDs can also be indexed by their real
 * train number (e.g. "656" instead of "248766").
 */
function parseTripUpdates(buffer: Uint8Array, trainNumberMap?: Map<string, string>): Map<string, RealtimeUpdate[]> {
  const updates = new Map<string, RealtimeUpdate[]>();

  try {
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);

    for (const entity of feed.entity) {
      if (entity.tripUpdate && entity.tripUpdate.trip) {
        const tripId = entity.tripUpdate.trip.tripId || '';
        const trainNumber = trainNumberMap?.get(tripId) || extractTrainNumber(tripId);
        const stopUpdates: RealtimeUpdate[] = [];

        for (const stopTime of entity.tripUpdate.stopTimeUpdate || []) {
          stopUpdates.push({
            trip_id: tripId,
            stop_id: stopTime.stopId ?? undefined,
            arrival_delay: stopTime.arrival?.delay ?? undefined,
            departure_delay: stopTime.departure?.delay ?? undefined,
            schedule_relationship:
              stopTime.scheduleRelationship === 0
                ? 'SCHEDULED'
                : stopTime.scheduleRelationship === 1
                  ? 'SKIPPED'
                  : 'NO_DATA',
          });
        }

        if (stopUpdates.length > 0) {
          updates.set(tripId, stopUpdates);
          // Also index by train number
          if (trainNumber !== tripId) {
            updates.set(trainNumber, stopUpdates);
          }
        }
      }
    }
  } catch (error) {
    logger.error('Error parsing trip updates:', error);
  }

  return updates;
}

export class RealtimeService {
  /**
   * Get real-time position for a specific trip or train number
   * Supports both trip_id format (e.g., "2026-01-16_AMTK_543") and train number (e.g., "543")
   */
  static async getPositionForTrip(tripIdOrTrainNumber: string): Promise<RealtimePosition | null> {
    try {
      const positions = await this.getAllPositions();

      // Try direct lookup first
      let position = positions.get(tripIdOrTrainNumber);

      // If not found, try extracting/matching train number
      if (!position) {
        const trainNumber = extractTrainNumber(tripIdOrTrainNumber);
        position = positions.get(trainNumber);
      }

      return position || null;
    } catch (error) {
      logger.error('Error fetching real-time position:', error);
      return null;
    }
  }

  /**
   * Get all current train positions from Transitdocs feed
   */
  static async getAllPositions(): Promise<Map<string, RealtimePosition>> {
    try {
      // Check cache
      const now = Date.now();
      if (positionsCache && now - positionsCache.timestamp < CACHE_TTL) {
        return positionsCache.data;
      }

      // Fetch fresh data (shared request avoids double-fetch when updates also need data)
      const buffer = await fetchSharedProtobuf();
      const { positions, trainNumberMap } = parseVehiclePositions(buffer);
      logger.info(`[Realtime] Fetched ${positions.size} vehicle positions`);

      // Also populate updates cache from the same buffer to avoid a second fetch
      if (!updatesCache || now - updatesCache.timestamp >= CACHE_TTL) {
        updatesCache = { data: parseTripUpdates(buffer, trainNumberMap), timestamp: now };
      }

      // Update cache
      positionsCache = { data: positions, timestamp: now };
      return positions;
    } catch (error) {
      logger.error('Error fetching vehicle positions:', error);
      // Return cached data if available, even if stale
      return positionsCache?.data || new Map();
    }
  }

  /**
   * Get trip updates (delays) for a specific trip or train number
   */
  static async getUpdatesForTrip(tripIdOrTrainNumber: string): Promise<RealtimeUpdate[]> {
    try {
      const updates = await this.getAllUpdates();

      // Try direct lookup first
      let tripUpdates = updates.get(tripIdOrTrainNumber);

      // If not found, try extracting/matching train number
      if (!tripUpdates) {
        const trainNumber = extractTrainNumber(tripIdOrTrainNumber);
        tripUpdates = updates.get(trainNumber);
      }

      return tripUpdates || [];
    } catch (error) {
      logger.error('Error fetching trip updates:', error);
      return [];
    }
  }

  /**
   * Get all trip updates from Transitdocs feed
   */
  static async getAllUpdates(): Promise<Map<string, RealtimeUpdate[]>> {
    try {
      // Check cache
      const now = Date.now();
      if (updatesCache && now - updatesCache.timestamp < CACHE_TTL) {
        return updatesCache.data;
      }

      // Fetch fresh data (shared request avoids double-fetch when positions also need data)
      const buffer = await fetchSharedProtobuf();
      const { positions, trainNumberMap } = parseVehiclePositions(buffer);
      const updates = parseTripUpdates(buffer, trainNumberMap);

      // Also populate positions cache from the same buffer to avoid a second fetch
      if (!positionsCache || now - positionsCache.timestamp >= CACHE_TTL) {
        positionsCache = { data: positions, timestamp: now };
      }

      // Update cache
      updatesCache = { data: updates, timestamp: now };
      return updates;
    } catch (error) {
      logger.error('Error fetching trip updates:', error);
      // Return cached data if available, even if stale
      return updatesCache?.data || new Map();
    }
  }

  /**
   * Get delay in minutes for a trip at a specific stop
   */
  static async getDelayForStop(tripIdOrTrainNumber: string, stopId: string): Promise<number | null> {
    try {
      const updates = await this.getUpdatesForTrip(tripIdOrTrainNumber);
      const stopUpdate = updates.find(u => u.stop_id === stopId);

      if (stopUpdate && stopUpdate.departure_delay !== undefined) {
        return Math.round(stopUpdate.departure_delay / 60); // Convert seconds to minutes
      }

      return null;
    } catch (error) {
      logger.error('Error getting delay:', error);
      return null;
    }
  }

  /**
   * Get arrival delay in minutes for a trip at a specific stop.
   * Returns arrival_delay with fallback to departure_delay (last stop has no departure).
   */
  static async getArrivalDelayForStop(tripIdOrTrainNumber: string, stopId: string): Promise<number | null> {
    try {
      const updates = await this.getUpdatesForTrip(tripIdOrTrainNumber);
      const stopUpdate = updates.find(u => u.stop_id === stopId);

      if (stopUpdate) {
        const delaySeconds = stopUpdate.arrival_delay ?? stopUpdate.departure_delay;
        if (delaySeconds !== undefined) {
          return Math.round(delaySeconds / 60);
        }
      }

      return null;
    } catch (error) {
      logger.error('Error getting arrival delay:', error);
      return null;
    }
  }

  /**
   * Get delays for all stops of a trip.
   * Returns Map<stopId, { departureDelay?, arrivalDelay? }> in minutes.
   */
  static async getDelaysForAllStops(
    tripIdOrTrainNumber: string
  ): Promise<Map<string, { departureDelay?: number; arrivalDelay?: number }>> {
    const result = new Map<string, { departureDelay?: number; arrivalDelay?: number }>();
    try {
      const updates = await this.getUpdatesForTrip(tripIdOrTrainNumber);
      for (const u of updates) {
        if (u.stop_id) {
          result.set(u.stop_id, {
            departureDelay: u.departure_delay != null ? Math.round(u.departure_delay / 60) : undefined,
            arrivalDelay: u.arrival_delay != null ? Math.round(u.arrival_delay / 60) : undefined,
          });
        }
      }
    } catch (error) {
      logger.error('Error getting delays for all stops:', error);
    }
    return result;
  }

  /**
   * Format delay for display
   */
  static formatDelay(delayMinutes: number | null): string {
    if (delayMinutes === null || delayMinutes === 0) {
      return 'On Time';
    }
    if (delayMinutes > 0) {
      return `Delayed ${delayMinutes}m`;
    }
    return `${Math.abs(delayMinutes)}m early`;
  }

  /**
   * Clear caches (useful for manual refresh)
   */
  static clearCache(): void {
    positionsCache = null;
    updatesCache = null;
  }

  /**
   * Get all active trains with their current positions
   * Returns an array of {trainNumber, position} for easy consumption
   */
  static async getAllActiveTrains(): Promise<Array<{ trainNumber: string; position: RealtimePosition }>> {
    const positions = await this.getAllPositions();
    const trains: Array<{ trainNumber: string; position: RealtimePosition }> = [];
    const seen = new Set<string>();

    for (const [key, position] of positions.entries()) {
      const trainNumber = position.train_number || extractTrainNumber(key);
      if (!seen.has(trainNumber)) {
        trains.push({ trainNumber, position });
        seen.add(trainNumber);
      }
    }

    return trains;
  }
}
