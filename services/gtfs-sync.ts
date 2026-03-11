/**
 * GTFS weekly sync service
 * - Checks freshness (3 days)
 * - Fetches GTFS.zip from Amtrak
 * - Unzips in memory (fflate) and parses CSVs
 * - Caches parsed JSON as compressed files on the filesystem
 * - Applies cached data to the GTFS parser
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { strFromU8, strToU8, unzipSync, zlibSync, unzlibSync } from 'fflate';
import type { CalendarDateException, CalendarEntry, Route, Shape, Stop, StopTime, Trip } from '../types/train';
import { gtfsParser } from '../utils/gtfs-parser';
import { shapeLoader } from './shape-loader';
import { logger } from '../utils/logger';
import { fetchWithTimeout } from '../utils/fetch-with-timeout';

const GTFS_URL = 'https://content.amtrak.com/content/gtfs/GTFS.zip';

const CACHE_DIR = `${FileSystem.documentDirectory}gtfs-cache/`;
const CACHE_FILES = {
  routes: `${CACHE_DIR}routes.json.z`,
  stops: `${CACHE_DIR}stops.json.z`,
  stopTimes: `${CACHE_DIR}stop_times.json.z`,
  shapes: `${CACHE_DIR}shapes.json.z`,
  trips: `${CACHE_DIR}trips.json.z`,
  calendar: `${CACHE_DIR}calendar.json.z`,
  calendarDates: `${CACHE_DIR}calendar_dates.json.z`,
  agencyTimezone: `${CACHE_DIR}agency_timezone.txt`,
};

const STORAGE_KEYS = {
  LAST_FETCH: 'GTFS_LAST_FETCH',
};

// Old AsyncStorage keys to clean up during migration
const LEGACY_STORAGE_KEYS = [
  'GTFS_ROUTES_JSON', 'GTFS_STOPS_JSON', 'GTFS_STOP_TIMES_JSON',
  'GTFS_SHAPES_JSON', 'GTFS_TRIPS_JSON', 'GTFS_CALENDAR_JSON',
  'GTFS_CALENDAR_DATES_JSON', 'GTFS_AGENCY_TIMEZONE',
];

function isOlderThanDays(dateMs: number, days: number): boolean {
  const now = Date.now();
  const ms = days * 24 * 60 * 60 * 1000;
  return now - dateMs > ms;
}

async function ensureCacheDir() {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
  // One-time migration: remove old AsyncStorage GTFS keys to free space
  try {
    await AsyncStorage.multiRemove(LEGACY_STORAGE_KEYS);
  } catch {
    // Ignore — keys may already be gone
  }
}

/** Convert Uint8Array to base64 string (chunk-safe for large arrays) */
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000; // 32KB chunks to avoid call stack overflow
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Write JSON data as zlib-compressed base64 file */
async function writeCompressedJSON(path: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data);
  const compressed = zlibSync(strToU8(json));
  const base64 = uint8ToBase64(compressed);
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
}

/** Read zlib-compressed base64 file and parse as JSON */
async function readCompressedJSON<T>(path: string): Promise<T | null> {
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.Base64 });
    // Convert base64 to Uint8Array
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = strFromU8(unzlibSync(bytes));
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// Basic CSV parser that respects quoted fields
function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCSVLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = cols[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // escaped quote
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  // Trim outer quotes
  return result.map(v => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v));
}

