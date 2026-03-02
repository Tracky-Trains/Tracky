/**
 * Calendar sync service for importing trips from device calendars.
 * Scans for events like "Train to Philadelphia" and matches them against GTFS data.
 */
import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import type { CompletedTrip, SavedTrainRef } from '../types/train';
import { formatDateForDisplay } from '../utils/date-helpers';
import { gtfsParser } from '../utils/gtfs-parser';
import { logger } from '../utils/logger';
import { haversineDistance } from '../utils/distance';
import { formatTime, parseTimeToMinutes } from '../utils/time-formatting';
import { stationLoader } from './station-loader';
import { TrainStorageService } from './storage';

export interface DeviceCalendar {
  id: string;
  title: string;
  color: string;
  source: string;
}

export interface AddedTripInfo {
  from: string;
  to: string;
  date: string;
}

export interface SyncResult {
  parsed: number;
  matched: number;
  added: number;
  skipped: number;
  addedTrips: AddedTripInfo[];
}

interface MatchedTrip {
  tripId: string;
  fromStopId: string;
  fromStopName: string;
  toStopId: string;
  toStopName: string;
  departTime: string;
  arriveTime: string;
  trainNumber: string;
  routeName: string;
  eventDate: Date;
}

const TRAIN_EVENT_PATTERN = /train\s+to\s+([a-z\s.'-]+)/i;
const TIME_TOLERANCE_MINUTES = 15;

/**
 * Request calendar read permission from the user.
 * Returns true if granted.
 */
export async function requestCalendarPermission(): Promise<boolean> {
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  return status === 'granted';
}

/**
 * Check if calendar permission is already granted.
 */
export async function hasCalendarPermission(): Promise<boolean> {
  const { status } = await Calendar.getCalendarPermissionsAsync();
  return status === 'granted';
}

/**
 * Get list of device calendars for the user to pick from.
 */
export async function getDeviceCalendars(): Promise<DeviceCalendar[]> {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return calendars.map(cal => ({
    id: cal.id,
    title: cal.title,
    color: cal.color ?? '#999999',
    source: Platform.OS === 'ios'
      ? (cal.source?.name ?? 'Unknown')
      : (cal.source?.name ?? cal.accessLevel ?? 'Unknown'),
  }));
}

/**
 * Parse GTFS 24h time string (e.g. "14:30:00") to minutes since midnight.
 */
function gtfsTimeToMinutes(gtfsTime: string): number {
  const parts = gtfsTime.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return h * 60 + m;
}

/**
 * Search for a station, trying full name first then stripping trailing state abbreviation.
 */
function resolveStation(name: string) {
  let stations = gtfsParser.searchStations(name);
  if (stations.length === 0) {
    const withoutState = name.replace(/\s+[A-Za-z]{2}$/, '').trim();
    if (withoutState !== name && withoutState.length > 0) {
      stations = gtfsParser.searchStations(withoutState);
    }
  }
  return stations.length > 0 ? stations[0] : null;
}

/**
 * Match a single calendar event against GTFS data.
 * Uses event location as origin station and title destination.
 * Returns the matched trip info or null if no match found.
 */
function matchEventToTrip(eventTitle: string, eventStartDate: Date, eventLocation?: string): MatchedTrip | null {
  const match = eventTitle.match(TRAIN_EVENT_PATTERN);
  if (!match) return null;

  const destination = match[1].trim();
  const eventMinutes = eventStartDate.getHours() * 60 + eventStartDate.getMinutes();
  const eventDate = new Date(eventStartDate);
  eventDate.setHours(0, 0, 0, 0);

  const destStation = resolveStation(destination);
  if (!destStation) {
    logger.info(`Calendar sync: no station found for destination "${destination}"`);
    return null;
  }
  logger.info(`Calendar sync: destination "${destination}" → "${destStation.stop_name}" (${destStation.stop_id})`);

  // If event has a location, use it as the origin station
  const originLocation = eventLocation?.trim();
  if (originLocation) {
    const originStation = resolveStation(originLocation);
    if (originStation) {
      logger.info(`Calendar sync: origin "${originLocation}" → "${originStation.stop_name}" (${originStation.stop_id})`);

      // Use findTripsWithStops for precise origin→destination matching
      const trips = gtfsParser.findTripsWithStops(originStation.stop_id, destStation.stop_id, eventDate);
      logger.info(`Calendar sync: ${trips.length} trips from ${originStation.stop_id} to ${destStation.stop_id} on ${eventDate.toLocaleDateString()}`);

      for (const trip of trips) {
        const departMinutes = gtfsTimeToMinutes(trip.fromStop.departure_time);
        if (Math.abs(departMinutes - eventMinutes) <= TIME_TOLERANCE_MINUTES) {
          const trainNumber = gtfsParser.getTrainNumber(trip.tripId);
          const routeId = gtfsParser.getRouteIdForTrip(trip.tripId);
          const routeName = routeId ? gtfsParser.getRouteName(routeId) : 'Unknown Route';

          return {
            tripId: trip.tripId,
            fromStopId: trip.fromStop.stop_id,
            fromStopName: trip.fromStop.stop_name,
            toStopId: trip.toStop.stop_id,
            toStopName: trip.toStop.stop_name,
            departTime: formatTime(trip.fromStop.departure_time),
            arriveTime: formatTime(trip.toStop.arrival_time),
            trainNumber,
            routeName,
            eventDate,
          };
        }
      }
    } else {
      logger.info(`Calendar sync: no station found for origin "${originLocation}", falling back to time matching`);
    }
  }

  // Fallback: no location or origin not found — infer origin by matching departure time at any stop
  const tripIds = gtfsParser.getTripsForStop(destStation.stop_id, eventDate);
  logger.info(`Calendar sync: fallback — ${tripIds.length} trips at ${destStation.stop_id}, event time ${eventStartDate.getHours()}:${String(eventStartDate.getMinutes()).padStart(2, '0')}`);

  for (const tripId of tripIds) {
    const stopTimes = gtfsParser.getStopTimesForTrip(tripId);
    if (stopTimes.length < 2) continue;

    for (const stop of stopTimes) {
      const stopMinutes = gtfsTimeToMinutes(stop.departure_time);
      if (Math.abs(stopMinutes - eventMinutes) <= TIME_TOLERANCE_MINUTES) {
        const destStopTime = stopTimes.find(s => s.stop_id === destStation.stop_id);
        if (!destStopTime) continue;
        if (stop.stop_sequence >= destStopTime.stop_sequence) continue;

        const trainNumber = gtfsParser.getTrainNumber(tripId);
        const routeId = gtfsParser.getRouteIdForTrip(tripId);
        const routeName = routeId ? gtfsParser.getRouteName(routeId) : 'Unknown Route';

        return {
          tripId,
          fromStopId: stop.stop_id,
          fromStopName: stop.stop_name,
          toStopId: destStopTime.stop_id,
          toStopName: destStopTime.stop_name,
          departTime: formatTime(stop.departure_time),
          arriveTime: formatTime(destStopTime.arrival_time),
          trainNumber,
          routeName,
          eventDate,
        };
      }
    }
  }

  return null;
}

/**
 * Fetch train events from calendars within a date range.
 */
async function fetchTrainEvents(
  calendarIds: string[],
  startDate: Date,
  endDate: Date,
): Promise<Calendar.Event[]> {
  logger.info(`Calendar sync: fetching from ${calendarIds.length} calendar(s), ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`);
  const events = await Calendar.getEventsAsync(calendarIds, startDate, endDate);
  logger.info(`Calendar sync: ${events.length} total events found`);
  const matched: Calendar.Event[] = [];
  for (const e of events) {
    if (TRAIN_EVENT_PATTERN.test(e.title)) {
      logger.info(`Calendar sync: matched "${e.title}"`);
      matched.push(e);
    }
  }
  logger.info(`Calendar sync: ${matched.length}/${events.length} matched train pattern`);
  return matched;
}

/**
 * Sync past trips — scans selected calendars for past train events
 * and adds matched trips to history.
 */
export async function syncPastTrips(
  calendarIds: string[],
  scanDays: number,
): Promise<SyncResult> {
  const result: SyncResult = { parsed: 0, matched: 0, added: 0, skipped: 0, addedTrips: [] };

  if (!gtfsParser.isLoaded) {
    logger.error('Calendar sync: GTFS data not loaded');
    return result;
  }

  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - 1);
  endDate.setHours(23, 59, 59, 999);

  const startDate = new Date(now);
  if (scanDays === -1) {
    // "All" option - scan as far back as possible (10 years)
    startDate.setFullYear(startDate.getFullYear() - 10);
  } else {
    startDate.setDate(startDate.getDate() - scanDays);
  }
  startDate.setHours(0, 0, 0, 0);

  const trainEvents = await fetchTrainEvents(calendarIds, startDate, endDate);
  result.parsed = trainEvents.length;
  if (trainEvents.length === 0) return result;

  const existingHistory = await TrainStorageService.getTripHistory();
  const existingKeys = new Set(
    existingHistory.map(h => `${h.tripId}|${h.fromCode}|${h.toCode}|${h.date}`),
  );

  for (const event of trainEvents) {
    const matched = matchEventToTrip(event.title, new Date(event.startDate), event.location ?? undefined);
    if (!matched) continue;

    // Calculate duration from times
    let duration: number | undefined;
    try {
      const departMinutes = parseTimeToMinutes(matched.departTime);
      const arriveMinutes = parseTimeToMinutes(matched.arriveTime);
      duration = arriveMinutes - departMinutes;
      if (duration < 0) {
        duration += 24 * 60;
      }
    } catch (error) {
      logger.error('Calendar sync: Error calculating duration:', error);
    }

    // Calculate distance as the crow flies using station coordinates
    let distance: number | undefined;
    try {
      const fromStation = stationLoader.getStationByCode(matched.fromStopId);
      const toStation = stationLoader.getStationByCode(matched.toStopId);
      if (fromStation && toStation) {
        distance = haversineDistance(
          fromStation.lat,
          fromStation.lon,
          toStation.lat,
          toStation.lon
        );
      }
    } catch (error) {
      logger.error('Calendar sync: Error calculating distance:', error);
    }

    const entry: CompletedTrip = {
      tripId: matched.tripId,
      trainNumber: matched.trainNumber,
      routeName: matched.routeName,
      from: matched.fromStopName,
      to: matched.toStopName,
      fromCode: matched.fromStopId,
      toCode: matched.toStopId,
      departTime: matched.departTime,
      arriveTime: matched.arriveTime,
      date: formatDateForDisplay(matched.eventDate),
      travelDate: matched.eventDate.getTime(),
      completedAt: Date.now(),
      duration,
      distance,
    };

    const key = `${entry.tripId}|${entry.fromCode}|${entry.toCode}|${entry.date}`;
    result.matched++;

    if (existingKeys.has(key)) {
      result.skipped++;
    } else {
      const added = await TrainStorageService.addToHistory(entry);
      if (added) {
        result.added++;
        existingKeys.add(key);
      } else {
        result.skipped++;
      }
    }
  }

  return result;
}

/**
 * Sync future trips — scans calendars for upcoming train events
 * and adds matched trips to saved trains (My Trains).
 * Called automatically on app load.
 */
export async function syncFutureTrips(calendarIds: string[]): Promise<SyncResult> {
  const result: SyncResult = { parsed: 0, matched: 0, added: 0, skipped: 0, addedTrips: [] };

  if (!gtfsParser.isLoaded) {
    logger.error('Calendar sync (future): GTFS data not loaded');
    return result;
  }

  const now = new Date();
  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 90);
  endDate.setHours(23, 59, 59, 999);

  const trainEvents = await fetchTrainEvents(calendarIds, startDate, endDate);
  result.parsed = trainEvents.length;
  if (trainEvents.length === 0) return result;

  // Load existing saved trains for dedup
  const existingRefs = await TrainStorageService.getSavedTrainRefs();
  const existingKeys = new Set(
    existingRefs.map(r => `${r.tripId}|${r.fromCode ?? ''}|${r.toCode ?? ''}|${r.travelDate ?? 0}`),
  );

  for (const event of trainEvents) {
    const matched = matchEventToTrip(event.title, new Date(event.startDate), event.location ?? undefined);
    if (!matched) continue;

    result.matched++;

    const ref: SavedTrainRef = {
      tripId: matched.tripId,
      fromCode: matched.fromStopId,
      toCode: matched.toStopId,
      travelDate: matched.eventDate.getTime(),
      savedAt: Date.now(),
    };

    const key = `${ref.tripId}|${ref.fromCode ?? ''}|${ref.toCode ?? ''}|${ref.travelDate ?? 0}`;
    if (existingKeys.has(key)) {
      result.skipped++;
    } else {
      const saved = await TrainStorageService.saveTrainRef(ref);
      if (saved) {
        result.added++;
        existingKeys.add(key);
        result.addedTrips.push({
          from: matched.fromStopName,
          to: matched.toStopName,
          date: formatDateForDisplay(matched.eventDate),
        });
      } else {
        result.skipped++;
      }
    }
  }

  return result;
}
