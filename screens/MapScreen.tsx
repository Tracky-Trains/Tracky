import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import MapView, { PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AnimatedRoute } from '../components/map/AnimatedRoute';
import { AnimatedStationMarker } from '../components/map/AnimatedStationMarker';
import { LiveTrainMarker } from '../components/map/LiveTrainMarker';
import MapSettingsPill, { MapType, RouteMode, StationMode, TrainMode } from '../components/map/MapSettingsPill';
import DepartureBoardModal from '../components/ui/departure-board-modal';
import ProfileModal from '../components/ui/ProfileModal';
import { RefreshBubble } from '../components/ui/RefreshBubble';
import SettingsModal from '../components/ui/SettingsModal';
import SlideUpModal from '../components/ui/slide-up-modal';
import TrainDetailModal from '../components/ui/train-detail-modal';
import { AppColors } from '../constants/theme';
import { GTFSRefreshProvider, useGTFSRefresh } from '../context/GTFSRefreshContext';
import { ModalProvider, useModalContext } from '../context/ModalContext';
import { TrainProvider, useTrainContext } from '../context/TrainContext';
import { UnitsProvider } from '../context/UnitsContext';
import { useBatchedItems } from '../hooks/useBatchedItems';
import { useLiveTrains } from '../hooks/useLiveTrains';
import { useRealtime } from '../hooks/useRealtime';
import { useShapes } from '../hooks/useShapes';
import { useStations } from '../hooks/useStations';
import { TrainAPIService } from '../services/api';
import type { ViewportBounds } from '../services/shape-loader';
import { TrainStorageService } from '../services/storage';
import type { Stop, Train } from '../types/train';
import { ClusteringConfig } from '../utils/clustering-config';
import { gtfsParser } from '../utils/gtfs-parser';
import { light as hapticLight } from '../utils/haptics';
import { logger } from '../utils/logger';
import { getRouteColor, getStrokeWidthForZoom } from '../utils/route-colors';
import { clusterStations, getStationAbbreviation } from '../utils/station-clustering';
import { clusterTrains } from '../utils/train-clustering';
import { ModalContent, ModalContentHandle } from './ModalContent';
import { styles } from './styles';

interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

// Convert map region to viewport bounds for lazy loading
function regionToViewportBounds(region: MapRegion): ViewportBounds {
  return {
    minLat: region.latitude - region.latitudeDelta / 2,
    maxLat: region.latitude + region.latitudeDelta / 2,
    minLon: region.longitude - region.longitudeDelta / 2,
    maxLon: region.longitude + region.longitudeDelta / 2,
  };
}

/**
 * Calculate latitude offset for map centering based on modal state.
 * When modal is at 50%, center point at 20% from top (40% of visible area).
 * When no modal or fullscreen, center normally (no offset).
 */
function getLatitudeOffsetForModal(latitudeDelta: number, modalSnap: 'min' | 'half' | 'max' | null): number {
  if (modalSnap === 'half') {
    // Modal covers 50% of screen, visible map is top 50%
    // To place point at 20% from top of screen = 40% of visible area
    // Offset = 30% of latitudeDelta (move center down so point appears higher)
    return latitudeDelta * 0.3;
  }
  // No offset for fullscreen modal, collapsed modal, or no modal
  return 0;
}

