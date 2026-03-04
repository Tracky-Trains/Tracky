import type { Train, CompletedTrip } from '../types/train';

export interface NextTrainWidgetData {
  hasTrains: boolean;
  trainNumber: string;
  routeName: string;
  fromCode: string;
  toCode: string;
  departTime: string;
  arriveTime: string;
  daysAway: number;
  delayMinutes: number;
  status: string;
}

export interface TravelStatsWidgetData {
  hasTrips: boolean;
  totalTrips: number;
  totalDistanceMiles: number;
  totalDurationMinutes: number;
  uniqueStations: number;
  favoriteRoute: string;
}

const EMPTY_NEXT_TRAIN: NextTrainWidgetData = {
  hasTrains: false,
  trainNumber: '',
  routeName: '',
  fromCode: '',
  toCode: '',
  departTime: '',
  arriveTime: '',
  daysAway: 0,
  delayMinutes: 0,
  status: '',
};

const EMPTY_STATS: TravelStatsWidgetData = {
  hasTrips: false,
  totalTrips: 0,
  totalDistanceMiles: 0,
  totalDurationMinutes: 0,
  uniqueStations: 0,
  favoriteRoute: '',
};

/**
 * Pick the nearest upcoming saved train from a list.
 * Sorts by daysAway then departTime, skipping past trains (daysAway < 0).
 */
export function selectNextTrain(trains: Train[]): NextTrainWidgetData {
  const upcoming = trains.filter(t => t.daysAway >= 0);
  if (upcoming.length === 0) return EMPTY_NEXT_TRAIN;

  upcoming.sort((a, b) => {
    if (a.daysAway !== b.daysAway) return a.daysAway - b.daysAway;
    return a.departTime.localeCompare(b.departTime);
  });

  const train = upcoming[0];
  const delay = train.realtime?.delay ?? 0;
  const status = delay > 0 ? 'delayed' : delay < 0 ? 'early' : 'on-time';

  return {
    hasTrains: true,
    trainNumber: train.trainNumber,
    routeName: train.routeName,
    fromCode: train.fromCode,
    toCode: train.toCode,
    departTime: train.departTime,
    arriveTime: train.arriveTime,
    daysAway: train.daysAway,
    delayMinutes: delay,
    status,
  };
}

/**
 * Aggregate travel stats from completed trip history.
 */
export function buildTravelStats(history: CompletedTrip[]): TravelStatsWidgetData {
  if (history.length === 0) return EMPTY_STATS;

  const stations = new Set<string>();
  const routeCounts = new Map<string, number>();
  let totalDistance = 0;
  let totalDuration = 0;

  for (const trip of history) {
    stations.add(trip.fromCode);
    stations.add(trip.toCode);

    if (trip.distance != null) totalDistance += trip.distance;
    if (trip.duration != null) totalDuration += trip.duration;

    const count = routeCounts.get(trip.routeName) ?? 0;
    routeCounts.set(trip.routeName, count + 1);
  }

  let favoriteRoute = '';
  let maxCount = 0;
  for (const [route, count] of routeCounts) {
    if (count > maxCount) {
      maxCount = count;
      favoriteRoute = route;
    }
  }

  return {
    hasTrips: true,
    totalTrips: history.length,
    totalDistanceMiles: Math.round(totalDistance),
    totalDurationMinutes: Math.round(totalDuration),
    uniqueStations: stations.size,
    favoriteRoute,
  };
}
