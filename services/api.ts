/**
 * API service for fetching train data
 * Provides abstraction layer for GTFS data access and future real-time API integration
 */

import type { EnrichedStopTime, Route, SearchResult, Stop, Train } from '../types/train';
import { gtfsParser } from '../utils/gtfs-parser';
import { RealtimeService } from './realtime';
import { formatTime, formatTimeWithDayOffset, type FormattedTime } from '../utils/time-formatting';
import { extractTrainNumber } from '../utils/train-helpers';
import { logger } from '../utils/logger';

// Re-export for backwards compatibility
export { formatTime, formatTimeWithDayOffset, extractTrainNumber };
export type { FormattedTime };

/**
 * Amtrak train number to route name mapping
 * Common named trains and their number ranges
 */
const AMTRAK_ROUTE_NAMES: Record<string, string> = {
  // Acela is intentionally omitted — resolved dynamically via GTFS route_long_name
  // Long-distance trains
  '1': 'Sunset Limited',
  '2': 'Sunset Limited',
  '3': 'Southwest Chief',
  '4': 'Southwest Chief',
  '5': 'California Zephyr',
  '6': 'California Zephyr',
  '7': 'Empire Builder',
  '8': 'Empire Builder',
  '27': 'Empire Builder',
  '28': 'Empire Builder',
  '11': 'Coast Starlight',
  '14': 'Coast Starlight',
  '19': 'Crescent',
  '20': 'Crescent',
  '21': 'Texas Eagle',
  '22': 'Texas Eagle',
  '421': 'Texas Eagle',
  '422': 'Texas Eagle',
  '29': 'Capitol Limited',
  '30': 'Capitol Limited',
  '48': 'Lake Shore Limited',
  '49': 'Lake Shore Limited',
  '448': 'Lake Shore Limited',
  '449': 'Lake Shore Limited',
  '50': 'Cardinal',
  '51': 'Cardinal',
  '52': 'Auto Train',
  '53': 'Auto Train',
  '58': 'City of New Orleans',
  '59': 'City of New Orleans',
  '66': 'Palmetto',
  '67': 'Northeast Regional',
  '79': 'Carolinian',
  '80': 'Carolinian',
  '89': 'Palmetto',
  '90': 'Palmetto',
  '91': 'Silver Star',
  '92': 'Silver Star',
  '97': 'Silver Meteor',
  '98': 'Silver Meteor',
  // Keystone/Pennsylvanian
  '42': 'Pennsylvanian',
  '43': 'Pennsylvanian',
  '600': 'Keystone',
  '601': 'Keystone',
  '602': 'Keystone',
  '603': 'Keystone',
  '604': 'Keystone',
  '605': 'Keystone',
  '606': 'Keystone',
  '607': 'Keystone',
  '608': 'Keystone',
  '609': 'Keystone',
  '610': 'Keystone',
  '611': 'Keystone',
  '612': 'Keystone',
  '613': 'Keystone',
  '614': 'Keystone',
  '615': 'Keystone',
  '616': 'Keystone',
  '617': 'Keystone',
  '618': 'Keystone',
  '619': 'Keystone',
  '620': 'Keystone',
  '621': 'Keystone',
  '622': 'Keystone',
  '623': 'Keystone',
  '624': 'Keystone',
  '625': 'Keystone',
  '626': 'Keystone',
  '627': 'Keystone',
  '628': 'Keystone',
  '629': 'Keystone',
  '630': 'Keystone',
  '631': 'Keystone',
  '640': 'Keystone',
  '641': 'Keystone',
  '642': 'Keystone',
  '643': 'Keystone',
  '644': 'Keystone',
  '645': 'Keystone',
  '646': 'Keystone',
  '647': 'Keystone',
  '648': 'Keystone',
  '649': 'Keystone',
  '650': 'Keystone',
  '651': 'Keystone',
  '660': 'Keystone',
  '661': 'Keystone',
  '662': 'Keystone',
  '663': 'Keystone',
  // Pacific Surfliner
  '761': 'Pacific Surfliner',
  '762': 'Pacific Surfliner',
  '763': 'Pacific Surfliner',
  '764': 'Pacific Surfliner',
  '765': 'Pacific Surfliner',
  '766': 'Pacific Surfliner',
  '767': 'Pacific Surfliner',
  '768': 'Pacific Surfliner',
  '769': 'Pacific Surfliner',
  '770': 'Pacific Surfliner',
  '771': 'Pacific Surfliner',
  '772': 'Pacific Surfliner',
  '773': 'Pacific Surfliner',
  '774': 'Pacific Surfliner',
  '775': 'Pacific Surfliner',
  '776': 'Pacific Surfliner',
  '777': 'Pacific Surfliner',
  '778': 'Pacific Surfliner',
  '779': 'Pacific Surfliner',
  '780': 'Pacific Surfliner',
  '781': 'Pacific Surfliner',
  '782': 'Pacific Surfliner',
  '783': 'Pacific Surfliner',
  '784': 'Pacific Surfliner',
  '785': 'Pacific Surfliner',
  '786': 'Pacific Surfliner',
  '787': 'Pacific Surfliner',
  '788': 'Pacific Surfliner',
  '789': 'Pacific Surfliner',
  '790': 'Pacific Surfliner',
  '791': 'Pacific Surfliner',
  '792': 'Pacific Surfliner',
  '793': 'Pacific Surfliner',
  '794': 'Pacific Surfliner',
  '795': 'Pacific Surfliner',
  '796': 'Pacific Surfliner',
  // Cascades
  '500': 'Cascades',
  '501': 'Cascades',
  '502': 'Cascades',
  '503': 'Cascades',
  '504': 'Cascades',
  '505': 'Cascades',
  '506': 'Cascades',
  '507': 'Cascades',
  '508': 'Cascades',
  '509': 'Cascades',
  '510': 'Cascades',
  '511': 'Cascades',
  '512': 'Cascades',
  '513': 'Cascades',
  '514': 'Cascades',
  '515': 'Cascades',
  '516': 'Cascades',
  '517': 'Cascades',
  '518': 'Cascades',
  '519': 'Cascades',
  // Hiawatha
  '329': 'Hiawatha',
  '330': 'Hiawatha',
  '331': 'Hiawatha',
  '332': 'Hiawatha',
  '333': 'Hiawatha',
  '334': 'Hiawatha',
  '335': 'Hiawatha',
  '336': 'Hiawatha',
  '337': 'Hiawatha',
  '338': 'Hiawatha',
  '339': 'Hiawatha',
  '340': 'Hiawatha',
  '341': 'Hiawatha',
  '342': 'Hiawatha',
  '343': 'Hiawatha',
  '344': 'Hiawatha',
  // San Joaquins
  '701': 'San Joaquins',
  '702': 'San Joaquins',
  '703': 'San Joaquins',
  '704': 'San Joaquins',
  '705': 'San Joaquins',
  '706': 'San Joaquins',
  '707': 'San Joaquins',
  '708': 'San Joaquins',
  '709': 'San Joaquins',
  '710': 'San Joaquins',
  '711': 'San Joaquins',
  '712': 'San Joaquins',
  '713': 'San Joaquins',
  '714': 'San Joaquins',
  '715': 'San Joaquins',
  '716': 'San Joaquins',
  '717': 'San Joaquins',
  '718': 'San Joaquins',
  '719': 'San Joaquins',
  '720': 'San Joaquins',
  // Capitol Corridor
  '521': 'Capitol Corridor',
  '522': 'Capitol Corridor',
  '523': 'Capitol Corridor',
  '524': 'Capitol Corridor',
  '525': 'Capitol Corridor',
  '526': 'Capitol Corridor',
  '527': 'Capitol Corridor',
  '528': 'Capitol Corridor',
  '529': 'Capitol Corridor',
  '530': 'Capitol Corridor',
  '531': 'Capitol Corridor',
  '532': 'Capitol Corridor',
  '533': 'Capitol Corridor',
  '534': 'Capitol Corridor',
  '535': 'Capitol Corridor',
  '536': 'Capitol Corridor',
  '537': 'Capitol Corridor',
  '538': 'Capitol Corridor',
  '539': 'Capitol Corridor',
  '540': 'Capitol Corridor',
  '541': 'Capitol Corridor',
  '542': 'Capitol Corridor',
  '543': 'Capitol Corridor',
  '544': 'Capitol Corridor',
  '545': 'Capitol Corridor',
  '546': 'Capitol Corridor',
  '547': 'Capitol Corridor',
  '548': 'Capitol Corridor',
  '549': 'Capitol Corridor',
  '550': 'Capitol Corridor',
  '551': 'Capitol Corridor',
  '552': 'Capitol Corridor',
  // Vermonter
  '54': 'Vermonter',
  '55': 'Vermonter',
  '56': 'Vermonter',
  '57': 'Vermonter',
  // Ethan Allen Express
  '290': 'Ethan Allen Express',
  '291': 'Ethan Allen Express',
  '292': 'Ethan Allen Express',
  '293': 'Ethan Allen Express',
  // Downeaster
  '680': 'Downeaster',
  '681': 'Downeaster',
  '682': 'Downeaster',
  '683': 'Downeaster',
  '684': 'Downeaster',
  '685': 'Downeaster',
  '686': 'Downeaster',
  '687': 'Downeaster',
  '688': 'Downeaster',
  '689': 'Downeaster',
  '690': 'Downeaster',
  '691': 'Downeaster',
  '692': 'Downeaster',
  '693': 'Downeaster',
  '694': 'Downeaster',
  '695': 'Downeaster',
  // Adirondack
  '68': 'Adirondack',
  '69': 'Adirondack',
  // Maple Leaf
  '63': 'Maple Leaf',
  '64': 'Maple Leaf',
  // Wolverines
  '350': 'Wolverine',
  '351': 'Wolverine',
  '352': 'Wolverine',
  '353': 'Wolverine',
  '354': 'Wolverine',
  '355': 'Wolverine',
  '364': 'Wolverine',
  '365': 'Wolverine',
  // Blue Water
  '364': 'Blue Water',
  '365': 'Blue Water',
  // Pere Marquette
  '370': 'Pere Marquette',
  '371': 'Pere Marquette',
  // Illini/Saluki
  '390': 'Saluki',
  '391': 'Saluki',
  '392': 'Illini',
  '393': 'Illini',
  // Lincoln Service
  '300': 'Lincoln Service',
  '301': 'Lincoln Service',
  '302': 'Lincoln Service',
  '303': 'Lincoln Service',
  '304': 'Lincoln Service',
  '305': 'Lincoln Service',
  '306': 'Lincoln Service',
  '307': 'Lincoln Service',
  '308': 'Lincoln Service',
  '309': 'Lincoln Service',
  '310': 'Lincoln Service',
  '311': 'Lincoln Service',
  '312': 'Lincoln Service',
  '313': 'Lincoln Service',
  '314': 'Lincoln Service',
  '315': 'Lincoln Service',
  // Missouri River Runner
  '311': 'Missouri River Runner',
  '313': 'Missouri River Runner',
  '314': 'Missouri River Runner',
  '316': 'Missouri River Runner',
  // Heartland Flyer
  '821': 'Heartland Flyer',
  '822': 'Heartland Flyer',
};

