import React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { AppColors } from '../constants/theme';

interface TrainIconProps {
  name?: string;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

/** Returns true when the train name indicates Acela (high-speed). */
export function isAcelaName(name?: string | null): boolean {
  return !!name && name.toLowerCase().includes('acela');
}

/** Returns true when the service is Amtrak Connecting Thruway (bus). */
export function isThruwayName(name?: string | null): boolean {
  return !!name && name.toLowerCase().includes('amtrak connecting thruway');
}

/**
 * Renders the correct transport icon based on the train/route name.
 * Acela uses Ionicons bullet-train icon, thruway uses bus icon,
 * everything else uses FontAwesome6 train.
 */
export function TrainIcon({ name, size = 16, color = AppColors.primary, style }: TrainIconProps) {
  if (isThruwayName(name)) {
    return <Ionicons name="bus" size={size} color={color} style={style} />;
  }
  if (isAcelaName(name)) {
    // Ionicons "train" renders slightly larger, so we keep the caller's size as-is
    return <Ionicons name="train" size={size} color={color} style={style} />;
  }
  // FontAwesome6 "train" is visually a bit larger at the same pt size, so scale down slightly
  return <FontAwesome6 name="train" size={Math.round(size * 0.8)} color={color} style={style} />;
}
