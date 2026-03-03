/**
 * Centralized time formatting utilities
 * Consolidates time parsing and formatting logic from across the codebase
 */

export interface FormattedTime {
  time: string;
  dayOffset: number; // 0 = same day, 1 = next day, 2 = two days later, etc.
}

/**
 * Format 24-hour time to 12-hour AM/PM format with day offset
 * Handles overnight trains where hours >= 24 (GTFS standard)
 * @param time24 - Time in 24-hour format (e.g., "14:30" or "25:30" for next day)
 * @returns Object with formatted time and day offset
 * @example
 * formatTimeWithDayOffset("14:30") // { time: "2:30 PM", dayOffset: 0 }
 * formatTimeWithDayOffset("25:30") // { time: "1:30 AM", dayOffset: 1 }
 */
export function formatTimeWithDayOffset(time24: string): FormattedTime {
  const [hours, minutes] = time24.substring(0, 5).split(':');
  let h = parseInt(hours, 10);
  const m = minutes;

  // Handle overnight trains (hours >= 24 means next day in GTFS)
  // Can be 24-47 for +1 day, 48-71 for +2 days, etc.
  const dayOffset = Math.floor(h / 24);
  h = h % 24;

  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;

  return {
    time: `${h}:${m} ${ampm}`,
    dayOffset,
  };
}

/**
 * Format 24-hour time to 12-hour AM/PM format with optional day offset suffix
 * @param time24 - Time in 24-hour format
 * @returns Formatted time string with "+N" suffix if next day(s)
 * @example
 * formatTime("14:30") // "2:30 PM"
 * formatTime("25:30") // "1:30 AM +1"
 */
export function formatTime(time24: string): string {
  const result = formatTimeWithDayOffset(time24);
  return result.dayOffset > 0 ? `${result.time} +${result.dayOffset}` : result.time;
}

/**
 * Parse time string (h:mm AM/PM) to minutes since midnight
 * @param timeStr - Time in 12-hour format (e.g., "2:30 PM")
 * @returns Minutes since midnight (0-1439)
 * @example
 * parseTimeToMinutes("2:30 PM") // 870 (14.5 hours * 60)
 * parseTimeToMinutes("12:00 AM") // 0
 */
export function parseTimeToMinutes(timeStr: string): number {
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 0;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const isPM = match[3].toUpperCase() === 'PM';

  if (isPM && hours !== 12) hours += 12;
  if (!isPM && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

/**
 * Parse time string (h:mm AM/PM) to Date object
 * @param timeStr - Time in 12-hour format
 * @param baseDate - Base date to apply the time to
 * @returns Date object with the parsed time
 * @example
 * parseTimeToDate("2:30 PM", new Date()) // Today at 2:30 PM
 */
export function parseTimeToDate(timeStr: string, baseDate: Date): Date {
  const [time, meridian] = timeStr.split(' ');
  const [hStr, mStr] = time.split(':');
  let hours = parseInt(hStr, 10);
  const minutes = parseInt(mStr, 10);
  const isPM = (meridian || '').toUpperCase() === 'PM';

  if (isPM && hours !== 12) hours += 12;
  if (!isPM && hours === 12) hours = 0;

  const d = new Date(baseDate);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/**
 * Convert 12-hour time string (h:mm AM/PM) to 24-hour minutes
 * Helper function for time calculations
 * @param timeStr - Time in 12-hour format
 * @returns Minutes since midnight in 24-hour time
 */
export function timeToMinutes(timeStr: string): number {
  return parseTimeToMinutes(timeStr);
}

/**
 * Add delay minutes to a time string and return the new time with day offset
 * @param timeStr - Time in "h:mm AM/PM" format
 * @param delayMinutes - Number of minutes to add
 * @param baseDayOffset - The original day offset (default 0)
 * @returns New time string and updated day offset
 * @example
 * addDelayToTime("11:30 PM", 120, 0) // { time: "1:30 AM", dayOffset: 1 }
 */
export function addDelayToTime(timeStr: string, delayMinutes: number, baseDayOffset: number = 0): FormattedTime {
  const minutes = timeToMinutes(timeStr);
  let newMinutes = minutes + delayMinutes;
  let dayOffset = baseDayOffset;

  // Handle day rollover
  while (newMinutes >= 24 * 60) {
    newMinutes -= 24 * 60;
    dayOffset += 1;
  }
  while (newMinutes < 0) {
    newMinutes += 24 * 60;
    dayOffset -= 1;
  }

  const hours = Math.floor(newMinutes / 60);
  const mins = newMinutes % 60;
  const isPM = hours >= 12;
  let displayHours = hours % 12;
  if (displayHours === 0) displayHours = 12;

  return {
    time: `${displayHours}:${mins.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`,
    dayOffset,
  };
}

/**
 * Get the color key for a delay value.
 * - delayed (> 0): 'delayed'
 * - on time or early (<= 0): 'onTime'
 * - no data (null/undefined): null
 */
export function getDelayColorKey(delayMinutes: number | null | undefined): 'delayed' | 'onTime' | null {
  if (delayMinutes == null) return null;
  return delayMinutes > 0 ? 'delayed' : 'onTime';
}

/**
 * Format minutes as a compact duration string.
 * @example formatDurationCompact(5) => "5m", formatDurationCompact(75) => "1h15m"
 */
export function formatDurationCompact(minutes: number): string {
  const abs = Math.abs(minutes);
  if (abs >= 60) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return m > 0 ? `${h}h${m}m` : `${h}h`;
  }
  return `${abs}m`;
}

/**
 * Format a delay as a short label: "+5m", "+1h15m"
 */
export function formatDelayShort(delayMinutes: number): string {
  return `+${formatDurationCompact(delayMinutes)}`;
}

/**
 * Format a delay value for display.
 * @returns "Delayed #h#m", "Early #m", or "On Time"
 */
export function formatDelayStatus(delayMinutes: number): string {
  if (delayMinutes > 0) return `Delayed ${formatDurationCompact(delayMinutes)}`;
  if (delayMinutes < 0) return `Early ${formatDurationCompact(delayMinutes)}`;
  return 'On Time';
}
