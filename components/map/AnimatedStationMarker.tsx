import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { Marker } from 'react-native-maps';
import Ionicons from 'react-native-vector-icons/Ionicons';

interface StationCluster {
  id: string;
  lat: number;
  lon: number;
  isCluster: boolean;
  stations: Array<{ id: string; name: string; lat: number; lon: number }>;
}

interface AnimatedStationMarkerProps {
  cluster: StationCluster;
  showFullName: boolean;
  displayName: string;
  onPress: (cluster: StationCluster) => void;
  color?: string;
}

const markerStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  clusterLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 0,
    textAlign: 'center',
  },
  stationLabel: {
    fontSize: 9,
    fontWeight: '600',
    marginTop: 0,
    textAlign: 'center',
  },
});

export const AnimatedStationMarker = React.memo(function AnimatedStationMarker({ cluster, showFullName, displayName, onPress, color = '#FFFFFF' }: AnimatedStationMarkerProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const [currentDisplay, setCurrentDisplay] = useState(displayName);
  const [currentIsCluster, setCurrentIsCluster] = useState(cluster.isCluster);
  const [tracksChanges, setTracksChanges] = useState(true);

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
    ]).start(() => {
      setTracksChanges(false);
    });
  }, []);

  useEffect(() => {
    if (displayName !== currentDisplay || cluster.isCluster !== currentIsCluster) {
      setTracksChanges(true);
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
        setCurrentDisplay(displayName);
        setCurrentIsCluster(cluster.isCluster);
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
        ]).start(() => {
          setTracksChanges(false);
        });
      });
    }
  }, [displayName, cluster.isCluster, currentDisplay, currentIsCluster]);

  const handlePress = React.useCallback(() => {
    onPress(cluster);
  }, [onPress, cluster]);

  return (
    <Marker
      key={cluster.id}
      coordinate={{ latitude: cluster.lat, longitude: cluster.lon }}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={handlePress}
      tracksViewChanges={tracksChanges}
    >
      <Animated.View
        style={[
          markerStyles.container,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Ionicons
          name="location"
          size={24}
          color={color}
        />
        <Text
          style={[
            currentIsCluster ? markerStyles.clusterLabel : markerStyles.stationLabel,
            { color },
          ]}
          numberOfLines={1}
        >
          {currentDisplay}
        </Text>
      </Animated.View>
    </Marker>
  );
});
