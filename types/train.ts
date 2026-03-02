/**
 * Core type definitions for the Tracky train tracking app
 */

export interface Train {
  id: number;
  operator: string;
  trainNumber: string;
  from: string;
  to: string;
  fromCode: string;
  toCode: string;
  departTime: string;
  arriveTime: string;
  departDayOffset?: number; // 0 = same day, 1 = next day, etc.
  arriveDayOffset?: number; // 0 = same day, 1 = next day, etc.
  date: string;
  daysAway: number;
  routeName: string;
  arriveNext?: boolean;
  intermediateStops?: IntermediateStop[];
  // Real-time data
  tripId?: string;
  realtime?: {
    position?: { lat: number; lon: number };
    delay?: number; // minutes
    status?: string;
    lastUpdated?: number;
  };
}

export interface IntermediateStop {
  time: string;
  name: string;
  code: string;
}

export interface Route {
  route_id: string;
  agency_id?: string;
  route_short_name?: string;
  route_long_name: string;
  route_type?: string;
  route_url?: string;
  route_color?: string;
  route_text_color?: string;
}

export interface Stop {
  stop_id: string;
  stop_name: string;
  stop_url?: string;
  stop_timezone?: string;
  stop_lat: number;
  stop_lon: number;
}

export interface StopTime {
  trip_id: string;
  arrival_time: string;
  departure_time: string;
  stop_id: string;
  stop_sequence: number;
  pickup_type?: number;
  drop_off_type?: number;
  timepoint?: number;
}

export interface EnrichedStopTime extends StopTime {
  stop_name: string;
  stop_code: string;
}

export interface Trip {
  route_id: string;
  trip_id: string;
  trip_short_name?: string;
  trip_headsign?: string;
  service_id: string;
}

export interface CalendarEntry {
  service_id: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  start_date: number; // YYYYMMDD integer
  end_date: number;   // YYYYMMDD integer
}

export interface CalendarDateException {
  service_id: string;
  date: number;          // YYYYMMDD integer
  exception_type: number; // 1 = added, 2 = removed
}

export interface Shape {
  shape_id: string;
  shape_pt_lat: number;
  shape_pt_lon: number;
  shape_pt_sequence: number;
}

export type SearchResultType = 'station' | 'train' | 'route';

export interface SearchResult {
  id: string;
  name: string;
  subtitle: string;
  type: SearchResultType;
  data: Stop | Trip | Route | { trip_id: string; stop_id?: string; stop_name?: string };
}

export interface FrequentlyUsedItem {
  id: string;
  name: string;
  code: string;
  subtitle: string;
  type: 'train' | 'station';
}

/**
 * Lightweight saved train reference for local storage.
 * Contains only the essential IDs needed to reconstruct the full train data.
 */
export interface SavedTrainRef {
  tripId: string; // Primary identifier for the train trip
  fromCode?: string; // Optional: user's boarding station (for segmented trips)
  toCode?: string; // Optional: user's destination station (for segmented trips)
  travelDate?: number; // Optional: travel date as timestamp (for date-specific trips)
  savedAt: number; // Timestamp when saved
}

/**
 * A completed trip stored in history.
 * Contains display-ready data since GTFS data may no longer be available for past trips.
 */
export interface CompletedTrip {
  tripId: string;
  trainNumber: string;
  routeName: string;
  from: string;
  to: string;
  fromCode: string;
  toCode: string;
  departTime: string;
  arriveTime: string;
  date: string;
  travelDate: number; // timestamp
  completedAt: number; // timestamp when moved to history
  delay?: number; // delay in minutes (positive = late, negative = early)
  distance?: number; // distance in miles
  duration?: number; // trip duration in minutes
}
