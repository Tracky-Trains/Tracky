import React from 'react';
import { Polyline } from 'react-native-maps';

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface AnimatedRouteProps {
  id: string;
  coordinates: Coordinate[];
  strokeColor: string;
  strokeWidth: number;
  zoomOpacity?: number;
}

export const AnimatedRoute = React.memo(function AnimatedRoute({ id, coordinates, strokeColor, strokeWidth }: AnimatedRouteProps) {
  return (
    <Polyline
      key={id}
      coordinates={coordinates}
      strokeColor={strokeColor}
      strokeWidth={strokeWidth}
      lineCap="round"
      lineJoin="round"
      geodesic={true}
    />
  );
});
