/**
 * Shared display/formatting utilities for train UI components.
 */
import type { Train } from '../types/train';
import { parseTimeToDate, timeToMinutes } from './time-formatting';

/**
 * Get a human-readable countdown for a train's departure.
 * Returns the most appropriate unit (days, hours, minutes, or seconds).
 */
export function getCountdownForTrain(train: Train): {
  value: number;
  unit: 'DAYS' | 'HOURS' | 'MINUTES' | 'SECONDS';
  past: boolean;
} {
  if (train.daysAway && train.daysAway > 0) {
    return { value: Math.round(train.daysAway), unit: 'DAYS', past: false };
  }
  const now = new Date();
  const baseDate = new Date(now);
  const departDate = parseTimeToDate(train.departTime, baseDate);
  let deltaSec = (departDate.getTime() - now.getTime()) / 1000;
  const past = deltaSec < 0;
  const absSec = Math.abs(deltaSec);

  let hours = Math.round(absSec / 3600);
  if (hours >= 1) return { value: hours, unit: 'HOURS', past };
  let minutes = Math.round(absSec / 60);
  if (minutes >= 60) return { value: 1, unit: 'HOURS', past };
  if (minutes >= 1) return { value: minutes, unit: 'MINUTES', past };
  let seconds = Math.round(absSec);
  if (seconds >= 60) return { value: 1, unit: 'MINUTES', past };
  return { value: seconds, unit: 'SECONDS', past };
}

/**
 * Pluralize a word based on count.
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural || `${singular}s`;
}

/**
 * Calculate journey duration string from start and end times (HH:MM format).
 */
export function calculateDuration(startTime: string, endTime: string): string {
  const startMinutes = timeToMinutes(startTime);
  let endMinutes = timeToMinutes(endTime);
  // If end time is earlier than start time, assume it's the next day
  if (endMinutes < startMinutes) {
    endMinutes += 24 * 60;
  }
  const duration = endMinutes - startMinutes;
  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;
  return `${hours}h ${minutes}m`;
}