/**
 * Get the route name for a train number
 * Returns the named route (e.g., "Pennsylvanian") or null if not a named train
 */
export function getRouteNameForTrainNumber(trainNumber: string): string | null {
  return AMTRAK_ROUTE_NAMES[trainNumber] || null;
}

/**
 * Get display info for a train (route name and number formatted for display)
 * Examples: "Pennsylvanian 43", "Acela 2151", "Amtrak 171"
 */
export function getTrainDisplayName(tripId: string): {
  routeName: string | null;
  trainNumber: string;
  displayName: string;
} {
  const trainNumber = extractTrainNumber(tripId);

  // First try the hardcoded mapping (covers named trains with friendly names)
  let routeName = getRouteNameForTrainNumber(trainNumber);

  // If not in mapping, try to get from GTFS route data
  if (!routeName) {
    const routeId = gtfsParser.getRouteIdForTrip(tripId);
    if (routeId) {
      const route = gtfsParser.getRoute(routeId);
      if (route?.route_long_name && route.route_long_name !== 'Unknown Route') {
        routeName = route.route_long_name;
      }
    }
  }

  const displayName = routeName ? `${routeName} ${trainNumber}` : `Amtrak ${trainNumber}`;

  return { routeName, trainNumber, displayName };
}

export class TrainAPIService {
  /**
   * Search for trains, routes, and stations
   */
  static async search(query: string): Promise<SearchResult[]> {
    try {
      // In a real app, this would be an API call
      // For now, use the local GTFS parser
      return gtfsParser.search(query);
    } catch (error) {
      logger.error('Error searching:', error);
      return [];
    }
  }

