import * as Network from 'expo-network';
import React from 'react';
import { Alert, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { AppColors } from '../../constants/theme';
import { light as hapticLight, warning as hapticWarning } from '../../utils/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PILL_WIDTH = 48;
const PILL_HEIGHT_CONNECTED = 104; // Two buttons (48 each) + 8px gap
const PILL_HEIGHT_OFFLINE = 156; // Three buttons (48 each) + 12px gaps
const STRIP_WIDTH = SCREEN_WIDTH - 32;
const STRIP_HEIGHT = 56;

const SPRING_CONFIG = {
  damping: 60,
  stiffness: 500,
};

export type RouteMode = 'hidden' | 'visible';
export type StationMode = 'hidden' | 'auto' | 'all';
export type TrainMode = 'hidden' | 'saved' | 'all';
export type MapType = 'standard' | 'satellite';

interface MapSettingsPillProps {
  top: number;
  routeMode: RouteMode;
  setRouteMode: (mode: RouteMode) => void;
  stationMode: StationMode;
  setStationMode: (mode: StationMode) => void;
  mapType: MapType;
  setMapType: (type: MapType) => void;
  trainMode: TrainMode;
  setTrainMode: (mode: TrainMode) => void;
  onRecenter: () => void;
}

function getNextRouteMode(current: RouteMode): RouteMode {
  return current === 'hidden' ? 'visible' : 'hidden';
}

function getNextStationMode(current: StationMode): StationMode {
  if (current === 'hidden') return 'auto';
  if (current === 'auto') return 'all';
  return 'hidden';
}

function getNextTrainMode(current: TrainMode): TrainMode {
  if (current === 'hidden') return 'saved';
  if (current === 'saved') return 'all';
  return 'hidden';
}

function getRouteModeLabel(mode: RouteMode): string {
  return mode === 'hidden' ? 'Off' : 'On';
}

function getStationModeLabel(mode: StationMode): string {
  if (mode === 'hidden') return 'Off';
  if (mode === 'auto') return 'Compact';
  return 'All';
}

function getTrainModeLabel(mode: TrainMode): string {
  if (mode === 'hidden') return 'Off';
  if (mode === 'saved') return 'Saved';
  return 'All';
}

function getModeColor(mode: string): string {
  if (mode === 'hidden') return AppColors.tertiary;
  if (mode === 'visible' || mode === 'auto' || mode === 'saved' || mode === 'standard') return AppColors.primary;
  return AppColors.accentBlue;
}

export default function MapSettingsPill({
  top,
  routeMode,
  setRouteMode,
  stationMode,
  setStationMode,
  mapType,
  setMapType,
  trainMode,
  setTrainMode,
  onRecenter,
}: MapSettingsPillProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isConnected, setIsConnected] = React.useState(true);
  const expandProgress = useSharedValue(0);

  // Monitor network connectivity
  React.useEffect(() => {
    let mounted = true;

    const checkNetwork = async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        if (mounted) {
          setIsConnected(state.isConnected ?? true);
        }
      } catch {
        // Default to connected if check fails
      }
    };

    // Check immediately
    checkNetwork();

    // Poll every 5 seconds
    const interval = setInterval(checkNetwork, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleOfflinePress = () => {
    hapticWarning();
    Alert.alert(
      'No Internet Connection',
      'GTFS schedule data may be stale until your connection is restored. Live train positions will not update.',
      [{ text: 'OK' }]
    );
  };

  const handleSettingsPress = () => {
    hapticLight();
    setIsExpanded(true);
    expandProgress.value = withSpring(1, SPRING_CONFIG);
  };

  const handleClose = () => {
    hapticLight();
    expandProgress.value = withSpring(0, SPRING_CONFIG, () => {
      runOnJS(setIsExpanded)(false);
    });
  };

  const pillHeight = isConnected ? PILL_HEIGHT_CONNECTED : PILL_HEIGHT_OFFLINE;
  const pillHeightShared = useSharedValue(pillHeight);

  // Keep shared value in sync with state
  React.useEffect(() => {
    pillHeightShared.value = withSpring(pillHeight, SPRING_CONFIG);
  }, [pillHeight]);

  const animatedContainerStyle = useAnimatedStyle(() => {
    return {
      width: interpolate(expandProgress.value, [0, 1], [PILL_WIDTH, STRIP_WIDTH]),
      height: interpolate(expandProgress.value, [0, 1], [pillHeightShared.value, STRIP_HEIGHT]),
      borderRadius: interpolate(expandProgress.value, [0, 1], [24, STRIP_HEIGHT / 2]),
    };
  });

  const collapsedContentStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(expandProgress.value, [0, 0.3], [1, 0]),
      transform: [{ scale: interpolate(expandProgress.value, [0, 0.3], [1, 0.8]) }],
    };
  });

  const expandedContentStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(expandProgress.value, [0.7, 1], [0, 1]),
      transform: [{ scale: interpolate(expandProgress.value, [0.7, 1], [0.8, 1]) }],
    };
  });

  return (
    <Animated.View style={[styles.container, { top }, animatedContainerStyle]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: AppColors.background.secondary }]}>
          {/* Collapsed Content - Settings + Recenter + (optional) Offline buttons */}
          <Animated.View
            style={[styles.collapsedContent, collapsedContentStyle]}
            pointerEvents={isExpanded ? 'none' : 'auto'}
          >
            <TouchableOpacity style={styles.pillButton} onPress={handleSettingsPress} activeOpacity={0.7}>
              <Ionicons name="map-outline" size={24} color={AppColors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.pillButton} onPress={() => { hapticLight(); onRecenter(); }} activeOpacity={0.7}>
              <MaterialIcons name="my-location" size={22} color={AppColors.primary} />
            </TouchableOpacity>
            {!isConnected && (
              <TouchableOpacity style={styles.pillButton} onPress={handleOfflinePress} activeOpacity={0.7}>
                <View style={styles.offlineIconContainer}>
                  <Ionicons name="wifi" size={22} color={AppColors.error} />
                  <View style={styles.offlineExclamation}>
                    <Text style={styles.offlineExclamationText}>!</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          </Animated.View>

          {/* Expanded Content - Settings strip */}
          <Animated.View
            style={[styles.expandedContent, expandedContentStyle]}
            pointerEvents={isExpanded ? 'auto' : 'none'}
          >
            {/* Routes */}
            <TouchableOpacity
              style={styles.settingOption}
              onPress={() => { hapticLight(); setRouteMode(getNextRouteMode(routeMode)); }}
              activeOpacity={0.7}
            >
              <MaterialIcons name="route" size={20} color={getModeColor(routeMode)} />
              <Text style={[styles.settingLabel, { color: getModeColor(routeMode) }]}>
                {getRouteModeLabel(routeMode)}
              </Text>
            </TouchableOpacity>

            {/* Stations */}
            <TouchableOpacity
              style={styles.settingOption}
              onPress={() => { hapticLight(); setStationMode(getNextStationMode(stationMode)); }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={stationMode === 'all' ? 'location' : 'location-outline'}
                size={20}
                color={stationMode === 'hidden' ? AppColors.tertiary : AppColors.primary}
              />
              <Text
                style={[
                  styles.settingLabel,
                  { color: stationMode === 'hidden' ? AppColors.tertiary : AppColors.primary },
                ]}
              >
                {getStationModeLabel(stationMode)}
              </Text>
            </TouchableOpacity>

            {/* Map Type */}
            <TouchableOpacity
              style={styles.settingOption}
              onPress={() => { hapticLight(); setMapType(mapType === 'standard' ? 'satellite' : 'standard'); }}
              activeOpacity={0.7}
            >
              {mapType === 'standard' ? (
                <Ionicons name="map" size={20} color={AppColors.primary} />
              ) : (
                <MaterialIcons name="satellite-alt" size={20} color={AppColors.primary} />
              )}
              <Text style={[styles.settingLabel, { color: AppColors.primary }]}>
                {mapType === 'standard' ? 'Std' : 'Sat'}
              </Text>
            </TouchableOpacity>

            {/* Trains */}
            <TouchableOpacity
              style={styles.settingOption}
              onPress={() => { hapticLight(); setTrainMode(getNextTrainMode(trainMode)); }}
              activeOpacity={0.7}
            >
              <Ionicons name="train" size={20} color={getModeColor(trainMode)} />
              <Text style={[styles.settingLabel, { color: getModeColor(trainMode) }]}>
                {getTrainModeLabel(trainMode)}
              </Text>
            </TouchableOpacity>

            {/* Close */}
            <TouchableOpacity style={styles.closeButton} onPress={handleClose} activeOpacity={0.7}>
              <Ionicons name="close" size={24} color={AppColors.primary} />
            </TouchableOpacity>
          </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    shadowColor: AppColors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: AppColors.border.primary,
    overflow: 'hidden',
  },
  collapsedContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 0,
  },
  pillButton: {
    width: PILL_WIDTH,
    height: PILL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
  },
  settingOption: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    minWidth: 50,
  },
  settingLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: AppColors.background.secondary,
  },
  offlineIconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineExclamation: {
    position: 'absolute',
    bottom: -2,
    right: -6,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: AppColors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineExclamationText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    lineHeight: 12,
  },
});
