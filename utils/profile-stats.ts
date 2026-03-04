/**
 * Utility functions for calculating profile statistics
 */
import type { CompletedTrip } from '../types/train';

export interface ProfileStats {
  totalTrips: number;
  totalDistance: number; // miles
  totalDuration: number; // minutes
  totalDelayMinutes: number;
  averageDelayMinutes: number;
  delayedTripsCount: number;
  uniqueStations: number;
  uniqueRoutes: number;
  mostRiddenRoute: {
    routeName: string;
    count: number;
  } | null;
}

export function calculateProfileStats(
  trips: CompletedTrip[],
  year?: number
): ProfileStats {
  // Filter by year if specified
  let filteredTrips = trips;
  if (year) {
    filteredTrips = trips.filter(trip => {
      const tripYear = new Date(trip.travelDate).getFullYear();
      return tripYear === year;
    });
  }

  const totalTrips = filteredTrips.length;
  
  // Calculate total distance
  const totalDistance = filteredTrips.reduce((sum, trip) => {
    return sum + (trip.distance || 0);
  }, 0);

  // Calculate total duration
  const totalDuration = filteredTrips.reduce((sum, trip) => {
    return sum + (trip.duration || 0);
  }, 0);

  // Calculate delay stats
  const delayedTrips = filteredTrips.filter(trip => trip.delay && trip.delay > 0);
  const totalDelayMinutes = delayedTrips.reduce((sum, trip) => {
    return sum + (trip.delay || 0);
  }, 0);
  const averageDelayMinutes = delayedTrips.length > 0 
    ? totalDelayMinutes / delayedTrips.length 
    : 0;

  // Calculate unique stations
  const stationSet = new Set<string>();
  filteredTrips.forEach(trip => {
    stationSet.add(trip.fromCode);
    stationSet.add(trip.toCode);
  });
  const uniqueStations = stationSet.size;

  // Calculate unique routes and most ridden
  const routeMap = new Map<string, number>();
  filteredTrips.forEach(trip => {
    const routeName = trip.routeName || 'Unknown';
    routeMap.set(routeName, (routeMap.get(routeName) || 0) + 1);
  });
  const uniqueRoutes = routeMap.size;

  // Find most ridden route
  let mostRiddenRoute: { routeName: string; count: number } | null = null;
  let maxCount = 0;
  routeMap.forEach((count, routeName) => {
    if (count > maxCount) {
      maxCount = count;
      mostRiddenRoute = { routeName, count };
    }
  });

  return {
    totalTrips,
    totalDistance,
    totalDuration,
    totalDelayMinutes,
    averageDelayMinutes,
    delayedTripsCount: delayedTrips.length,
    uniqueStations,
    uniqueRoutes,
    mostRiddenRoute,
  };
}

export function formatDuration(minutes: number): string {
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = Math.floor(minutes % 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${mins}m`;
  } else {
    return `${mins}m`;
  }
}

