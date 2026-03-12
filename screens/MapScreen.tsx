import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Image, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
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
import { TrainSpeedPill } from '../components/ui/TrainSpeedPill';
import SettingsModal from '../components/ui/SettingsModal';
import SlideUpModal from '../components/ui/slide-up-modal';
import TrainDetailModal from '../components/ui/train-detail-modal';
import { type ColorPalette, withTextShadow } from '../constants/theme';
import { useColors, useTheme } from '../context/ThemeContext';
import { GTFSRefreshProvider, useGTFSRefresh } from '../context/GTFSRefreshContext';
import { ModalProvider, useModalActions, useModalState } from '../context/ModalContext';
import { TrainProvider, useTrainContext } from '../context/TrainContext';
import { UnitsProvider } from '../context/UnitsContext';
import { useLiveTrains } from '../hooks/useLiveTrains';
import { useRealtime } from '../hooks/useRealtime';
import { useShapes } from '../hooks/useShapes';
import { useStations } from '../hooks/useStations';
import { TrainAPIService } from '../services/api';
import { requestPermissions as requestNotificationPermissions } from '../services/notifications';
import { TrainStorageService } from '../services/storage';
import type { SavedTrainRef, Stop, Train, ViewportBounds } from '../types/train';
import { ClusteringConfig } from '../utils/clustering-config';
import { gtfsParser } from '../utils/gtfs-parser';
import { light as hapticLight } from '../utils/haptics';
import { logger } from '../utils/logger';
import { getRouteColor, getStrokeWidthForZoom } from '../utils/route-colors';
import { clusterStations, getStationAbbreviation } from '../utils/station-clustering';
import { clusterTrains } from '../utils/train-clustering';
import { ModalContent, ModalContentHandle } from './ModalContent';
import { createStyles } from './styles';

// Google Maps "Night" dark style
const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
  { featureType: 'transit.station', elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
];

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
    // Modal covers bottom 50% of screen — offset by half the viewport
    return latitudeDelta * 0.4;
  }
  if (modalSnap === 'min') {
    // Modal covers bottom 35% of screen
    return latitudeDelta * 0.2;
  }
  // No offset for fullscreen modal or no modal
  return 0;
}

const createLoadingStyles = (colors: ColorPalette) =>
  StyleSheet.create(withTextShadow({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: '#000000',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      elevation: 99999,
    },
    logo: {
      width: 360,
      height: 360,
      marginBottom: 16,
      resizeMode: 'contain',
    },
    copyright: {
      position: 'absolute',
      bottom: '15%',
      color: colors.secondary,
      fontSize: 12,
      fontWeight: '400',
      opacity: 0.6,
    },
  }, colors.textShadow));

