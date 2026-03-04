/**
 * Storage service for persisting train data
 * Stores lightweight train references (tripId + optional segment info)
 * Full train data is reconstructed from GTFS on load
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CompletedTrip, SavedTrainRef, Train } from '../types/train';
import { TrainAPIService } from './api';

// Simple mutex to serialize read-modify-write operations per storage key,
// preventing concurrent callers from overwriting each other's changes.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    // Clean up if we're still the latest in the chain
    if (locks.get(key) === next) locks.delete(key);
  }
}

const STORAGE_KEYS = {
  SAVED_TRAINS: 'savedTrainRefs',
  TRIP_HISTORY: 'tripHistory',
  USER_PREFERENCES: 'userPreferences',
  CALENDAR_SYNC_PREFS: 'calendarSyncPrefs',
  NOTIFICATION_PREFS: 'notificationPrefs',
  SENT_ARRIVAL_ALERTS: 'sentArrivalAlerts',
} as const;

export interface CalendarSyncPrefs {
  calendarIds: string[];
  scanDays: number;
  /** When true, cross-reference calendar events against GTFS schedule data for precise trip matching. */
  matchGtfs: boolean;
}

export interface NotificationPrefs {
  morningAlerts: boolean;
  departureReminders: boolean;
  delayAlerts: boolean;
  arrivalAlerts: boolean;
  liveActivities: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  morningAlerts: true,
  departureReminders: true,
  delayAlerts: true,
  arrivalAlerts: true,
  liveActivities: true,
};

import { calculateDaysAway, formatDateForDisplay } from '../utils/date-helpers';
import { haversineDistance } from '../utils/distance';
import { logger } from '../utils/logger';
import { formatTime, formatTimeWithDayOffset, parseTimeToMinutes } from '../utils/time-formatting';
import { stationLoader } from './station-loader';

