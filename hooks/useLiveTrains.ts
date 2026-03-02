/**
 * Hook for fetching all live trains from GTFS-RT feed
 * Returns an array of all currently active trains with their positions
 */

import { useCallback, useEffect, useState } from 'react';
import { RealtimeService } from '../services/realtime';
import { getTrainDisplayName } from '../services/api';
import { logger } from '../utils/logger';

export interface LiveTrain {
  trainNumber: string;
  tripId: string;
  position: {
    lat: number;
    lon: number;
    bearing?: number;
    speed?: number;
  };
  routeName: string | null;
  timestamp: number;
}

/**
 * Fetch all live trains from the GTFS-RT feed
 * @param intervalMs - Refresh interval in milliseconds (default: 15000ms)
 * @param enabled - Whether to enable polling (default: true)
 */
export function useLiveTrains(intervalMs: number = 15000, enabled: boolean = true) {
  const [liveTrains, setLiveTrains] = useState<LiveTrain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const fetchLiveTrains = useCallback(async () => {
    try {
      const activeTrains = await RealtimeService.getAllActiveTrains();

      const trains: LiveTrain[] = activeTrains.map(({ trainNumber, position }) => {
        const { routeName } = getTrainDisplayName(position.trip_id);
        return {
          trainNumber,
          tripId: position.trip_id,
          position: {
            lat: position.latitude,
            lon: position.longitude,
            bearing: position.bearing,
            speed: position.speed,
          },
          routeName,
          timestamp: position.timestamp,
        };
      });

      setLiveTrains(trains);
      setLastUpdated(Date.now());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch live trains'));
      logger.error('Error fetching live trains:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    if (!enabled) return;
    fetchLiveTrains();
  }, [fetchLiveTrains, enabled]);

  // Periodic refresh
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(fetchLiveTrains, intervalMs);
    return () => clearInterval(interval);
  }, [fetchLiveTrains, intervalMs, enabled]);

  // Manual refresh function
  const refresh = useCallback(() => {
    RealtimeService.clearCache();
    return fetchLiveTrains();
  }, [fetchLiveTrains]);

  return {
    liveTrains,
    loading,
    error,
    lastUpdated,
    refresh,
    trainCount: liveTrains.length,
  };
}