  /**
   * Get all available routes
   */
  static async getRoutes(): Promise<Route[]> {
    try {
      return gtfsParser.getAllRoutes();
    } catch (error) {
      logger.error('Error fetching routes:', error);
      return [];
    }
  }

  /**
   * Get all available stops/stations
   */
  static async getStops(): Promise<Stop[]> {
    try {
      return gtfsParser.getAllStops();
    } catch (error) {
      logger.error('Error fetching stops:', error);
      return [];
    }
  }

  /**
   * Get train details for a specific trip
   */
  static async getTrainDetails(tripId: string): Promise<Train | null> {
    try {
      const stopTimes = gtfsParser.getStopTimesForTrip(tripId);

      if (stopTimes.length === 0) {
        return null;
      }

      const firstStop = stopTimes[0];
      const lastStop = stopTimes[stopTimes.length - 1];

      // Get proper train number and route name
      const { routeName, trainNumber } = getTrainDisplayName(tripId);

      // Format times with day offset info
      const departFormatted = formatTimeWithDayOffset(firstStop.departure_time);
      const arriveFormatted = formatTimeWithDayOffset(lastStop.arrival_time);

      const train: Train = {
        id: parseInt(tripId) || Date.now(),
        operator: 'Amtrak',
        trainNumber: trainNumber,
        from: firstStop.stop_name,
        to: lastStop.stop_name,
        fromCode: firstStop.stop_id,
        toCode: lastStop.stop_id,
        departTime: departFormatted.time,
        arriveTime: arriveFormatted.time,
        departDayOffset: departFormatted.dayOffset,
        arriveDayOffset: arriveFormatted.dayOffset,
        date: 'Today',
        daysAway: 0,
        routeName: routeName || '',
        tripId: tripId,
        intermediateStops: stopTimes.slice(1, -1).map(stop => {
          const formatted = formatTimeWithDayOffset(stop.departure_time);
          return {
            time: formatted.time,
            name: stop.stop_name,
            code: stop.stop_id,
          };
        }),
      };

      // Fetch real-time data - try both trip ID and extracted train number
      await this.enrichWithRealtimeData(train);

      return train;
    } catch (error) {
      logger.error('Error fetching train details:', error);
      return null;
    }
  }

