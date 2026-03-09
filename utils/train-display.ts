/**
 * Shared display/formatting utilities for train UI components.
 */
import type { Train } from '../types/train';
import { parseTimeToMinutes, timeToMinutes } from './time-formatting';
import { gtfsParser } from './gtfs-parser';
import { getCurrentSecondsInTimezone, getTimezoneForStop } from './timezone';

/**
 * Get a human-readable countdown for a train's departure.
 * Returns the most appropriate unit (days, hours, minutes, or seconds).
 */
export function getCountdownForTrain(train: Train): {
  value: number;
  unit: 'DAY' | 'DAYS' | 'HOUR' | 'HOURS' | 'MINUTE' | 'MINUTES' | 'SECOND' | 'SECONDS';
  past: boolean;
} {
  if (train.daysAway && train.daysAway > 0) {
    const days = Math.round(train.daysAway);
    return { value: days, unit: days === 1 ? 'DAY' : 'DAYS', past: false };
  }
  const fromStop = gtfsParser.getStop(train.fromCode);
  const fromTz = fromStop ? getTimezoneForStop(fromStop) : gtfsParser.agencyTimezone;
  const nowSec = getCurrentSecondsInTimezone(fromTz);
  const departSec = parseTimeToMinutes(train.departTime) * 60
    + (train.realtime?.delay && train.realtime.delay > 0 ? train.realtime.delay * 60 : 0);
  let deltaSec = departSec - nowSec;
  const past = deltaSec < 0;
  const absSec = Math.abs(deltaSec);

  let hours = Math.round(absSec / 3600);
  if (hours >= 1) return { value: hours, unit: hours === 1 ? 'HOUR' : 'HOURS', past };
  let minutes = Math.round(absSec / 60);
  if (minutes >= 60) return { value: 1, unit: 'HOUR', past };
  if (minutes >= 1) return { value: minutes, unit: minutes === 1 ? 'MINUTE' : 'MINUTES', past };
  let seconds = Math.round(absSec);
  if (seconds >= 60) return { value: 1, unit: 'MINUTE', past };
  return { value: seconds, unit: seconds === 1 ? 'SECOND' : 'SECONDS', past };
}

/**
 * Pluralize a word based on count.
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural || `${singular}s`;
}

/**
 * Return "count word(s)" — e.g. pluralCount(3, 'hour') → "3 hours".
 */
export function pluralCount(count: number, singular: string, plural?: string): string {
  return `${count} ${pluralize(count, singular, plural)}`;
}

/**
 * Calculate journey duration string from start and end times (HH:MM format).
 */
export function calculateDuration(startTime: string, endTime: string, departDayOffset?: number, arriveDayOffset?: number): string {
  const startMinutes = timeToMinutes(startTime);
  let endMinutes = timeToMinutes(endTime);
  let duration = endMinutes - startMinutes;
  if (typeof departDayOffset === 'number' && typeof arriveDayOffset === 'number') {
    duration += (arriveDayOffset - departDayOffset) * 24 * 60;
  } else if (duration < 0) {
    // Fallback: assume next day when no day offsets available
    duration += 24 * 60;
  }
  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;
  return `${hours}h ${minutes}m`;
}
