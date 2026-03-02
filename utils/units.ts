import type { DistanceUnit, TempUnit } from '../context/UnitsContext';

const MILES_TO_KM = 1.60934;
// Average Big Mac is ~7.5 cm (0.246 feet) tall
const MILES_PER_BURGER = 1 / 26_490; // 5280 ft / ~0.246 ft ≈ 21,463 → round to fun number: 26,490 burgers per mile

/**
 * Convert miles to the target distance unit.
 */
export function convertDistance(miles: number, unit: DistanceUnit): number {
  switch (unit) {
    case 'km':
      return miles * MILES_TO_KM;
    case 'burgers':
      return miles * 26_490;
    default:
      return miles;
  }
}

/**
 * Format a distance (stored internally in miles) for display.
 */
export function formatDistance(miles: number, unit: DistanceUnit): string {
  const val = convertDistance(miles, unit);
  const suffix = distanceSuffix(unit);

  if (unit === 'burgers') {
    if (val >= 1_000_000) {
      return `${(val / 1_000_000).toFixed(1)}M ${suffix}`;
    }
    if (val >= 1_000) {
      return `${(val / 1_000).toFixed(1)}k ${suffix}`;
    }
    return `${Math.round(val).toLocaleString()} ${suffix}`;
  }

  if (val >= 1000) {
    return `${(val / 1000).toFixed(1)}k ${suffix}`;
  }
  return `${Math.round(val).toLocaleString()} ${suffix}`;
}

/**
 * Short suffix for the distance unit.
 */
export function distanceSuffix(unit: DistanceUnit): string {
  switch (unit) {
    case 'km':
      return 'km';
    case 'burgers':
      return '🍔';
    default:
      return 'mi';
  }
}

/**
 * Convert Fahrenheit to the target temp unit.
 */
export function convertTemp(fahrenheit: number, unit: TempUnit): number {
  if (unit === 'C') {
    return Math.round((fahrenheit - 32) * (5 / 9));
  }
  return Math.round(fahrenheit);
}

/**
 * Format temperature for display.
 */
export function formatTemp(fahrenheit: number, unit: TempUnit): string {
  return `${convertTemp(fahrenheit, unit)}°${unit}`;
}

/**
 * The Open-Meteo API temperature_unit query param.
 */
export function weatherApiTempUnit(unit: TempUnit): string {
  return unit === 'C' ? 'celsius' : 'fahrenheit';
}
