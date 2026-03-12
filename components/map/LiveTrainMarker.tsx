/**
 * Live train marker component for map visualization
 * Displays train position with label (matching station marker animation style)
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text } from 'react-native';
import { AnimatedRegion, Marker } from 'react-native-maps';
import { TrainIcon } from '../TrainIcon';

interface LiveTrainMarkerProps {
  trainNumber: string;
  routeName: string | null;
  coordinate: {
    latitude: number;
    longitude: number;
  };
  isSaved?: boolean;
  isCluster?: boolean;
  clusterCount?: number;
  onPress?: () => void;
  color?: string;
}

export function LiveTrainMarker({
  trainNumber,
  routeName,
  coordinate,
  isSaved = false,
  isCluster = false,
  clusterCount = 0,
  onPress,
  color = '#FFFFFF',
}: LiveTrainMarkerProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  const animatedCoordinate = useRef(new AnimatedRegion({
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    latitudeDelta: 0,
    longitudeDelta: 0,
  })).current;
  const isFirstRender = useRef(true);

  const [currentLabel, setCurrentLabel] = useState(isCluster ? `${clusterCount}+` : trainNumber);
  const [currentIsCluster, setCurrentIsCluster] = useState(isCluster);

  const iconColor = color;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, scaleAnim]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    (animatedCoordinate.timing as any)({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      latitudeDelta: 0,
      longitudeDelta: 0,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [coordinate.latitude, coordinate.longitude]);

  const newLabel = isCluster ? `${clusterCount}+` : trainNumber;
  useEffect(() => {
    if (newLabel !== currentLabel || isCluster !== currentIsCluster) {
      Animated.sequence([
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 0.3,
            duration: 100,
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 0.9,
            duration: 100,
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(10),
      ]).start(() => {
        setCurrentLabel(newLabel);
        setCurrentIsCluster(isCluster);
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.spring(scaleAnim, {
            toValue: 1,
            friction: 8,
            tension: 100,
            useNativeDriver: true,
          }),
        ]).start();
      });
    }
  }, [newLabel, isCluster, currentLabel, currentIsCluster, fadeAnim, scaleAnim]);

  return (
    <Marker.Animated coordinate={animatedCoordinate as any} onPress={onPress} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={true}>
      <Animated.View
        style={{
          alignItems: 'center',
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }],
          padding: 10,
        }}
      >
        <TrainIcon
          name={routeName}
          size={24}
          color={iconColor}
        />
        <Text
          style={{
            color: iconColor,
            fontSize: currentIsCluster ? 10 : 9,
            fontWeight: '600',
            marginTop: 0,
            textAlign: 'center',
          }}
          numberOfLines={1}
        >
          {currentLabel}
        </Text>
      </Animated.View>
    </Marker.Animated>
  );
}
