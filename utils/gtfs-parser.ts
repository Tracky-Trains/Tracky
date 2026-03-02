/**
 * GTFS data parser for Amtrak trains
 * Data is populated dynamically via gtfs-sync service - no bundled fallback data
 */

import type { CalendarDateException, CalendarEntry, EnrichedStopTime, Route, SearchResult, Shape, Stop, StopTime, Trip } from '../types/train';

export class GTFSParser {
  private routes: Map<string, Route> = new Map();
  private stops: Map<string, Stop> = new Map();
  private stopTimes: Map<string, StopTime[]> = new Map();
  private shapes: Map<string, Shape[]> = new Map();
  private trips: Map<string, Trip> = new Map(); // keyed by trip_id
  private tripsByNumber: Map<string, Trip[]> = new Map(); // keyed by trip_short_name for search
  private calendarEntries: Map<string, CalendarEntry> = new Map(); // keyed by service_id
  private calendarDateExceptions: Map<string, Map<number, number>> = new Map(); // service_id -> (date -> exception_type)
  private hasCalendarData: boolean = false;
  private _isLoaded: boolean = false;

  constructor() {
    // Parser starts empty - data is loaded dynamically via overrideData()
  }

  get isLoaded(): boolean {
    return this._isLoaded;
  }

  // Override parser data with dynamically fetched cache
  overrideData(
    routes: Route[],
    stops: Stop[],
    stopTimes: Record<string, StopTime[]>,
    shapes: Record<string, Shape[]> = {},
    trips: Trip[] = [],
    calendar: CalendarEntry[] = [],
    calendarDates: CalendarDateException[] = []
  ): void {
    this.routes.clear();
    this.stops.clear();
    this.stopTimes.clear();
    this.shapes.clear();
    this.trips.clear();
    this.tripsByNumber.clear();
    this.calendarEntries.clear();
    this.calendarDateExceptions.clear();

    routes.forEach(route => {
      if (route && route.route_id) this.routes.set(route.route_id, route);
    });
    stops.forEach(stop => {
      if (stop && stop.stop_id) this.stops.set(stop.stop_id, stop);
    });
    Object.entries(stopTimes).forEach(([tripId, times]) => {
      if (tripId && Array.isArray(times)) this.stopTimes.set(tripId, times);
    });
    Object.entries(shapes).forEach(([shapeId, points]) => {
      if (shapeId && Array.isArray(points)) this.shapes.set(shapeId, points);
    });
    // Populate trips maps
    trips.forEach(trip => {
      if (trip && trip.trip_id) {
        this.trips.set(trip.trip_id, trip);
        // Also index by trip_short_name for search
        if (trip.trip_short_name) {
          const existing = this.tripsByNumber.get(trip.trip_short_name) || [];
          existing.push(trip);
          this.tripsByNumber.set(trip.trip_short_name, existing);
        }
      }
    });

    // Populate calendar maps
    calendar.forEach(entry => {
      if (entry && entry.service_id) {
        this.calendarEntries.set(entry.service_id, entry);
      }
    });
    calendarDates.forEach(exception => {
      if (exception && exception.service_id) {
        let dateMap = this.calendarDateExceptions.get(exception.service_id);
        if (!dateMap) {
          dateMap = new Map();
          this.calendarDateExceptions.set(exception.service_id, dateMap);
        }
        dateMap.set(exception.date, exception.exception_type);
      }
    });
    this.hasCalendarData = this.calendarEntries.size > 0 || this.calendarDateExceptions.size > 0;

    this._isLoaded = this.routes.size > 0 && this.stops.size > 0;
  }

  getRouteName(routeId: string): string {
    return this.routes.get(routeId)?.route_long_name || 'Unknown Route';
  }

  getStopName(stopId: string): string {
    return this.stops.get(stopId)?.stop_name || stopId;
  }

  getStopCode(stopId: string): string {
    return stopId;
  }

  getStop(stopId: string): Stop | undefined {
    return this.stops.get(stopId);
  }

  getRoute(routeId: string): Route | undefined {
    return this.routes.get(routeId);
  }

  getIntermediateStops(tripId: string): EnrichedStopTime[] {
    const times = this.stopTimes.get(tripId) || [];
    // Filter out first and last stops, return intermediate stops
    return times
      .slice(1, -1)
      .map(time => ({
        ...time,
        stop_name: this.getStopName(time.stop_id),
        stop_code: time.stop_id,
      }))
      .sort((a, b) => a.stop_sequence - b.stop_sequence);
  }

