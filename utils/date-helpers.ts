/**
 * Centralized date formatting and manipulation utilities
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format date for display (e.g., "Jan 4")
 * @param timestamp - Unix timestamp or Date object
 * @returns Formatted date string
 * @example
 * formatDateForDisplay(1704412800000) // "Jan 4"
 * formatDateForDisplay(new Date(2024, 0, 4)) // "Jan 4"
 */
export function formatDateForDisplay(timestamp: number | Date): string {
  const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Calculate days away from a travel date
 * @param travelDate - Travel date as timestamp or Date object
 * @returns Number of days until travel date (negative if in the past)
 * @example
 * calculateDaysAway(tomorrow) // 1
 * calculateDaysAway(yesterday) // -1
 */
export function calculateDaysAway(travelDate: number | Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const travel = typeof travelDate === 'number' ? new Date(travelDate) : new Date(travelDate);
  travel.setHours(0, 0, 0, 0);

  const diffTime = travel.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * Get a human-readable label for days away
 * @param days - Number of days
 * @returns Human-readable string (e.g., "Today", "Tomorrow", "in 3 days")
 */
export function getDaysAwayLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

/**
 * Check if two dates are the same day (ignoring time)
 * @param date1 - First date
 * @param date2 - Second date
 * @returns True if same calendar day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Get the start of day (midnight) for a given date
 * @param date - Input date
 * @returns New Date object set to midnight
 */
export function getStartOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Add days to a date
 * @param date - Base date
 * @param days - Number of days to add (can be negative)
 * @returns New Date object
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
