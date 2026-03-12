import * as Network from 'expo-network';
import React, { useCallback, useMemo } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { type ColorPalette, withTextShadow } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { light as hapticLight } from '../../utils/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PILL_WIDTH = 48;
const PILL_HEIGHT = 104;
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

function getModeColor(mode: string, colors: ColorPalette): string {
  if (mode === 'hidden') return colors.tertiary;
  if (mode === 'visible' || mode === 'auto' || mode === 'saved' || mode === 'standard') return colors.primary;
  return colors.accentBlue;
}

const createStyles = (colors: ColorPalette, isDark: boolean) =>
  StyleSheet.create(withTextShadow({
    container: {
      position: 'absolute',
      right: 16,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 5,
      borderWidth: isDark ? 1 : 0,
      borderColor: colors.border.primary,
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
      backgroundColor: colors.background.secondary,
    },
    offlineIconContainer: {
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
    },
    offlineSlash: {
      position: 'absolute',
      width: 2,
      height: 26,
      backgroundColor: colors.error,
      borderRadius: 1,
      transform: [{ rotate: '45deg' }],
    },
  }, colors.textShadow));

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
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [isConnected, setIsConnected] = React.useState(true);
  const expandProgress = useSharedValue(0);

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

    checkNetwork();

    const interval = setInterval(checkNetwork, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

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

  const handleRouteToggle = useCallback(() => {
    hapticLight();
    setRouteMode(getNextRouteMode(routeMode));
  }, [routeMode, setRouteMode]);

  const handleStationToggle = useCallback(() => {
    hapticLight();
    setStationMode(getNextStationMode(stationMode));
  }, [stationMode, setStationMode]);

  const handleMapTypeToggle = useCallback(() => {
    hapticLight();
    setMapType(mapType === 'standard' ? 'satellite' : 'standard');
  }, [mapType, setMapType]);

  const handleTrainToggle = useCallback(() => {
    hapticLight();
    setTrainMode(getNextTrainMode(trainMode));
  }, [trainMode, setTrainMode]);

  const handleRecenterPress = useCallback(() => {
    hapticLight();
    onRecenter();
  }, [onRecenter]);

  const animatedContainerStyle = useAnimatedStyle(() => {
    return {
      width: interpolate(expandProgress.value, [0, 1], [PILL_WIDTH, STRIP_WIDTH]),
      height: interpolate(expandProgress.value, [0, 1], [PILL_HEIGHT, STRIP_HEIGHT]),
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
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background.secondary }]}>
          {/* Collapsed Content */}
          <Animated.View
            style={[styles.collapsedContent, collapsedContentStyle]}
            pointerEvents={isExpanded ? 'none' : 'auto'}
          >
            <TouchableOpacity style={styles.pillButton} onPress={handleSettingsPress} activeOpacity={0.7}>
              <Ionicons name="map-outline" size={24} color={colors.primary} />
            </TouchableOpacity>
            {isConnected ? (
              <TouchableOpacity style={styles.pillButton} onPress={handleRecenterPress} activeOpacity={0.7}>
                <MaterialIcons name="my-location" size={22} color={colors.primary} />
              </TouchableOpacity>
            ) : (
              <View style={styles.pillButton}>
                <View style={styles.offlineIconContainer}>
                  <Ionicons name="wifi" size={22} color={colors.error} />
                  <View style={styles.offlineSlash} />
                </View>
              </View>
            )}
          </Animated.View>

          {/* Expanded Content */}
          <Animated.View
            style={[styles.expandedContent, expandedContentStyle]}
            pointerEvents={isExpanded ? 'auto' : 'none'}
          >
            {/* Routes */}
            <TouchableOpacity
              style={styles.settingOption}
              onPress={handleRouteToggle}
              activeOpacity={0.7}
            >
              <MaterialIcons name="route" size={20} color={getModeColor(routeMode, colors)} />
              <Text style={[styles.settingLabel, { color: getModeColor(routeMode, colors) }]}>
                {getRouteModeLabel(routeMode)}
              </Text>
            </TouchableOpacity>

            {/* Stations */}
            <TouchableOpacity
              style={styles.settingOption}
              onPress={handleStationToggle}
              activeOpacity={0.7}
            >
              <Ionicons
                name={stationMode === 'all' ? 'location' : 'location-outline'}
                size={20}
                color={stationMode === 'hidden' ? colors.tertiary : colors.primary}
              />
              <Text
                style={[
                  styles.settingLabel,
                  { color: stationMode === 'hidden' ? colors.tertiary : colors.primary },
                ]}
              >
                {getStationModeLabel(stationMode)}
              </Text>
            </TouchableOpacity>

            {/* Map Type */}
            <TouchableOpacity
              style={styles.settingOption}
              onPress={handleMapTypeToggle}
              activeOpacity={0.7}
            >
              {mapType === 'standard' ? (
                <Ionicons name="map" size={20} color={colors.primary} />
              ) : (
                <MaterialIcons name="satellite-alt" size={20} color={colors.primary} />
              )}
              <Text style={[styles.settingLabel, { color: colors.primary }]}>
                {mapType === 'standard' ? 'Std' : 'Sat'}
              </Text>
            </TouchableOpacity>

            {/* Trains */}
            <TouchableOpacity
              style={styles.settingOption}
              onPress={handleTrainToggle}
              activeOpacity={0.7}
            >
              <Ionicons name="train" size={20} color={getModeColor(trainMode, colors)} />
              <Text style={[styles.settingLabel, { color: getModeColor(trainMode, colors) }]}>
                {getTrainModeLabel(trainMode)}
              </Text>
            </TouchableOpacity>

            {/* Close */}
            <TouchableOpacity style={styles.closeButton} onPress={handleClose} activeOpacity={0.7}>
              <Ionicons name="close" size={24} color={colors.primary} />
            </TouchableOpacity>
          </Animated.View>
      </View>
    </Animated.View>
  );
}