  getStopTimesForTrip(tripId: string): EnrichedStopTime[] {
    const times = this.stopTimes.get(tripId) || [];
    return times
      .map(time => ({
        ...time,
        stop_name: this.getStopName(time.stop_id),
        stop_code: time.stop_id,
      }))
      .sort((a, b) => a.stop_sequence - b.stop_sequence);
  }

  /**
   * Check if a service_id is active on a given date.
   * Returns true if no calendar data is loaded (backwards compatible fallback).
   */
  isServiceActiveOnDate(serviceId: string, date: Date): boolean {
    if (!this.hasCalendarData) return true;
    if (!serviceId) return true;

    // Convert date to YYYYMMDD integer for fast comparison
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dateInt = year * 10000 + month * 100 + day;

    // Check calendar_dates exceptions first (they override base schedule)
    const exceptions = this.calendarDateExceptions.get(serviceId);
    if (exceptions) {
      const exceptionType = exceptions.get(dateInt);
      if (exceptionType === 1) return true;  // explicitly added
      if (exceptionType === 2) return false; // explicitly removed
    }

    // Check base calendar schedule
    const entry = this.calendarEntries.get(serviceId);
    if (!entry) return false; // no calendar entry and no exception = not active

    // Check date range
    if (dateInt < entry.start_date || dateInt > entry.end_date) return false;

    // Check day of week (JS: 0=Sun, 1=Mon, ..., 6=Sat)
    const dayOfWeek = date.getDay();
    switch (dayOfWeek) {
      case 0: return entry.sunday;
      case 1: return entry.monday;
      case 2: return entry.tuesday;
      case 3: return entry.wednesday;
      case 4: return entry.thursday;
      case 5: return entry.friday;
      case 6: return entry.saturday;
      default: return false;
    }
  }

  getTripsForStop(stopId: string, date?: Date): string[] {
    const trips: string[] = [];
    const seen = new Set<string>();
    this.stopTimes.forEach((times, tripId) => {
      if (times.some(t => t.stop_id === stopId) && !seen.has(tripId)) {
        // If date provided, filter by service calendar
        if (date) {
          const trip = this.trips.get(tripId);
          if (trip && !this.isServiceActiveOnDate(trip.service_id, date)) return;
        }
        trips.push(tripId);
        seen.add(tripId);
      }
    });
    return trips;
  }

  getAllRoutes(): Route[] {
    return Array.from(this.routes.values());
  }

  getAllStops(): Stop[] {
    return Array.from(this.stops.values());
  }

  getAllTripIds(): string[] {
    return Array.from(this.stopTimes.keys());
  }

  /**
   * Get trip by trip_id
   */
  getTrip(tripId: string): Trip | undefined {
    return this.trips.get(tripId);
  }

  /**
   * Get the actual train number (trip_short_name) for a trip_id
   * Falls back to extracting from trip_id if not found
   */
  getTrainNumber(tripId: string): string {
    const trip = this.trips.get(tripId);
    if (trip?.trip_short_name) {
      return trip.trip_short_name;
    }
    // Fallback: extract from trip_id (for backwards compatibility)
    const match = tripId.match(/_(\d+)$/);
    return match ? match[1] : tripId;
  }

  /**
   * Get route_id for a trip_id
   */
  getRouteIdForTrip(tripId: string): string | undefined {
    return this.trips.get(tripId)?.route_id;
  }

  /**
   * Search trips by train number (trip_short_name)
   */
  getTripsByNumber(trainNumber: string): Trip[] {
    return this.tripsByNumber.get(trainNumber) || [];
  }

  /**
   * Get all trips
   */
  getAllTrips(): Trip[] {
    return Array.from(this.trips.values());
  }

  getRawShapesData(): Record<string, any[]> {
    const result: Record<string, any[]> = {};
    this.shapes.forEach((points, shapeId) => {
      result[shapeId] = points;
    });
    return result;
  }