  /**
   * Enrich a train object with real-time position and delay data
   */
  private static async enrichWithRealtimeData(train: Train): Promise<void> {
    try {
      const position = await RealtimeService.getPositionForTrip(train.tripId || train.trainNumber);
      const delay = await RealtimeService.getDelayForStop(train.tripId || train.trainNumber, train.fromCode);

      train.realtime = {
        position: position ? { lat: position.latitude, lon: position.longitude } : undefined,
        delay: delay ?? undefined,
        status: RealtimeService.formatDelay(delay),
        lastUpdated: position?.timestamp,
      };
    } catch (realtimeError) {
      logger.warn('Could not fetch real-time data:', realtimeError);
    }
  }

  /**
   * Get trains for a specific station
   */
  static async getTrainsForStation(stopId: string, date?: Date): Promise<Train[]> {
    try {
      const tripIds = gtfsParser.getTripsForStop(stopId, date);
      const trains = await Promise.all(tripIds.map(tripId => this.getTrainDetails(tripId)));
      return trains.filter((train): train is Train => train !== null);
    } catch (error) {
      logger.error('Error fetching trains for station:', error);
      return [];
    }
  }

  /**
   * Get stop times for a specific trip
   */
  static async getStopTimesForTrip(tripId: string): Promise<EnrichedStopTime[]> {
    try {
      return gtfsParser.getStopTimesForTrip(tripId);
    } catch (error) {
      logger.error('Error fetching stop times:', error);
      return [];
    }
  }

  /**
   * Refresh real-time data for a train
   */
  static async refreshRealtimeData(train: Train): Promise<Train> {
    if (!train.tripId && !train.trainNumber) return train;

    const updatedTrain = { ...train };
    await this.enrichWithRealtimeData(updatedTrain);
    return updatedTrain;
  }

  /**
   * Get all trains currently active with real-time positions
   * Useful for displaying live trains on a map
   */
  static async getActiveTrains(): Promise<Train[]> {
    try {
      const activeTrains = await RealtimeService.getAllActiveTrains();
      const trains: Train[] = [];

      for (const { trainNumber, position } of activeTrains) {
        // Try to get train details from GTFS
        let train = await this.getTrainDetails(trainNumber);

        // If not found in GTFS, create a minimal train object
        if (!train) {
          train = {
            id: parseInt(trainNumber) || 0,
            operator: 'AMTK',
            trainNumber: trainNumber,
            from: 'Unknown',
            to: 'Unknown',
            fromCode: '',
            toCode: '',
            departTime: '',
            arriveTime: '',
            date: 'Today',
            daysAway: 0,
            routeName: `Train ${trainNumber}`,
            tripId: position.trip_id,
            realtime: {
              position: { lat: position.latitude, lon: position.longitude },
              lastUpdated: position.timestamp,
              status: 'Live',
            },
          };
        }

        trains.push(train);
      }

      return trains;
    } catch (error) {
      logger.error('Error fetching active trains:', error);
      return [];
    }
  }
}
