/**
 * Map WMO weather code to a human-readable condition and Ionicons icon name.
 * See https://open-meteo.com/en/docs for weather code definitions.
 */
export function getWeatherCondition(code: number): { condition: string; icon: string } {
  if (code === 0) return { condition: 'Clear', icon: 'sunny' };
  if (code <= 3) return { condition: 'Partly Cloudy', icon: 'partly-sunny' };
  if (code <= 48) return { condition: 'Foggy', icon: 'cloud' };
  if (code <= 67) return { condition: 'Rainy', icon: 'rainy' };
  if (code <= 77) return { condition: 'Snowy', icon: 'snow' };
  if (code <= 99) return { condition: 'Stormy', icon: 'thunderstorm' };
  return { condition: 'Scattered Clouds', icon: 'cloud' };
}