function LoadingOverlay({ visible }: { visible: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    if (!visible) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }
  }, [visible, opacity]);

  if (!mounted) return null;

  return (
    <Animated.View style={[loadingStyles.overlay, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
      <Ionicons name="train" size={128} color="rgba(255, 255, 255, 0.25)" style={loadingStyles.icon} />
      <Text style={loadingStyles.copyright}>Tracky - Made with &lt;3 by Jason</Text>
    </Animated.View>
  );
}

function MapScreenInner() {
  const mapRef = useRef<MapView>(null);
  const modalContentRef = useRef<ModalContentHandle>(null);
  const { triggerRefresh, isLoadingCache } = useGTFSRefresh();

  // Use centralized modal context
  const {
    showMainContent,
    showTrainDetailContent,
    showDepartureBoardContent,
    showProfileContent,
    showSettingsContent,
    mainModalRef,
    detailModalRef,
    departureBoardRef,
    profileModalRef,
    settingsModalRef,
    modalData,
    navigateToTrain,
    navigateToStation,
    navigateToProfile,
    navigateToSettings,
    navigateToMain,
    goBack,
    handleModalDismissed,
    handleSnapChange,
    getInitialSnap,
    currentSnap,
  } = useModalContext();
  const [region, setRegion] = useState<MapRegion | null>(null);
  // Viewport bounds for lazy loading (shapes are progressively rendered by useShapes)
  const [viewportBounds, setViewportBounds] = useState<ViewportBounds | null>(null);
  // Debounced latitudeDelta for train clustering - prevents crash on rapid zoom
  const [debouncedLatDelta, setDebouncedLatDelta] = useState<number>(1);
  const trainDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapType, setMapType] = useState<MapType>('standard');
  const [routeMode, setRouteMode] = useState<RouteMode>('visible');
  const [stationMode, setStationMode] = useState<StationMode>('auto');
  const [trainMode, setTrainMode] = useState<TrainMode>('all');
  const { savedTrains, setSavedTrains, selectedTrain, setSelectedTrain } = useTrainContext();
  const insets = useSafeAreaInsets();

  // Use lazy-loaded stations and shapes based on viewport
  const stations = useStations(viewportBounds ?? undefined);
  const { visibleShapes } = useShapes(viewportBounds ?? undefined);

  // Fetch all live trains from GTFS-RT (only when trainMode is 'all')
  const { liveTrains } = useLiveTrains(15000, trainMode === 'all');

  // Memoize clustered trains to avoid expensive reclustering on every render
  const clusteredLiveTrains = useMemo(() => {
    if (trainMode !== 'all') return [];
    const trainsWithSavedStatus = liveTrains.map(train => {
      const savedTrain = savedTrains.find(
        saved =>
          saved.daysAway === 0 &&
          (saved.trainNumber === train.trainNumber || (saved.tripId && saved.tripId.includes(train.trainNumber)))
      );
      return {
        tripId: train.tripId,
        trainNumber: train.trainNumber,
        routeName: train.routeName,
        position: train.position,
        isSaved: !!savedTrain,
        savedTrain,
      };
    });
    return clusterTrains(trainsWithSavedStatus, debouncedLatDelta);
  }, [liveTrains, savedTrains, debouncedLatDelta, trainMode]);

  const clusteredSavedTrains = useMemo(() => {
    if (trainMode !== 'saved') return [];
    const savedTrainsWithPosition = savedTrains
      .filter(train => train.realtime?.position)
      .map(train => ({
        tripId: train.tripId || `saved-${train.id}`,
        trainNumber: train.trainNumber,
        routeName: train.routeName,
        position: {
          lat: train.realtime!.position!.lat,
          lon: train.realtime!.position!.lon,
        },
        isSaved: true,
        originalTrain: train,
      }));
    return clusterTrains(savedTrainsWithPosition, debouncedLatDelta);
  }, [savedTrains, debouncedLatDelta, trainMode]);

  // Handle train selection from list - animate map if has position, navigate to detail
  const handleTrainSelect = useCallback(
    (train: Train) => {
      setSelectedTrain(train);

      // If train has realtime position, animate map to that location
      const fromMarker = !!train.realtime?.position;
      if (train.realtime?.position) {
        const latitudeDelta = 0.05;
        const latitudeOffset = getLatitudeOffsetForModal(latitudeDelta, 'half');
        mapRef.current?.animateToRegion(
          {
            latitude: train.realtime.position.lat - latitudeOffset,
            longitude: train.realtime.position.lon,
            latitudeDelta: latitudeDelta,
            longitudeDelta: 0.05,
          },
          500
        );
      }

      navigateToTrain(train, { fromMarker });
    },
    [setSelectedTrain, navigateToTrain]
  );

  // Handle train marker press on the map - center map on train and show detail at 50%
  const handleTrainMarkerPress = useCallback(
    (train: Train, lat: number, lon: number) => {
      hapticLight();
      // Center map on train position with offset for 50% modal
      const latitudeDelta = 0.05;
      const latitudeOffset = getLatitudeOffsetForModal(latitudeDelta, 'half');
      mapRef.current?.animateToRegion(
        {
          latitude: lat - latitudeOffset,
          longitude: lon,
          latitudeDelta: latitudeDelta,
          longitudeDelta: 0.05,
        },
        500
      );

      setSelectedTrain(train);
      navigateToTrain(train, { fromMarker: true });
    },
    [setSelectedTrain, navigateToTrain]
  );

  // Handle live train marker press - zoom immediately, fetch train details in parallel
  const handleLiveTrainMarkerPress = useCallback(
    async (tripId: string, lat: number, lon: number) => {
      hapticLight();
      // Start map zoom immediately — don't wait for API
      const latitudeDelta = 0.05;
      const latitudeOffset = getLatitudeOffsetForModal(latitudeDelta, 'half');
      mapRef.current?.animateToRegion(
        {
          latitude: lat - latitudeOffset,
          longitude: lon,
          latitudeDelta,
          longitudeDelta: 0.05,
        },
        500
      );

      try {
        const train = await TrainAPIService.getTrainDetails(tripId);
        if (train) {
          setSelectedTrain(train);
          navigateToTrain(train, { fromMarker: true });
        }
      } catch (error) {
        logger.error('Error fetching train details:', error);
      }
    },
    [setSelectedTrain, navigateToTrain]
  );

  // Handle station pin press - show departure board
  const handleStationPress = useCallback(
    (cluster: {
      id: string;
      lat: number;
      lon: number;
      isCluster: boolean;
      stations: Array<{ id: string; name: string; lat: number; lon: number }>;
    }) => {
      hapticLight();
      // If it's a cluster, just zoom in
      if (cluster.isCluster) {
        mapRef.current?.animateToRegion(
          {
            latitude: cluster.lat,
            longitude: cluster.lon,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          },
          500
        );
        return;
      }

      // Get the station data
      const stationData = cluster.stations[0];
      const stop: Stop = {
        stop_id: stationData.id,
        stop_name: stationData.name,
        stop_lat: stationData.lat,
        stop_lon: stationData.lon,
      };

      // Zoom to station immediately
      const latitudeDelta = 0.05;
      const latitudeOffset = getLatitudeOffsetForModal(latitudeDelta, 'half');
      mapRef.current?.animateToRegion(
        {
          latitude: stationData.lat - latitudeOffset,
          longitude: stationData.lon,
          latitudeDelta,
          longitudeDelta: 0.05,
        },
        500
      );

      navigateToStation(stop);
    },
    [navigateToStation]
  );

  // Handle train selection from departure board
  // If train has a live position, zoom to it and open at half; otherwise open full
  const handleDepartureBoardTrainSelect = useCallback(
    (train: Train) => {
      setSelectedTrain(train);
      const hasPosition = !!train.realtime?.position;

      if (hasPosition) {
        const latitudeDelta = 0.05;
        const latitudeOffset = getLatitudeOffsetForModal(latitudeDelta, 'half');
        mapRef.current?.animateToRegion(
          {
            latitude: train.realtime!.position!.lat - latitudeOffset,
            longitude: train.realtime!.position!.lon,
            latitudeDelta,
            longitudeDelta: 0.05,
          },
          500
        );
      }

      navigateToTrain(train, { fromMarker: hasPosition, returnTo: 'departureBoard' });
    },
    [setSelectedTrain, navigateToTrain]
  );

  // Handle saving train from departure board swipe
  const handleSaveTrainFromBoard = useCallback(
    async (train: Train): Promise<boolean> => {
      if (!train.tripId) return false;
      const saved = await TrainStorageService.saveTrain(train);
      if (saved) {
        const updatedTrains = await TrainStorageService.getSavedTrains();
        setSavedTrains(updatedTrains);
      }
      return saved;
    },
    [setSavedTrains]
  );

  // Handle close button on departure board
  const handleDepartureBoardClose = useCallback(() => {
    navigateToMain();
  }, [navigateToMain]);

  // Handle detail modal close
  const handleDetailModalClose = useCallback(() => {
    goBack();
  }, [goBack]);

  // Handle train-to-train navigation from detail modal
  const handleTrainToTrainNavigation = useCallback(
    (train: Train) => {
      setSelectedTrain(train);
      navigateToTrain(train, { fromMarker: false });
    },
    [setSelectedTrain, navigateToTrain]
  );

  // Handle station selection from train detail - navigate to departure board
  const handleStationSelectFromDetail = useCallback(
    (stationCode: string, lat: number, lon: number) => {
      // Animate map to station with offset for 50% modal
      const latitudeDelta = 0.02;
      const latitudeOffset = getLatitudeOffsetForModal(latitudeDelta, 'half');
      mapRef.current?.animateToRegion(
        {
          latitude: lat - latitudeOffset,
          longitude: lon,
          latitudeDelta: latitudeDelta,
          longitudeDelta: 0.02,
        },
        500
      );

      // Create a Stop object and navigate
      const stop: Stop = {
        stop_id: stationCode,
        stop_name: gtfsParser.getStopName(stationCode),
        stop_lat: lat,
        stop_lon: lon,
      };
      navigateToStation(stop);
    },
    [navigateToStation]
  );

  // Get user location on mount
  React.useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const location = await Location.getCurrentPositionAsync({});
          logger.debug(`[MapScreen] User location: ${location.coords.latitude.toFixed(3)}, ${location.coords.longitude.toFixed(3)}`);
          setRegion({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          });
        } else {
          logger.info('[MapScreen] Location permission denied, using fallback');
          // Fallback to San Francisco if permission denied
          setRegion({
            latitude: 37.78825,
            longitude: -122.4324,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          });
        }
      } catch (error) {
        logger.error('Error getting initial location:', error);
        // Fallback to San Francisco on error
        setRegion({
          latitude: 37.78825,
          longitude: -122.4324,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        });
      }
    })();
  }, []);

  // Track when GTFS data is loaded
  const [gtfsLoaded, setGtfsLoaded] = React.useState(gtfsParser.isLoaded);

  // Poll for GTFS loaded state
  React.useEffect(() => {
    if (gtfsLoaded) return;

    const interval = setInterval(() => {
      if (gtfsParser.isLoaded) {
        logger.info('[MapScreen] GTFS data ready');
        setGtfsLoaded(true);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [gtfsLoaded]);

  // Load saved trains after GTFS is ready
  React.useEffect(() => {
    if (!gtfsLoaded) return;

    (async () => {
      const trains = await TrainStorageService.getSavedTrains();
      logger.debug(`[MapScreen] Loading ${trains.length} saved trains with realtime data`);
      const trainsWithRealtime = await Promise.all(trains.map(train => TrainAPIService.refreshRealtimeData(train)));
      setSavedTrains(trainsWithRealtime);
    })();
  }, [setSavedTrains, gtfsLoaded]);

  useRealtime(savedTrains, setSavedTrains, 20000);

  // Handle region changes with throttled region updates and debounced viewport bounds
  const lastRegionUpdateRef = useRef<number>(0);
  const pendingRegionRef = useRef<MapRegion | null>(null);
  const regionThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRegionChangeComplete = useCallback((newRegion: MapRegion) => {
    const now = Date.now();
    const THROTTLE_MS = 100; // Throttle region state updates

    // Store pending region for deferred update
    pendingRegionRef.current = newRegion;

    // Throttle setRegion calls to reduce re-renders during fast movement
    if (now - lastRegionUpdateRef.current >= THROTTLE_MS) {
      lastRegionUpdateRef.current = now;
      setRegion(newRegion);
    } else if (!regionThrottleTimerRef.current) {
      // Schedule a deferred update to catch the final position
      regionThrottleTimerRef.current = setTimeout(() => {
        regionThrottleTimerRef.current = null;
        if (pendingRegionRef.current) {
          lastRegionUpdateRef.current = Date.now();
          setRegion(pendingRegionRef.current);
        }
      }, THROTTLE_MS);
    }

    // Debounce viewport bounds to avoid cascading downstream recomputation on every frame
    if (viewportDebounceRef.current) {
      clearTimeout(viewportDebounceRef.current);
    }
    viewportDebounceRef.current = setTimeout(() => {
      setViewportBounds(regionToViewportBounds(newRegion));
    }, 150);

    // Debounce train clustering latitudeDelta to avoid expensive reclustering during fast zoom
    if (trainDebounceRef.current) {
      clearTimeout(trainDebounceRef.current);
    }
    trainDebounceRef.current = setTimeout(() => {
      setDebouncedLatDelta(newRegion.latitudeDelta);
    }, 300); // 300ms debounce for train clustering
  }, []);

  // Initialize viewport bounds when region is first set
  React.useEffect(() => {
    if (region && !viewportBounds) {
      setViewportBounds(regionToViewportBounds(region));
    }
  }, [region, viewportBounds]);

  // Cleanup timers on unmount
  React.useEffect(() => {
    return () => {
      if (regionThrottleTimerRef.current) {
        clearTimeout(regionThrottleTimerRef.current);
      }
      if (trainDebounceRef.current) {
        clearTimeout(trainDebounceRef.current);
      }
      if (viewportDebounceRef.current) {
        clearTimeout(viewportDebounceRef.current);
      }
    };
  }, []);

  const handleRecenter = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return;
      }
      const location = await Location.getCurrentPositionAsync({});
      const latitudeDelta = 0.05;
      const latitudeOffset = getLatitudeOffsetForModal(latitudeDelta, currentSnap);
      mapRef.current?.animateToRegion(
        {
          latitude: location.coords.latitude - latitudeOffset,
          longitude: location.coords.longitude,
          latitudeDelta: latitudeDelta,
          longitudeDelta: 0.05,
        },
        500
      );
    } catch (error) {
      logger.error('Error getting location:', error);
    }
  };

  // Calculate dynamic stroke width based on zoom level
  const baseStrokeWidth = useMemo(() => {
    return getStrokeWidthForZoom(debouncedLatDelta);
  }, [debouncedLatDelta]);

  // Routes are always visible (no zoom-based fading)
  const shouldRenderRoutes = routeMode !== 'hidden';

  // Cluster stations based on zoom level and station mode
  const stationClusters = useMemo(() => {
    if (stationMode === 'hidden') return [];
    if (stationMode === 'all') {
      // Return all stations without clustering
      return stations.map(s => ({
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        isCluster: false,
        stations: [s],
      }));
    }
    // 'auto' mode - use clustering
    return clusterStations(stations, debouncedLatDelta);
  }, [stations, debouncedLatDelta, stationMode]);

  // Progressive batching — drip-feed markers onto the map like routes do
  const batchedStationClusters = useBatchedItems(stationClusters, 15, 40);
  const batchedLiveTrains = useBatchedItems(clusteredLiveTrains, 12, 50);
  const batchedSavedTrains = useBatchedItems(clusteredSavedTrains, 12, 50);

  // Don't render until we have a region
  if (!region) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: AppColors.primary }}>Loading map...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapType={mapType}
        initialRegion={region}
        showsUserLocation={true}
        showsTraffic={false}
        showsIndoors={true}
        userLocationAnnotationTitle="Your Location"
        provider={PROVIDER_DEFAULT}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {shouldRenderRoutes &&
          visibleShapes.map(shape => {
            const colorScheme = getRouteColor(shape.id);
            return (
              <AnimatedRoute
                key={shape.id}
                id={shape.id}
                coordinates={shape.coordinates}
                strokeColor={colorScheme.stroke}
                strokeWidth={Math.max(2, baseStrokeWidth)}
                zoomOpacity={colorScheme.opacity}
              />
            );
          })}

        {batchedStationClusters.map(cluster => {
          // Show full name when zoomed in enough
          const showFullName = !cluster.isCluster && debouncedLatDelta < ClusteringConfig.fullNameThreshold;
          const displayName = cluster.isCluster
            ? `${cluster.stations.length}+`
            : showFullName
              ? cluster.stations[0].name
              : getStationAbbreviation(cluster.stations[0].id, cluster.stations[0].name);
          return (
            <AnimatedStationMarker
              key={cluster.id}
              cluster={cluster}
              showFullName={showFullName}
              displayName={displayName}
              onPress={() => {
                // Center map on station with offset for 50% modal (departure board opens at half)
                const latitudeDelta = 0.02;
                const latitudeOffset = getLatitudeOffsetForModal(latitudeDelta, 'half');
                mapRef.current?.animateToRegion(
                  {
                    latitude: cluster.lat - latitudeOffset,
                    longitude: cluster.lon,
                    latitudeDelta: latitudeDelta,
                    longitudeDelta: 0.02,
                  },
                  500
                );
                // Show departure board
                handleStationPress(cluster);
              }}
            />
          );
        })}

        {/* Render saved trains when mode is 'saved' */}
        {trainMode === 'saved' &&
          batchedSavedTrains.map(cluster => (
            <LiveTrainMarker
              key={cluster.id}
              trainNumber={cluster.trainNumber || ''}
              routeName={cluster.routeName || null}
              coordinate={{
                latitude: cluster.lat,
                longitude: cluster.lon,
              }}
              isSaved={true}
              isCluster={cluster.isCluster}
              clusterCount={cluster.trains.length}
              onPress={() => {
                if (!cluster.isCluster && cluster.trains[0]?.originalTrain) {
                  handleTrainMarkerPress(cluster.trains[0].originalTrain, cluster.lat, cluster.lon);
                }
              }}
            />
          ))}

        {/* Render all live trains when mode is 'all' */}
        {trainMode === 'all' &&
          batchedLiveTrains.map(cluster => (
            <LiveTrainMarker
              key={cluster.id}
              trainNumber={cluster.trainNumber || ''}
              routeName={cluster.routeName || null}
              coordinate={{
                latitude: cluster.lat,
                longitude: cluster.lon,
              }}
              isSaved={cluster.isSaved}
              isCluster={cluster.isCluster}
              clusterCount={cluster.trains.length}
              onPress={() => {
                if (!cluster.isCluster && cluster.trains[0]) {
                  const trainData = cluster.trains[0];
                  // If it's a saved train, use its data directly
                  if (trainData.savedTrain && trainData.savedTrain.realtime?.position) {
                    handleTrainMarkerPress(trainData.savedTrain, cluster.lat, cluster.lon);
                  } else {
                    // Fetch train details for non-saved trains
                    handleLiveTrainMarkerPress(trainData.tripId, cluster.lat, cluster.lon);
                  }
                }
              }}
            />
          ))}
      </MapView>

      <RefreshBubble />

      <MapSettingsPill
        top={insets.top + 16}
        routeMode={routeMode}
        setRouteMode={setRouteMode}
        stationMode={stationMode}
        setStationMode={setStationMode}
        mapType={mapType}
        setMapType={setMapType}
        trainMode={trainMode}
        setTrainMode={setTrainMode}
        onRecenter={handleRecenter}
      />

      {/* Main modal - always mounted, content conditional */}
      <SlideUpModal
        ref={mainModalRef}
        minSnapPercent={0.35}
        initialSnap={savedTrains.length === 0 ? 'min' : 'half'}
        onDismiss={() => handleModalDismissed('main')}
        onSnapChange={handleSnapChange}
      >
        {showMainContent && (
          <ModalContent
            ref={modalContentRef}
            onTrainSelect={train => {
              if (train) {
                handleTrainSelect(train);
              }
            }}
            onOpenProfile={() => navigateToProfile()}
          />
        )}
      </SlideUpModal>

      {/* Detail modal - always mounted, starts hidden, content conditional */}
      <SlideUpModal
        ref={detailModalRef}
        minSnapPercent={0.15}
        initialSnap={getInitialSnap('trainDetail')}
        startHidden
        onDismiss={() => handleModalDismissed('trainDetail')}
        onSnapChange={handleSnapChange}
      >
        {showTrainDetailContent && selectedTrain && (
          <TrainDetailModal
            train={selectedTrain}
            onClose={handleDetailModalClose}
            onStationSelect={handleStationSelectFromDetail}
            onTrainSelect={handleTrainToTrainNavigation}
          />
        )}
      </SlideUpModal>

      {/* Departure board modal - always mounted, starts hidden, content conditional */}
      <SlideUpModal
        ref={departureBoardRef}
        minSnapPercent={0.15}
        initialSnap={getInitialSnap('departureBoard')}
        startHidden
        onDismiss={() => handleModalDismissed('departureBoard')}
        onSnapChange={handleSnapChange}
      >
        {showDepartureBoardContent && modalData.station && (
          <DepartureBoardModal
            station={modalData.station}
            onClose={handleDepartureBoardClose}
            onTrainSelect={handleDepartureBoardTrainSelect}
            onSaveTrain={handleSaveTrainFromBoard}
          />
        )}
      </SlideUpModal>

      {/* Profile modal - always mounted, starts hidden, content conditional */}
      <SlideUpModal
        ref={profileModalRef}
        minSnapPercent={0.50}
        initialSnap={getInitialSnap('profile')}
        startHidden
        onDismiss={() => handleModalDismissed('profile')}
        onSnapChange={handleSnapChange}
      >
        {showProfileContent && (
          <ProfileModal
            onClose={() => goBack()}
            onOpenSettings={() => navigateToSettings()}
          />
        )}
      </SlideUpModal>

      {/* Settings modal - always mounted, starts hidden, content conditional */}
      <SlideUpModal
        ref={settingsModalRef}
        minSnapPercent={0.95}
        initialSnap={getInitialSnap('settings')}
        startHidden
        onDismiss={() => handleModalDismissed('settings')}
        onSnapChange={handleSnapChange}
      >
        {showSettingsContent && (
          <SettingsModal
            onClose={() => goBack()}
            onRefreshGTFS={() => {
              triggerRefresh();
            }}
          />
        )}
      </SlideUpModal>

      {/* Full-page loading overlay while GTFS cache loads */}
      <LoadingOverlay visible={isLoadingCache} />
    </View>
  );
}

const loadingStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
    elevation: 99999,
  },
  icon: {
    marginBottom: 16,
  },
  copyright: {
    position: 'absolute',
    bottom: '15%',
    color: AppColors.secondary,
    fontSize: 12,
    fontWeight: '400',
    opacity: 0.6,
  },
});

export default function MapScreen() {
  return (
    <UnitsProvider>
      <TrainProvider>
        <GTFSRefreshProvider>
          <ModalProvider>
            <ErrorBoundary>
              <MapScreenInner />
            </ErrorBoundary>
          </ModalProvider>
        </GTFSRefreshProvider>
      </TrainProvider>
    </UnitsProvider>
  );
}