export class TrainStorageService {
  /**
   * Get all saved train references
   */
  static async getSavedTrainRefs(): Promise<SavedTrainRef[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SAVED_TRAINS);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      logger.error('Error loading saved train refs:', error);
      return [];
    }
  }

  /**
   * Get all saved trains (reconstructed from GTFS data)
   * This fetches full train data from GTFS based on stored references
   */
  static async getSavedTrains(): Promise<Train[]> {
    try {
      const refs = await this.getSavedTrainRefs();
      const trains: Train[] = [];

      for (const ref of refs) {
        const train = await TrainAPIService.getTrainDetails(ref.tripId);
        if (train) {
          // If user saved a segmented trip, update from/to based on their segment
          if (ref.fromCode || ref.toCode) {
            const stopTimes = await TrainAPIService.getStopTimesForTrip(ref.tripId);

            if (ref.fromCode) {
              const fromStop = stopTimes.find(s => s.stop_id === ref.fromCode);
              if (fromStop) {
                train.from = fromStop.stop_name;
                train.fromCode = fromStop.stop_id;
                const departFormatted = formatTimeWithDayOffset(fromStop.departure_time);
                train.departTime = departFormatted.time;
                train.departDayOffset = departFormatted.dayOffset;
              }
            }

            if (ref.toCode) {
              const toStop = stopTimes.find(s => s.stop_id === ref.toCode);
              if (toStop) {
                train.to = toStop.stop_name;
                train.toCode = toStop.stop_id;
                const arriveFormatted = formatTimeWithDayOffset(toStop.arrival_time);
                train.arriveTime = arriveFormatted.time;
                train.arriveDayOffset = arriveFormatted.dayOffset;
              }
            }

            // Filter intermediate stops to only those between from and to
            if (ref.fromCode && ref.toCode && train.intermediateStops) {
              const fromIdx = stopTimes.findIndex(s => s.stop_id === ref.fromCode);
              const toIdx = stopTimes.findIndex(s => s.stop_id === ref.toCode);
              if (fromIdx !== -1 && toIdx !== -1) {
                const segmentStops = stopTimes.slice(fromIdx + 1, toIdx);
                train.intermediateStops = segmentStops.map(s => ({
                  time: formatTime(s.departure_time),
                  name: s.stop_name,
                  code: s.stop_id,
                }));
              }
            }
          }

          // Update date and daysAway based on travel date
          if (ref.travelDate) {
            train.travelDate = ref.travelDate;
            train.date = formatDateForDisplay(ref.travelDate);
            train.daysAway = calculateDaysAway(ref.travelDate);

            // Clear realtime data for future trains — avoids matching
            // a saved future train to today's live train with the same number
            if (train.daysAway > 0) {
              train.realtime = undefined;
            }
          }

          trains.push(train);
        }
      }

      return trains;
    } catch (error) {
      logger.error('Error loading saved trains:', error);
      return [];
    }
  }

  /**
   * Save a train reference to the list
   */
  static async saveTrainRef(ref: SavedTrainRef): Promise<boolean> {
    return withLock(STORAGE_KEYS.SAVED_TRAINS, async () => {
      try {
        const refs = await this.getSavedTrainRefs();

        // Check if train already exists (same tripId, segment, and travel date)
        const exists = refs.some(
          r =>
            r.tripId === ref.tripId &&
            r.fromCode === ref.fromCode &&
            r.toCode === ref.toCode &&
            r.travelDate === ref.travelDate
        );
        if (exists) {
          return false;
        }

        const updatedRefs = [...refs, ref];
        await AsyncStorage.setItem(STORAGE_KEYS.SAVED_TRAINS, JSON.stringify(updatedRefs));
        return true;
      } catch (error) {
        logger.error('Error saving train ref:', error);
        return false;
      }
    });
  }

  /**
   * Save a train (creates a reference from the full train object)
   */
  static async saveTrain(train: Train): Promise<boolean> {
    if (!train.tripId) {
      logger.error('Cannot save train without tripId');
      return false;
    }

    const ref: SavedTrainRef = {
      tripId: train.tripId,
      fromCode: train.fromCode || undefined,
      toCode: train.toCode || undefined,
      savedAt: Date.now(),
    };

    logger.info(`[Storage] Saving train ${train.trainNumber} (${train.from} → ${train.to})`);
    return this.saveTrainRef(ref);
  }

  /**
   * Delete a train by tripId (and optional segment)
   */
  static async deleteTrainByTripId(
    tripId: string,
    fromCode?: string,
    toCode?: string,
    travelDate?: number
  ): Promise<boolean> {
    return withLock(STORAGE_KEYS.SAVED_TRAINS, async () => {
      try {
        logger.info(
          `[Storage] Deleting train ${tripId} (${fromCode || '?'} → ${toCode || '?'}, date=${travelDate || '?'})`
        );
        const refs = await this.getSavedTrainRefs();
        const updatedRefs = refs.filter(r => {
          if (r.tripId !== tripId) return true;
          // If segment codes provided, only delete matching segment
          if (fromCode !== undefined || toCode !== undefined) {
            if (r.fromCode !== fromCode || r.toCode !== toCode) return true;
          }
          // If travelDate provided, only delete matching date
          if (travelDate !== undefined) {
            return r.travelDate !== travelDate;
          }
          return false;
        });
        await AsyncStorage.setItem(STORAGE_KEYS.SAVED_TRAINS, JSON.stringify(updatedRefs));
        return true;
      } catch (error) {
        logger.error('Error deleting train:', error);
        return false;
      }
    });
  }

  /**
   * Delete a train by numeric ID (for backwards compatibility)
   */
  static async deleteTrain(trainId: number): Promise<boolean> {
    return this.deleteTrainByTripId(String(trainId));
  }

  /**
   * Clear all saved trains
   */
  static async clearAllTrains(): Promise<boolean> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.SAVED_TRAINS);
      return true;
    } catch (error) {
      logger.error('Error clearing trains:', error);
      return false;
    }
  }

  static async clearTripHistory(): Promise<boolean> {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.TRIP_HISTORY);
      return true;
    } catch (error) {
      logger.error('Error clearing trip history:', error);
      return false;
    }
  }

  /**
   * Get completed trip history
   */
  static async getTripHistory(): Promise<CompletedTrip[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.TRIP_HISTORY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      logger.error('Error loading trip history:', error);
      return [];
    }
  }

  /**
   * Backfill missing duration/distance on existing history entries.
   */
  static async backfillHistoryStats(): Promise<void> {
    try {
      const history = await this.getTripHistory();
      let changed = false;

      for (const trip of history) {
        if (trip.duration == null && trip.departTime && trip.arriveTime) {
          const dep = parseTimeToMinutes(trip.departTime);
          const arr = parseTimeToMinutes(trip.arriveTime);
          let dur = arr - dep;
          if (dur < 0) dur += 24 * 60;
          if (dur > 0) {
            trip.duration = dur;
            changed = true;
          }
        }
        if (trip.distance == null && trip.fromCode && trip.toCode) {
          const from = stationLoader.getStationByCode(trip.fromCode);
          const to = stationLoader.getStationByCode(trip.toCode);
          if (from && to) {
            trip.distance = haversineDistance(from.lat, from.lon, to.lat, to.lon);
            changed = true;
          }
        }
      }

      if (changed) {
        await AsyncStorage.setItem(STORAGE_KEYS.TRIP_HISTORY, JSON.stringify(history));
      }
    } catch (error) {
      logger.error('Error backfilling history stats:', error);
    }
  }

  /**
   * Add a completed trip to history with dedup check.
   * Returns true if the entry was added, false if it already existed.
   */
  static async addToHistory(entry: CompletedTrip): Promise<boolean> {
    return withLock(STORAGE_KEYS.TRIP_HISTORY, async () => {
      try {
        const history = await this.getTripHistory();
        const exists = history.some(
          h =>
            h.tripId === entry.tripId &&
            h.fromCode === entry.fromCode &&
            h.toCode === entry.toCode &&
            h.travelDate === entry.travelDate
        );
        if (exists) {
          return false;
        }
        history.unshift(entry);
        await AsyncStorage.setItem(STORAGE_KEYS.TRIP_HISTORY, JSON.stringify(history));
        return true;
      } catch (error) {
        logger.error('Error adding to history:', error);
        return false;
      }
    });
  }

  /**
   * Move a train to trip history (saves display data and removes from saved trains)
   */
  static async moveToHistory(train: Train): Promise<boolean> {
    try {
      // Calculate distance as the crow flies using station coordinates
      let distance: number | undefined;
      if (train.fromCode && train.toCode) {
        try {
          const fromStation = stationLoader.getStationByCode(train.fromCode);
          const toStation = stationLoader.getStationByCode(train.toCode);
          if (fromStation && toStation) {
            distance = haversineDistance(fromStation.lat, fromStation.lon, toStation.lat, toStation.lon);
          }
        } catch (error) {
          logger.error('Error calculating distance:', error);
        }
      }

      // Calculate duration from depart/arrive times
      let duration: number | undefined;
      try {
        const departMinutes = parseTimeToMinutes(train.departTime);
        const arriveMinutes = parseTimeToMinutes(train.arriveTime);
        duration = arriveMinutes - departMinutes;
        // Handle next-day arrivals
        if (duration < 0) {
          duration += 24 * 60;
        }
        // Adjust for day offsets if available
        if (typeof train.arriveDayOffset === 'number' && typeof train.departDayOffset === 'number') {
          const dayDiff = train.arriveDayOffset - train.departDayOffset;
          duration += dayDiff * 24 * 60;
        }
      } catch (error) {
        logger.error('Error calculating duration:', error);
      }

      const entry: CompletedTrip = {
        tripId: train.tripId || '',
        trainNumber: train.trainNumber,
        routeName: train.routeName,
        from: train.from,
        to: train.to,
        fromCode: train.fromCode,
        toCode: train.toCode,
        departTime: train.departTime,
        arriveTime: train.arriveTime,
        date: train.date,
        travelDate: train.travelDate || Date.now(),
        completedAt: Date.now(),
        delay: train.realtime?.delay,
        distance,
        duration,
      };

      logger.info(`[Storage] Archiving train ${train.trainNumber} to history (${train.from} → ${train.to})`);
      await this.addToHistory(entry);

      // Remove from saved trains
      await this.deleteTrainByTripId(entry.tripId, entry.fromCode, entry.toCode, train.travelDate);
      return true;
    } catch (error) {
      logger.error('Error moving train to history:', error);
      return false;
    }
  }

  /**
   * Delete a trip from history
   */
  static async deleteFromHistory(
    tripId: string,
    fromCode: string,
    toCode: string,
    travelDate?: number
  ): Promise<boolean> {
    return withLock(STORAGE_KEYS.TRIP_HISTORY, async () => {
      try {
        const history = await this.getTripHistory();
        const updated = history.filter(h => {
          if (h.tripId !== tripId || h.fromCode !== fromCode || h.toCode !== toCode) return true;
          // If travelDate provided, only delete matching date
          if (travelDate !== undefined) {
            return h.travelDate !== travelDate;
          }
          return false;
        });
        await AsyncStorage.setItem(STORAGE_KEYS.TRIP_HISTORY, JSON.stringify(updated));
        return true;
      } catch (error) {
        logger.error('Error deleting from history:', error);
        return false;
      }
    });
  }

  /**
   * Get saved calendar sync preferences
   */
  static async getCalendarSyncPrefs(): Promise<CalendarSyncPrefs | null> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.CALENDAR_SYNC_PREFS);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('Error loading calendar sync prefs:', error);
      return null;
    }
  }

  /**
   * Save calendar sync preferences
   */
  static async saveCalendarSyncPrefs(prefs: CalendarSyncPrefs): Promise<boolean> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.CALENDAR_SYNC_PREFS, JSON.stringify(prefs));
      return true;
    } catch (error) {
      logger.error('Error saving calendar sync prefs:', error);
      return false;
    }
  }

  /**
   * Get the set of train keys for which arrival alerts have already been sent.
   */
  static async getSentArrivalAlerts(): Promise<Set<string>> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SENT_ARRIVAL_ALERTS);
      return data ? new Set(JSON.parse(data)) : new Set();
    } catch (error) {
      logger.error('Error loading sent arrival alerts:', error);
      return new Set();
    }
  }

  /**
   * Mark a train key as having had its arrival alert sent (persisted).
   */
  static async markArrivalAlertSent(key: string): Promise<void> {
    return withLock(STORAGE_KEYS.SENT_ARRIVAL_ALERTS, async () => {
      try {
        const sent = await this.getSentArrivalAlerts();
        sent.add(key);
        await AsyncStorage.setItem(STORAGE_KEYS.SENT_ARRIVAL_ALERTS, JSON.stringify([...sent]));
      } catch (error) {
        logger.error('Error saving sent arrival alert:', error);
      }
    });
  }

  /**
   * Remove a train key from the sent arrival alerts set.
   */
  static async clearArrivalAlert(key: string): Promise<void> {
    return withLock(STORAGE_KEYS.SENT_ARRIVAL_ALERTS, async () => {
      try {
        const sent = await this.getSentArrivalAlerts();
        sent.delete(key);
        await AsyncStorage.setItem(STORAGE_KEYS.SENT_ARRIVAL_ALERTS, JSON.stringify([...sent]));
      } catch (error) {
        logger.error('Error clearing arrival alert:', error);
      }
    });
  }

  static async getNotificationPrefs(): Promise<NotificationPrefs> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.NOTIFICATION_PREFS);
      return data ? { ...DEFAULT_NOTIFICATION_PREFS, ...JSON.parse(data) } : DEFAULT_NOTIFICATION_PREFS;
    } catch (error) {
      logger.error('Error loading notification prefs:', error);
      return DEFAULT_NOTIFICATION_PREFS;
    }
  }

  static async saveNotificationPrefs(prefs: NotificationPrefs): Promise<boolean> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.NOTIFICATION_PREFS, JSON.stringify(prefs));
      return true;
    } catch (error) {
      logger.error('Error saving notification prefs:', error);
      return false;
    }
  }
}