async function fetchZipBytes(): Promise<Uint8Array> {
  const res = await fetchWithTimeout(GTFS_URL, { timeoutMs: 30000 });
  if (!res.ok) throw new Error(`GTFS fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

function buildRoutes(rows: Array<Record<string, string>>): Route[] {
  return rows
    .map(r => ({
      route_id: r['route_id'],
      agency_id: r['agency_id'] || undefined,
      route_short_name: r['route_short_name'] || undefined,
      route_long_name: r['route_long_name'] || r['route_short_name'] || r['route_id'],
      route_type: r['route_type'] || undefined,
      route_url: r['route_url'] || undefined,
      route_color: r['route_color'] || undefined,
      route_text_color: r['route_text_color'] || undefined,
    }))
    .filter(r => !!r.route_id);
}

function buildStops(rows: Array<Record<string, string>>): Stop[] {
  return rows
    .map(r => ({
      stop_id: r['stop_id'],
      stop_name: r['stop_name'],
      stop_url: r['stop_url'] || undefined,
      stop_timezone: r['stop_timezone'] || undefined,
      stop_lat: parseFloat(r['stop_lat']),
      stop_lon: parseFloat(r['stop_lon']),
    }))
    .filter(s => !!s.stop_id && !!s.stop_name);
}

function buildStopTimes(rows: Array<Record<string, string>>): Record<string, StopTime[]> {
  const grouped: Record<string, StopTime[]> = {};
  for (const r of rows) {
    const trip_id = r['trip_id'];
    if (!trip_id) continue;
    const st: StopTime = {
      trip_id,
      arrival_time: r['arrival_time'],
      departure_time: r['departure_time'],
      stop_id: r['stop_id'],
      stop_sequence: parseInt(r['stop_sequence'] || '0', 10),
      pickup_type: r['pickup_type'] ? parseInt(r['pickup_type'], 10) : undefined,
      drop_off_type: r['drop_off_type'] ? parseInt(r['drop_off_type'], 10) : undefined,
      timepoint: r['timepoint'] ? parseInt(r['timepoint'], 10) : undefined,
    };
    if (!grouped[trip_id]) grouped[trip_id] = [];
    grouped[trip_id].push(st);
  }
  // sort sequences per trip
  Object.values(grouped).forEach(arr => arr.sort((a, b) => a.stop_sequence - b.stop_sequence));
  return grouped;
}

function buildShapes(rows: Array<Record<string, string>>): Record<string, Shape[]> {
  const grouped: Record<string, Shape[]> = {};
  for (const r of rows) {
    const shape_id = r['shape_id'];
    if (!shape_id) continue;
    const shape: Shape = {
      shape_id,
      shape_pt_lat: parseFloat(r['shape_pt_lat']),
      shape_pt_lon: parseFloat(r['shape_pt_lon']),
      shape_pt_sequence: parseInt(r['shape_pt_sequence'] || '0', 10),
    };
    if (!grouped[shape_id]) grouped[shape_id] = [];
    grouped[shape_id].push(shape);
  }
  // sort by sequence
  Object.values(grouped).forEach(arr => arr.sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence));
  return grouped;
}

function buildTrips(rows: Array<Record<string, string>>): Trip[] {
  return rows
    .map(r => ({
      route_id: r['route_id'],
      trip_id: r['trip_id'],
      trip_short_name: r['trip_short_name'] || undefined,
      trip_headsign: r['trip_headsign'] || undefined,
      service_id: r['service_id'] || '',
    }))
    .filter(t => !!t.trip_id);
}

function buildCalendar(rows: Array<Record<string, string>>): CalendarEntry[] {
  return rows
    .map(r => ({
      service_id: r['service_id'],
      monday: r['monday'] === '1',
      tuesday: r['tuesday'] === '1',
      wednesday: r['wednesday'] === '1',
      thursday: r['thursday'] === '1',
      friday: r['friday'] === '1',
      saturday: r['saturday'] === '1',
      sunday: r['sunday'] === '1',
      start_date: parseInt(r['start_date'] || '0', 10),
      end_date: parseInt(r['end_date'] || '0', 10),
    }))
    .filter(c => !!c.service_id);
}

function parseAgencyTimezone(rows: Array<Record<string, string>>): string | null {
  for (const r of rows) {
    const tz = r['agency_timezone'];
    if (tz) return tz;
  }
  return null;
}

function buildCalendarDates(rows: Array<Record<string, string>>): CalendarDateException[] {
  return rows
    .map(r => ({
      service_id: r['service_id'],
      date: parseInt(r['date'] || '0', 10),
      exception_type: parseInt(r['exception_type'] || '0', 10),
    }))
    .filter(c => !!c.service_id && c.date > 0);
}

type ProgressUpdate = { step: string; progress: number; detail?: string };

export async function ensureFreshGTFS(onProgress?: (update: ProgressUpdate) => void): Promise<{ usedCache: boolean }> {
  try {
    const report = async (step: string, progress: number, detail?: string) => {
      onProgress?.({ step, progress: Math.min(1, Math.max(0, progress)), detail });
      // Progressive console logging
      if (detail) {
        logger.info(`[GTFS Refresh] ${step} (${Math.round(progress * 100)}%): ${detail}`);
      } else {
        logger.info(`[GTFS Refresh] ${step} (${Math.round(progress * 100)}%)`);
      }
      // Yield to the event loop so React can flush state updates and re-render
      await new Promise(resolve => setTimeout(resolve, 0));
    };

    await report('Checking GTFS cache', 0.05);

    await ensureCacheDir();

    const lastFetchStr = await AsyncStorage.getItem(STORAGE_KEYS.LAST_FETCH);
    const lastFetchMs = lastFetchStr ? parseInt(lastFetchStr, 10) : 0;

    // If cache is fresh, apply and return
    if (lastFetchMs && !isOlderThanDays(lastFetchMs, 3)) {
      const routes = await readCompressedJSON<Route[]>(CACHE_FILES.routes);
      const stops = await readCompressedJSON<Stop[]>(CACHE_FILES.stops);
      const stopTimes = await readCompressedJSON<Record<string, StopTime[]>>(CACHE_FILES.stopTimes);
      const shapes = await readCompressedJSON<Record<string, Shape[]>>(CACHE_FILES.shapes);
      const trips = await readCompressedJSON<Trip[]>(CACHE_FILES.trips);
      const calendar = await readCompressedJSON<CalendarEntry[]>(CACHE_FILES.calendar);
      const calendarDates = await readCompressedJSON<CalendarDateException[]>(CACHE_FILES.calendarDates);
      let agencyTimezone: string | null = null;
      try {
        const tzInfo = await FileSystem.getInfoAsync(CACHE_FILES.agencyTimezone);
        if (tzInfo.exists) {
          agencyTimezone = await FileSystem.readAsStringAsync(CACHE_FILES.agencyTimezone) || null;
        }
      } catch { /* ignore */ }
      if (routes && stops && stopTimes) {
        gtfsParser.overrideData(routes, stops, stopTimes, shapes || {}, trips || [], calendar || [], calendarDates || [], agencyTimezone);
        shapeLoader.initialize(shapes || {});
        await report('Using cached GTFS', 1, 'Cache age < 3 days');
        return { usedCache: true };
      }
    }

    await report('GTFS.zip', 0.1, 'Fetching latest schedule');
    // Fetch and rebuild cache
    const zipBytes = await fetchZipBytes();
    await report('Download complete', 0.2);
    const files = unzipSync(zipBytes);
    await report('Unzipping archive', 0.3);

    const routesTxt = files['routes.txt'] ? strFromU8(files['routes.txt']) : '';
    const stopsTxt = files['stops.txt'] ? strFromU8(files['stops.txt']) : '';
    const stopTimesTxt = files['stop_times.txt'] ? strFromU8(files['stop_times.txt']) : '';
    const shapesTxt = files['shapes.txt'] ? strFromU8(files['shapes.txt']) : '';
    const tripsTxt = files['trips.txt'] ? strFromU8(files['trips.txt']) : '';
    const calendarTxt = files['calendar.txt'] ? strFromU8(files['calendar.txt']) : '';
    const calendarDatesTxt = files['calendar_dates.txt'] ? strFromU8(files['calendar_dates.txt']) : '';
    const agencyTxt = files['agency.txt'] ? strFromU8(files['agency.txt']) : '';

    if (!routesTxt || !stopsTxt || !stopTimesTxt) {
      logger.error('[GTFS Refresh] Missing expected GTFS files (routes/stops/stop_times)');
      throw new Error('Missing expected GTFS files (routes/stops/stop_times)');
    }

    await report('Parsing routes', 0.35);
    const routes = buildRoutes(parseCSV(routesTxt));
    await report('Parsing stops', 0.45);
    const stops = buildStops(parseCSV(stopsTxt));
    await report('Parsing trips', 0.55);
    const trips = tripsTxt ? buildTrips(parseCSV(tripsTxt)) : [];
    await report('Parsing stop times', 0.7);
    const stopTimes = buildStopTimes(parseCSV(stopTimesTxt));
    await report('Parsing shapes', 0.75);
    const shapes = shapesTxt ? buildShapes(parseCSV(shapesTxt)) : {};
    await report('Parsing calendar', 0.8);
    const calendar = calendarTxt ? buildCalendar(parseCSV(calendarTxt)) : [];
    const calendarDates = calendarDatesTxt ? buildCalendarDates(parseCSV(calendarDatesTxt)) : [];
    const agencyTimezone = agencyTxt ? parseAgencyTimezone(parseCSV(agencyTxt)) : null;

    await report('Persisting cache', 0.9, 'Writing compressed data to device storage');

    // Write compressed JSON files to filesystem (no size limits)
    await Promise.all([
      writeCompressedJSON(CACHE_FILES.routes, routes),
      writeCompressedJSON(CACHE_FILES.stops, stops),
      writeCompressedJSON(CACHE_FILES.stopTimes, stopTimes),
      writeCompressedJSON(CACHE_FILES.shapes, shapes),
      writeCompressedJSON(CACHE_FILES.trips, trips),
      writeCompressedJSON(CACHE_FILES.calendar, calendar),
      writeCompressedJSON(CACHE_FILES.calendarDates, calendarDates),
      FileSystem.writeAsStringAsync(CACHE_FILES.agencyTimezone, agencyTimezone || ''),
    ]);
    // Store only the timestamp in AsyncStorage (tiny metadata)
    await AsyncStorage.setItem(STORAGE_KEYS.LAST_FETCH, String(Date.now()));

    gtfsParser.overrideData(routes, stops, stopTimes, shapes, trips, calendar, calendarDates, agencyTimezone);

    // Initialize shape loader for map rendering
    shapeLoader.initialize(shapes);

    await report('Refresh complete', 1, 'Applied latest GTFS');
    return { usedCache: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[GTFS Refresh] GTFS sync failed: ${msg}`, err);
    onProgress?.({ step: 'GTFS refresh failed', progress: 1, detail: msg || 'Check network connection' });
    return { usedCache: true };
  }
}