  search(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();
    // Support searching by AMT{train}, {name}{train}, or just {train}
    let trainNumberQuery = '';
    // If query starts with 'amt', treat as AMT{train}
    if (queryLower.startsWith('amt')) {
      trainNumberQuery = queryLower.substring(3);
    } else if (/^\d+$/.test(query)) {
      // Pure number query - search by actual train number
      trainNumberQuery = query;
    } else {
      // Try to match {name}{train} pattern (e.g., acela2150, crescent19)
      const nameTrainMatch = queryLower.match(/^([a-z]+)(\d{1,4})$/);
      if (nameTrainMatch) {
        trainNumberQuery = nameTrainMatch[2];
      }
    }

    // Search stops (stations)
    this.stops.forEach(stop => {
      if (stop.stop_name.toLowerCase().includes(queryLower)) {
        results.push({
          id: `stop-name-${stop.stop_id}`,
          name: stop.stop_name,
          subtitle: `Name contains "${query}"`,
          type: 'station',
          data: stop,
        });
      }
      // Match by stop ID (abbreviation)
      else if (stop.stop_id.toLowerCase().includes(queryLower)) {
        results.push({
          id: `stop-id-${stop.stop_id}`,
          name: stop.stop_name,
          subtitle: `Station matches "${stop.stop_id}"`,
          type: 'station',
          data: stop,
        });
      }
    });

    // Search routes
    this.routes.forEach(route => {
      if (
        route.route_long_name.toLowerCase().includes(queryLower) ||
        route.route_short_name?.toLowerCase().includes(queryLower) ||
        route.route_id.toLowerCase().includes(queryLower)
      ) {
        results.push({
          id: `route-${route.route_id}`,
          name: route.route_long_name,
          subtitle: `AMT${route.route_id}`,
          type: 'route',
          data: route,
        });
      }
    });

    // Search by actual train number using trips data
    if (trainNumberQuery) {
      const matchingTrips = this.tripsByNumber.get(trainNumberQuery) || [];
      for (const trip of matchingTrips.slice(0, 5)) {
        const routeName = this.getRouteName(trip.route_id);
        const displayName =
          routeName !== 'Unknown Route' ? `${routeName} ${trip.trip_short_name}` : `Train ${trip.trip_short_name}`;
        results.push({
          id: `train-${trip.trip_id}`,
          name: displayName,
          subtitle: trip.trip_headsign || '',
          type: 'train',
          data: { trip_id: trip.trip_id },
        });
      }
    }

    // Search trips (trains) by their stops
    this.stopTimes.forEach((times, tripId) => {
      const trainNumber = this.getTrainNumber(tripId);
      const trip = this.trips.get(tripId);
      const routeName = trip?.route_id ? this.getRouteName(trip.route_id) : '';
      const displayName =
        routeName && routeName !== 'Unknown Route' ? `${routeName} ${trainNumber}` : `Train ${trainNumber}`;

      // Check for AMT{train} or {name}{train} match (legacy support)
      const tripIdLower = tripId.toLowerCase();
      if (
        trainNumberQuery &&
        tripIdLower.endsWith(trainNumberQuery) &&
        !results.find(r => r.id === `train-${tripId}`)
      ) {
        results.push({
          id: `tripid-${tripId}`,
          name: displayName,
          subtitle: trip?.trip_headsign || '',
          type: 'train',
          data: { trip_id: tripId },
        });
      }
      const uniqueStops = new Set(times.map(t => t.stop_id));
      uniqueStops.forEach(stopId => {
        const stop = this.stops.get(stopId);
        if (stop && stop.stop_name.toLowerCase().includes(queryLower)) {
          results.push({
            id: `trip-stop-${tripId}-${stopId}`,
            name: displayName,
            subtitle: `Stops at "${stop.stop_name}"`,
            type: 'train',
            data: { trip_id: tripId, stop_id: stopId, stop_name: stop.stop_name },
          });
        }
      });
    });

    // Remove duplicates and limit results
    const seen = new Set<string>();
    return results
      .filter(result => {
        if (seen.has(result.id)) return false;
        seen.add(result.id);
        return true;
      })
      .slice(0, 20); // Limit to 20 results
  }

  getShape(shapeId: string): Shape[] | undefined {
    return this.shapes.get(shapeId);
  }

  getAllShapeIds(): string[] {
    return Array.from(this.shapes.keys());
  }

  // Get all shapes as polyline coordinates for map rendering
  getShapesForMap(): Array<{ id: string; coordinates: Array<{ latitude: number; longitude: number }> }> {
    const result: Array<{ id: string; coordinates: Array<{ latitude: number; longitude: number }> }> = [];
    this.shapes.forEach((points, shapeId) => {
      result.push({
        id: shapeId,
        coordinates: points.map(p => ({
          latitude: p.shape_pt_lat,
          longitude: p.shape_pt_lon,
        })),
      });
    });
    return result;
  }

