/**
 * Station Loader Service
 * Manages efficient lazy-loading of station markers based on viewport
 * Uses spatial indexing for fast viewport-based queries
 */

import type { Stop } from '../types/train';

export interface StationBounds {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface ViewportBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface VisibleStation extends StationBounds {}

export class StationLoader {
  private stations: Map<string, StationBounds> = new Map();

  /**
   * Initialize station loader with all stops data
   * Stores station metadata for spatial queries
   */
  initialize(stops: Stop[]): void {
    this.stations.clear();

    stops.forEach(stop => {
      this.stations.set(stop.stop_id, {
        id: stop.stop_id,
        name: stop.stop_name,
        lat: stop.stop_lat,
        lon: stop.stop_lon,
      });
    });
  }

  /**
   * Get stations visible in the given viewport with padding
   * Adds padding to load stations slightly outside viewport
   */
  getVisibleStations(viewport: ViewportBounds, paddingDegrees: number = 0.15): VisibleStation[] {
    const paddedBounds = {
      minLat: viewport.minLat - paddingDegrees,
      maxLat: viewport.maxLat + paddingDegrees,
      minLon: viewport.minLon - paddingDegrees,
      maxLon: viewport.maxLon + paddingDegrees,
    };

    const visible: VisibleStation[] = [];

    // Query stations within padded viewport
    for (const station of this.stations.values()) {
      if (
        station.lat >= paddedBounds.minLat &&
        station.lat <= paddedBounds.maxLat &&
        station.lon >= paddedBounds.minLon &&
        station.lon <= paddedBounds.maxLon
      ) {
        visible.push(station);
      }
    }

    return visible;
  }

  /**
   * Get statistics about loaded stations
   */
  getStats() {
    return {
      totalStations: this.stations.size,
    };
  }

  /**
   * Look up a station by its stop_id / code
   */
  getStationByCode(code: string): StationBounds | undefined {
    return this.stations.get(code);
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.stations.clear();
  }
}

// Export singleton instance
export const stationLoader = new StationLoader();
