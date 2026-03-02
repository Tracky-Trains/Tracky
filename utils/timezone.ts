import tzlookup from '@photostructure/tz-lookup';
import type { Stop } from '../types/train';

/**
 * Derive IANA timezone string from geographic coordinates.
 * Returns null if lookup fails.
 */
export function getTimezoneForCoordinates(lat: number, lon: number): string | null {
  try {
    return tzlookup(lat, lon);
  } catch {
    return null;
  }
}

/**
 * Return the timezone for a stop: prefer the GTFS stop_timezone field,
 * fall back to a coordinate-based lookup.
 */
export function getTimezoneForStop(stop: Stop): string | null {
  if (stop.stop_timezone) return stop.stop_timezone;
  return getTimezoneForCoordinates(stop.stop_lat, stop.stop_lon);
}