  // Get shapes grouped by route
  getShapesByRoute(): Map<string, Array<{ id: string; coordinates: Array<{ latitude: number; longitude: number }> }>> {
    const shapesByRoute = new Map<
      string,
      Array<{ id: string; coordinates: Array<{ latitude: number; longitude: number }> }>
    >();
    // Return all shapes grouped together
    const allShapes = this.getShapesForMap();
    shapesByRoute.set('all', allShapes);
    return shapesByRoute;
  }

  /**
   * Unified search returning categorized results for the initial search bar.
   * Returns trains, routes, and stations in separate arrays.
   */
  searchUnified(query: string): { trains: SearchResult[]; routes: SearchResult[]; stations: SearchResult[] } {
    const queryLower = query.toLowerCase().trim();
    if (!queryLower) return { trains: [], routes: [], stations: [] };

    const trains: SearchResult[] = [];
    const routes: SearchResult[] = [];
    const stations: SearchResult[] = [];

    // --- Train number matching ---
    // Extract a numeric portion for train number prefix matching
    let trainNumberQuery = '';
    if (queryLower.startsWith('amt')) {
      trainNumberQuery = queryLower.substring(3);
    } else if (/^\d+$/.test(queryLower)) {
      trainNumberQuery = queryLower;
    } else {
      const nameTrainMatch = queryLower.match(/^([a-z]+)(\d{1,4})$/);
      if (nameTrainMatch) {
        trainNumberQuery = nameTrainMatch[2];
      }
    }

    if (trainNumberQuery) {
      // Prefix match: "21" matches 21, 210, 2150, etc.
      const seenNumbers = new Set<string>();
      this.tripsByNumber.forEach((trips, trainNum) => {
        if (trainNum.startsWith(trainNumberQuery) && !seenNumbers.has(trainNum)) {
          seenNumbers.add(trainNum);
          const trip = trips[0];
          if (trip) {
            const routeName = this.getRouteName(trip.route_id);
            const displayName = routeName !== 'Unknown Route'
              ? `${routeName} ${trip.trip_short_name}`
              : `Train ${trip.trip_short_name}`;
            trains.push({
              id: `train-num-${trainNum}`,
              name: displayName,
              subtitle: trip.trip_headsign || '',
              type: 'train',
              data: trip,
            });
          }
        }
      });
    }

    // Also match train numbers where the route name matches the alpha part
    if (queryLower.match(/^[a-z]/)) {
      const seenNumbers = new Set<string>(trains.map(t => {
        const trip = t.data as Trip;
        return trip.trip_short_name || '';
      }));
      this.tripsByNumber.forEach((trips, trainNum) => {
        if (seenNumbers.has(trainNum)) return;
        const trip = trips[0];
        if (!trip) return;
        const routeName = this.getRouteName(trip.route_id).toLowerCase();
        const displayName = routeName !== 'unknown route'
          ? `${this.getRouteName(trip.route_id)} ${trip.trip_short_name}`
          : `Train ${trip.trip_short_name}`;
        // Match if route name starts with query or query matches "routename + number"
        if (routeName.startsWith(queryLower) || displayName.toLowerCase().includes(queryLower)) {
          seenNumbers.add(trainNum);
          trains.push({
            id: `train-num-${trainNum}`,
            name: displayName,
            subtitle: trip.trip_headsign || '',
            type: 'train',
            data: trip,
          });
        }
      });
    }

    // --- Route matching ---
    this.routes.forEach(route => {
      if (
        route.route_long_name.toLowerCase().includes(queryLower) ||
        route.route_short_name?.toLowerCase().includes(queryLower)
      ) {
        routes.push({
          id: `route-${route.route_id}`,
          name: route.route_long_name,
          subtitle: route.route_short_name || '',
          type: 'route',
          data: route,
        });
      }
    });

    // --- Station matching ---
    this.stops.forEach(stop => {
      if (
        stop.stop_name.toLowerCase().includes(queryLower) ||
        stop.stop_id.toLowerCase().includes(queryLower)
      ) {
        stations.push({
          id: `stop-${stop.stop_id}`,
          name: stop.stop_name,
          subtitle: stop.stop_id,
          type: 'station',
          data: stop,
        });
      }
    });

    return {
      trains: trains.slice(0, 5),
      routes: routes.slice(0, 5),
      stations: stations.slice(0, 8),
    };
  }

