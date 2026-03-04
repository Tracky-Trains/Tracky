import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { AppColors } from '../../constants/theme';
import { useUnits } from '../../context/UnitsContext';

interface TrainSpeedPillProps {
  speed: number | undefined; // m/s from GTFS-RT
  bearing: number | undefined; // degrees from GTFS-RT
  visible: boolean;
}

const COMPASS_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

function bearingToCompass(bearing: number): string {
  const index = Math.round(bearing / 45) % 8;
  return COMPASS_DIRECTIONS[index];
}

function metersPerSecToMph(mps: number): number {
  return mps * 2.23694;
}

function metersPerSecToKmh(mps: number): number {
  return mps * 3.6;
}

export function TrainSpeedPill({ speed, bearing, visible }: TrainSpeedPillProps) {
  const insets = useSafeAreaInsets();
  const { distanceUnit } = useUnits();
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const isVisible = useRef(false);

  const hasData = visible && (speed != null || bearing != null);

  useEffect(() => {
    if (hasData && !isVisible.current) {
      isVisible.current = true;
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (!hasData && isVisible.current) {
      isVisible.current = false;
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -80,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [hasData, slideAnim, opacityAnim]);

  const speedDisplay =
    speed != null
      ? distanceUnit === 'km'
        ? `${Math.round(metersPerSecToKmh(speed))} km/h`
        : `${Math.round(metersPerSecToMph(speed))} mph`
      : null;

  const bearingDisplay = bearing != null ? bearingToCompass(bearing) : null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        { top: insets.top + 4, transform: [{ translateY: slideAnim }], opacity: opacityAnim },
      ]}
    >
      <View style={styles.pill}>
        <View style={styles.content}>
          {speedDisplay && (
            <View style={styles.segment}>
              <Ionicons name="speedometer-outline" size={14} color={AppColors.secondary} />
              <Text style={styles.valueText}>{speedDisplay}</Text>
            </View>
          )}
          {speedDisplay && bearingDisplay && <View style={styles.divider} />}
          {bearingDisplay && (
            <View style={styles.segment}>
              <Ionicons name="compass-outline" size={14} color={AppColors.secondary} />
              <Text style={styles.valueText}>{bearingDisplay}</Text>
              <Text style={styles.degreeText}>{Math.round(bearing!)}°</Text>
            </View>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9998,
  },
  pill: {
    backgroundColor: AppColors.background.tertiary,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: AppColors.border.secondary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  divider: {
    width: 1,
    height: 14,
    backgroundColor: AppColors.border.secondary,
  },
  valueText: {
    fontSize: 13,
    color: AppColors.primary,
    fontWeight: '600',
  },
  degreeText: {
    fontSize: 11,
    color: AppColors.secondary,
    fontWeight: '500',
  },
});
