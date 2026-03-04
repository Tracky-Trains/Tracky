/**
 * Train-related utility functions
 * Consolidated from services/api.ts and services/realtime.ts
 */

import { gtfsParser } from './gtfs-parser';

/**
 * Extract the actual train number from a tripId
 * Uses GTFS trips.txt trip_short_name as source of truth
 * Falls back to parsing trip_id if trips data not available
 * @param tripId - GTFS trip identifier
 * @returns Train number string
 * @example
 * extractTrainNumber("Amtrak-43-20240104") // "43"
 * extractTrainNumber("2151") // "2151"
 */
export function extractTrainNumber(tripId: string): string {
  // Try to get from trips data first (source of truth)
  const trainNumber = gtfsParser.getTrainNumber(tripId);

  // If we got something different than the tripId, use it
  if (trainNumber && trainNumber !== tripId) {
    return trainNumber;
  }

  // Fallback: Try to extract numeric train number from trip ID
  const match = tripId.match(/\d+/);
  return match ? match[0] : tripId;
}