  /**
   * Given a train number and date, find the specific Trip active on that date.
   * Falls back to the first trip for the train number if no calendar match.
   */
  getTripForTrainOnDate(trainNumber: string, date: Date): Trip | undefined {
    const trips = this.tripsByNumber.get(trainNumber);
    if (!trips || trips.length === 0) return undefined;

    // Try to find a trip whose service is active on the given date
    const activeTrip = trips.find(trip => this.isServiceActiveOnDate(trip.service_id, date));
    return activeTrip || trips[0];
  }

  /**
   * Get all unique train numbers (trip_short_name) that belong to a given route_id.
   * Returns array of { trainNumber, displayName, headsign }.
   */
  getTrainNumbersForRoute(routeId: string): Array<{ trainNumber: string; displayName: string; headsign: string }> {
    const results: Array<{ trainNumber: string; displayName: string; headsign: string }> = [];
    const seen = new Set<string>();
    const routeName = this.getRouteName(routeId);

    this.tripsByNumber.forEach((trips, trainNum) => {
      if (seen.has(trainNum)) return;
      const trip = trips.find(t => t.route_id === routeId);
      if (trip) {
        seen.add(trainNum);
        const displayName = routeName !== 'Unknown Route'
          ? `${routeName} ${trainNum}`
          : `Train ${trainNum}`;
        results.push({
          trainNumber: trainNum,
          displayName,
          headsign: trip.trip_headsign || '',
        });
      }
    });

    // Sort by train number numerically
    results.sort((a, b) => {
      const numA = parseInt(a.trainNumber, 10);
      const numB = parseInt(b.trainNumber, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.trainNumber.localeCompare(b.trainNumber);
    });

    return results;
  }

  /**
   * Search for stations only (for the two-station search flow)
   */
  searchStations(query: string): Stop[] {
    const queryLower = query.toLowerCase();
    const results: Stop[] = [];

    this.stops.forEach(stop => {
      if (stop.stop_name.toLowerCase().includes(queryLower) || stop.stop_id.toLowerCase().includes(queryLower)) {
        results.push(stop);
      }
    });

    return results.slice(0, 10);
  }

  /**
   * Find all trips that stop at both stations in sequence (fromStop before toStop)
   */
  findTripsWithStops(
    fromStopId: string,
    toStopId: string,
    date?: Date
  ): Array<{
    tripId: string;
    fromStop: EnrichedStopTime;
    toStop: EnrichedStopTime;
    intermediateStops: EnrichedStopTime[];
  }> {
    const results: Array<{
      tripId: string;
      fromStop: EnrichedStopTime;
      toStop: EnrichedStopTime;
      intermediateStops: EnrichedStopTime[];
    }> = [];

    this.stopTimes.forEach((times, tripId) => {
      // If date provided, filter by service calendar
      if (date) {
        const trip = this.trips.get(tripId);
        if (trip && !this.isServiceActiveOnDate(trip.service_id, date)) return;
      }

      const fromIdx = times.findIndex(t => t.stop_id === fromStopId);
      const toIdx = times.findIndex(t => t.stop_id === toStopId);

      // Both stops must exist and fromStop must come before toStop
      if (fromIdx !== -1 && toIdx !== -1 && fromIdx < toIdx) {
        const fromStop = times[fromIdx];
        const toStop = times[toIdx];
        const intermediateStops = times.slice(fromIdx + 1, toIdx);

        results.push({
          tripId,
          fromStop: {
            ...fromStop,
            stop_name: this.getStopName(fromStop.stop_id),
            stop_code: fromStop.stop_id,
          },
          toStop: {
            ...toStop,
            stop_name: this.getStopName(toStop.stop_id),
            stop_code: toStop.stop_id,
          },
          intermediateStops: intermediateStops.map(s => ({
            ...s,
            stop_name: this.getStopName(s.stop_id),
            stop_code: s.stop_id,
          })),
        });
      }
    });

    // Sort by departure time
    results.sort((a, b) => a.fromStop.departure_time.localeCompare(b.fromStop.departure_time));

    // Deduplicate by train number + departure time (same train on different days has different trip_ids)
    const seen = new Set<string>();
    return results.filter(result => {
      const trip = this.trips.get(result.tripId);
      const trainNumber = trip?.trip_short_name || result.tripId;
      const key = `${trainNumber}-${result.fromStop.departure_time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

// Export singleton instance
export const gtfsParser = new GTFSParser();