function LoadingOverlay({ visible }: { visible: boolean }) {
  const colors = useColors();
  const lStyles = useMemo(() => createLoadingStyles(colors), [colors]);
  const opacity = useRef(new Animated.Value(1)).current;
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      opacity.setValue(1);
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => setMounted(false));
    }
  }, [visible, opacity]);

  if (!mounted) return null;

  return (
    <Animated.View style={[lStyles.overlay, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
      <Image source={require('../assets/images/tracky-logo.png')} style={lStyles.logo} />
      <Text style={lStyles.copyright}>Tracky - Made with &lt;3 by Jason</Text>
    </Animated.View>
  );
}

function MapScreenInner() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const mapRef = useRef<MapView>(null);
  const modalContentRef = useRef<ModalContentHandle>(null);
  const { triggerRefresh, isLoadingCache } = useGTFSRefresh();

  // Split modal context — actions (stable) vs state (reactive)
  const {
    mainModalRef,
    detailModalRef,
    departureBoardRef,
    profileModalRef,
    settingsModalRef,
    navigateToTrain,
    navigateToStation,
    navigateToProfile,
    navigateToSettings,
    navigateToMain,
    goBack,
    handleModalDismissed,
    handleSnapChange,
    getInitialSnap,
  } = useModalActions();
  const {
    activeModal,
    showMainContent,
    showTrainDetailContent,
    showDepartureBoardContent,
    showProfileContent,
    showSettingsContent,
    modalData,
    currentSnap,
  } = useModalState();
  const isProfileActive = activeModal === 'profile';
  // Region is stored as a ref — only the initial value matters for MapView.
  // mapReady gates rendering; subsequent region changes don't need re-renders.
  const regionRef = useRef<MapRegion | null>(null);
  const [mapReady, setMapReady] = useState(false);
  // Combined viewport state — single setState triggers one re-render instead of two
  const [viewportState, setViewportState] = useState<{
    bounds: ViewportBounds | null;
    latDelta: number;
  }>({ bounds: null, latDelta: 1 });
  const viewportBounds = viewportState.bounds;
  const debouncedLatDelta = viewportState.latDelta;
  const viewportDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapType, setMapType] = useState<MapType>('standard');
  const [routeMode, setRouteMode] = useState<RouteMode>('visible');
  const [stationMode, setStationMode] = useState<StationMode>('auto');
  const [trainMode, setTrainMode] = useState<TrainMode>('all');
  const { savedTrains, setSavedTrains, selectedTrain, setSelectedTrain } = useTrainContext();
  const insets = useSafeAreaInsets();

  // Travel overlay state for profile view
  const [travelLines, setTravelLines] = useState<{ key: string; from: { latitude: number; longitude: number }; to: { latitude: number; longitude: number } }[]>([]);
  const [travelStations, setTravelStations] = useState<{ latitude: number; longitude: number; id: string }[]>([]);
  const [profileYear, setProfileYear] = useState<number | null>(null);
  const tripHistoryRef = useRef<Awaited<ReturnType<typeof TrainStorageService.getTripHistory>>>([]);

  // Resolve trip history into travel lines/stations, filtered by year
  const resolveTravelOverlay = useCallback((history: typeof tripHistoryRef.current, year: number | null) => {
    const lines: typeof travelLines = [];
    const stationMap = new Map<string, { latitude: number; longitude: number }>();

    for (const trip of history) {
      if (year && new Date(trip.travelDate).getFullYear() !== year) continue;

      const fromStop = gtfsParser.getStop(trip.fromCode);
      const toStop = gtfsParser.getStop(trip.toCode);
      if (!fromStop || !toStop) continue;

      const fromCoord = { latitude: fromStop.stop_lat, longitude: fromStop.stop_lon };
      const toCoord = { latitude: toStop.stop_lat, longitude: toStop.stop_lon };

      lines.push({
        key: `${trip.tripId}-${trip.fromCode}-${trip.toCode}-${trip.travelDate}`,
        from: fromCoord,
        to: toCoord,
      });

      if (!stationMap.has(trip.fromCode)) stationMap.set(trip.fromCode, fromCoord);
      if (!stationMap.has(trip.toCode)) stationMap.set(trip.toCode, toCoord);
    }

    setTravelLines(lines);
    setTravelStations(Array.from(stationMap.entries()).map(([id, coord]) => ({ ...coord, id })));
  }, []);

  // Load trip history when profile opens
  useEffect(() => {
    if (!isProfileActive) {
      setTravelLines([]);
      setTravelStations([]);
      setProfileYear(null);
      tripHistoryRef.current = [];
      return;
    }

    (async () => {
      const history = await TrainStorageService.getTripHistory();
      tripHistoryRef.current = history;
      resolveTravelOverlay(history, profileYear);
    })();
  }, [isProfileActive]);

  // Handle year change from profile modal
  const handleProfileYearChange = useCallback((year: number | null) => {
    setProfileYear(year);
    resolveTravelOverlay(tripHistoryRef.current, year);
  }, [resolveTravelOverlay]);

  // Zoom to fit all travel points when profile opens
  useEffect(() => {
    if (!isProfileActive || travelStations.length === 0) return;

    const coords = travelStations.map(s => ({ latitude: s.latitude, longitude: s.longitude }));
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 100, right: 60, bottom: 400, left: 60 },
        animated: true,
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [isProfileActive, travelStations]);

  // Use lazy-loaded stations and shapes based on viewport
  const stations = useStations(viewportBounds ?? undefined);
  const { visibleShapes } = useShapes(viewportBounds ?? undefined);

  // Fetch all live trains from GTFS-RT (only when trainMode is 'all')
  const { liveTrains } = useLiveTrains(15000, trainMode === 'all');

  // Find live speed/bearing for the selected train
  const selectedLiveData = useMemo(() => {
    if (!selectedTrain || !showTrainDetailContent) return null;
    const match = liveTrains.find(
      lt =>
        (selectedTrain.tripId && lt.tripId === selectedTrain.tripId) ||
        lt.trainNumber === selectedTrain.trainNumber
    );
    return match?.position ?? null;
  }, [selectedTrain, liveTrains, showTrainDetailContent]);

  // Memoize clustered trains to avoid expensive reclustering on every render
  const clusteredLiveTrains = useMemo(() => {
    if (trainMode !== 'all') return [];
    const trainsWithSavedStatus = liveTrains.map(train => {
      const savedTrain = savedTrains.find(
        saved =>
          saved.daysAway <= 0 &&
          (saved.tripId === train.tripId || saved.trainNumber === train.trainNumber)
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
    async (tripId: string, trainNumber: string, lat: number, lon: number) => {
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
        const train = await TrainAPIService.getTrainDetails(tripId, undefined, trainNumber);
        if (train) {
          setSelectedTrain(train);
          navigateToTrain(train, { fromMarker: true });
        } else {
          Alert.alert('Train Unavailable', 'Could not load details for this train. It may no longer be active.');
        }
      } catch (error) {
        logger.error('Error fetching train details:', error);
        Alert.alert('Connection Error', 'Could not load train details. Check your internet connection and try again.');
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

  // Handle saving train from departure board tap or swipe, then navigate to train view
  const handleSaveTrainFromBoard = useCallback(
    async (train: Train, travelDate: Date): Promise<boolean> => {
      if (!train.tripId) return false;
      const ref: SavedTrainRef = {
        tripId: train.tripId,
        fromCode: train.fromCode || undefined,
        toCode: train.toCode || undefined,
        travelDate: travelDate.getTime(),
        savedAt: Date.now(),
      };
      const saved = await TrainStorageService.saveTrainRef(ref);
      if (saved) {
        const updatedTrains = await TrainStorageService.getSavedTrains();
        setSavedTrains(updatedTrains);
      }
      // Navigate to train detail view
      handleDepartureBoardTrainSelect(train);
      return saved;
    },
    [setSavedTrains, handleDepartureBoardTrainSelect]
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

  // Set initial region (ref) and mark map ready — only called once
  const setInitialRegion = useCallback((r: MapRegion) => {
    if (!regionRef.current) {
      regionRef.current = r;
      setMapReady(true);
    }
  }, []);

  // Request permissions on mount (location + notifications)
  React.useEffect(() => {
    requestNotificationPermissions();
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          // Try last known position first (instant, works on emulators without GPS)
          let location = await Location.getLastKnownPositionAsync();
          if (!location) {
            location = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
          }
          logger.debug(`[MapScreen] User location: ${location.coords.latitude.toFixed(3)}, ${location.coords.longitude.toFixed(3)}`);
          setInitialRegion({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          });
        } else {
          logger.info('[MapScreen] Location permission denied, using fallback');
          setInitialRegion({
            latitude: 37.78825,
            longitude: -122.4324,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          });
        }
      } catch (error) {
        logger.error('Error getting initial location:', error);
        setInitialRegion({
          latitude: 37.78825,
          longitude: -122.4324,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        });
      }
    })();
  }, [setInitialRegion]);

  // Track when GTFS data is loaded
  const [gtfsLoaded, setGtfsLoaded] = React.useState(gtfsParser.isLoaded);

  // Poll for GTFS loaded state — clear interval as soon as loaded
  React.useEffect(() => {
    if (gtfsLoaded) return;

    const interval = setInterval(() => {
      if (gtfsParser.isLoaded) {
        clearInterval(interval);
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

  // Handle notification taps — navigate to the train's detail modal.
  // Use a ref for savedTrains to avoid tearing down/recreating the listener every 20s.
  const savedTrainsRef = useRef(savedTrains);
  savedTrainsRef.current = savedTrains;

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (!data?.tripId) return;

      const match = savedTrainsRef.current.find(
        t =>
          t.tripId === data.tripId &&
          t.fromCode === data.fromCode &&
          t.toCode === data.toCode
      );
      if (match) {
        setSelectedTrain(match);
        navigateToTrain(match, { fromMarker: false });
      }
    });
    return () => subscription.remove();
  }, [setSelectedTrain, navigateToTrain]);

  // Handle region changes — region ref is updated immediately (no re-render),
  // viewport state is debounced to batch downstream recomputations.
  const handleRegionChangeComplete = useCallback((newRegion: MapRegion) => {
    regionRef.current = newRegion;

    // Debounce viewport bounds + latDelta together — single setState, single re-render
    if (viewportDebounceRef.current) {
      clearTimeout(viewportDebounceRef.current);
    }
    viewportDebounceRef.current = setTimeout(() => {
      setViewportState({
        bounds: regionToViewportBounds(newRegion),
        latDelta: newRegion.latitudeDelta,
      });
    }, 100);
  }, []);

  // Initialize viewport bounds when map first becomes ready
  React.useEffect(() => {
    if (mapReady && regionRef.current && !viewportBounds) {
      setViewportState({
        bounds: regionToViewportBounds(regionRef.current),
        latDelta: regionRef.current.latitudeDelta,
      });
    }
  }, [mapReady, viewportBounds]);

  // Cleanup timers on unmount
  React.useEffect(() => {
    return () => {
      if (viewportDebounceRef.current) {
        clearTimeout(viewportDebounceRef.current);
      }
    };
  }, []);

  const handleRecenter = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return;
      }
      let location = await Location.getLastKnownPositionAsync();
      if (!location) {
        location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }
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
  }, [currentSnap]);

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

  // Don't render until we have a region
  if (!mapReady || !regionRef.current) {
    return <LoadingOverlay visible={true} />;
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapType={mapType}
        initialRegion={regionRef.current!}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsTraffic={false}
        showsIndoors={true}
        userLocationAnnotationTitle="Your Location"
        provider={PROVIDER_DEFAULT}
        customMapStyle={isDark ? darkMapStyle : []}
        userInterfaceStyle={isDark ? 'dark' : 'light'}
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {!isProfileActive && shouldRenderRoutes &&
          visibleShapes.map(shape => {
            const colorScheme = getRouteColor(shape.id, colors.accentBlue);
            return (
              <AnimatedRoute
                key={shape.id}
                id={shape.id}
                coordinates={shape.coordinates}
                strokeColor={colorScheme.stroke}
                strokeWidth={Math.max(2, baseStrokeWidth)}
              />
            );
          })}

        {!isProfileActive && stationClusters.map(cluster => {
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
              color={colors.accentBlue}
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
        {!isProfileActive && trainMode === 'saved' &&
          clusteredSavedTrains.map(cluster => (
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
              color={colors.accentBlue}
              onPress={() => {
                if (!cluster.isCluster && cluster.trains[0]?.originalTrain) {
                  handleTrainMarkerPress(cluster.trains[0].originalTrain, cluster.lat, cluster.lon);
                }
              }}
            />
          ))}

        {/* Render all live trains when mode is 'all' */}
        {!isProfileActive && trainMode === 'all' &&
          clusteredLiveTrains.map(cluster => (
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
              color={colors.accentBlue}
              onPress={() => {
                if (!cluster.isCluster && cluster.trains[0]) {
                  const trainData = cluster.trains[0];
                  // If it's a saved train, use its data directly
                  if (trainData.savedTrain && trainData.savedTrain.realtime?.position) {
                    handleTrainMarkerPress(trainData.savedTrain, cluster.lat, cluster.lon);
                  } else {
                    // Fetch train details for non-saved trains
                    handleLiveTrainMarkerPress(trainData.tripId, trainData.trainNumber, cluster.lat, cluster.lon);
                  }
                }
              }}
            />
          ))}

        {/* Travel history overlay when profile is open */}
        {isProfileActive && travelLines.map(line => (
          <Polyline
            key={line.key}
            coordinates={[line.from, line.to]}
            strokeColor={colors.accentBlue}
            strokeWidth={2}
          />
        ))}
        {isProfileActive && travelStations.map(station => (
          <Marker
            key={station.id}
            coordinate={station}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <View style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: colors.accentBlue,
            }} />
          </Marker>
        ))}
      </MapView>

      <RefreshBubble />
      <TrainSpeedPill
        speed={selectedLiveData?.speed}
        bearing={selectedLiveData?.bearing}
        visible={!!selectedLiveData}
      />

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
            onYearChange={handleProfileYearChange}
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