export async function hasCachedGTFS(): Promise<boolean> {
  const [r, s, st] = await Promise.all([
    FileSystem.getInfoAsync(CACHE_FILES.routes),
    FileSystem.getInfoAsync(CACHE_FILES.stops),
    FileSystem.getInfoAsync(CACHE_FILES.stopTimes),
  ]);
  return r.exists && s.exists && st.exists;
}

export async function isCacheStale(): Promise<boolean> {
  const lastFetchStr = await AsyncStorage.getItem(STORAGE_KEYS.LAST_FETCH);
  const lastFetchMs = lastFetchStr ? parseInt(lastFetchStr, 10) : 0;
  return !lastFetchMs || isOlderThanDays(lastFetchMs, 3);
}

// Yield to the event loop so the JS thread can handle pending UI work
const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Load cached GTFS data into the parser (called on app startup)
 * This doesn't check staleness - just loads whatever is cached.
 * Reads compressed files from the filesystem and yields between
 * large parses to avoid blocking the UI thread.
 */
export async function loadCachedGTFS(): Promise<boolean> {
  try {
    await ensureCacheDir();

    const routes = await readCompressedJSON<Route[]>(CACHE_FILES.routes);
    const stops = await readCompressedJSON<Stop[]>(CACHE_FILES.stops);
    if (!routes || !stops) {
      logger.info('[GTFS] No cached data found');
      return false;
    }

    await yieldToUI();
    const stopTimes = await readCompressedJSON<Record<string, StopTime[]>>(CACHE_FILES.stopTimes);
    if (!stopTimes) {
      logger.info('[GTFS] No cached data found');
      return false;
    }

    await yieldToUI();
    const shapes = await readCompressedJSON<Record<string, Shape[]>>(CACHE_FILES.shapes);

    await yieldToUI();
    const trips = await readCompressedJSON<Trip[]>(CACHE_FILES.trips);
    const calendar = await readCompressedJSON<CalendarEntry[]>(CACHE_FILES.calendar);
    const calendarDates = await readCompressedJSON<CalendarDateException[]>(CACHE_FILES.calendarDates);
    let agencyTimezone: string | null = null;
    try {
      const tzInfo = await FileSystem.getInfoAsync(CACHE_FILES.agencyTimezone);
      if (tzInfo.exists) {
        agencyTimezone = await FileSystem.readAsStringAsync(CACHE_FILES.agencyTimezone) || null;
      }
    } catch { /* ignore */ }

    gtfsParser.overrideData(routes, stops, stopTimes, shapes || {}, trips || [], calendar || [], calendarDates || [], agencyTimezone);
    shapeLoader.initialize(shapes || {});
    logger.info('[GTFS] Loaded cached data on startup');
    return true;
  } catch (error) {
    logger.error('[GTFS] Failed to load cached data:', error);
    return false;
  }
}
