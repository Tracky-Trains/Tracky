import tzlookup from '@photostructure/tz-lookup';
import type { Stop } from '../types/train';
import { logger } from './logger';

/**
 * Derive IANA timezone string from geographic coordinates.
 * Returns null if lookup fails.
 */
export function getTimezoneForCoordinates(lat: number, lon: number): string | null {
  try {
    const tz = tzlookup(lat, lon);
    logger.debug('Timezone: coordinate lookup', { lat, lon, tz });
    return tz;
  } catch (e) {
    logger.warn('Timezone: coordinate lookup failed', { lat, lon, error: String(e) });
    return null;
  }
}

/**
 * Return the timezone for a stop: prefer the GTFS stop_timezone field,
 * fall back to a coordinate-based lookup.
 */
export function getTimezoneForStop(stop: Stop): string | null {
  if (stop.stop_timezone) {
    logger.debug('Timezone: using GTFS stop_timezone', { stop_id: stop.stop_id, stop_timezone: stop.stop_timezone });
    return stop.stop_timezone;
  }
  logger.debug('Timezone: stop_timezone empty, falling back to coordinates', { stop_id: stop.stop_id, lat: stop.stop_lat, lon: stop.stop_lon });
  return getTimezoneForCoordinates(stop.stop_lat, stop.stop_lon);
}
