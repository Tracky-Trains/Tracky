import React from 'react';
import { StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { AppColors, Spacing } from '../../constants/theme';

interface TimeDisplayProps {
  time: string;
  dayOffset?: number;
  style?: TextStyle;
  superscriptStyle?: TextStyle;
  containerStyle?: ViewStyle;
  // Delay support
  delayMinutes?: number;
  delayedTime?: string;
  delayedDayOffset?: number;
}

/**
 * Displays a time with an optional day offset as a superscript
 * e.g., "5:53 AM" with dayOffset=1 renders as "5:53 AM" with "+1" as superscript
 *
 * When delayMinutes > 0, shows original time with strikethrough in secondary color,
 * followed by the new delayed time in the primary style
 */
export default function TimeDisplay({
  time,
  dayOffset = 0,
  style,
  superscriptStyle,
  containerStyle,
  delayMinutes,
  delayedTime,
  delayedDayOffset,
}: TimeDisplayProps) {
  const hasDelay = delayMinutes != null && delayMinutes > 0 && delayedTime;

  if (hasDelay) {
    // Show original time with strikethrough, then delayed time
    return (
      <View style={[styles.delayContainer, containerStyle]}>
        {/* New delayed time (primary) */}
        <View style={styles.container}>
          <Text style={[style, styles.delayedTime]}>{delayedTime}</Text>
          {(delayedDayOffset ?? 0) > 0 && (
            <Text style={[styles.superscript, superscriptStyle, styles.delayedSuperscript]}>+{delayedDayOffset}</Text>
          )}
        </View>
        {/* Original time (strikethrough, faded) */}
        <View style={styles.originalTimeContainer}>
          <Text style={[style, styles.originalTime]}>{time}</Text>
          {dayOffset > 0 && (
            <Text style={[styles.superscript, superscriptStyle, styles.originalSuperscript]}>+{dayOffset}</Text>
          )}
        </View>
      </View>
    );
  }

  if (dayOffset === 0) {
    return <Text style={style}>{time}</Text>;
  }

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={style}>{time}</Text>
      <Text style={[styles.superscript, superscriptStyle]}>+{dayOffset}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  superscript: {
    fontSize: 10,
    fontWeight: '600',
    color: AppColors.secondary,
    marginLeft: 2,
    marginTop: -2,
  },
  // Delay styles
  delayContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.sm,
  },
  delayedTime: {
    color: AppColors.delayed,
  },
  delayedSuperscript: {
    color: AppColors.delayed,
  },
  originalTimeContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  originalTime: {
    textDecorationLine: 'line-through',
    color: AppColors.secondary,
    opacity: 0.7,
  },
  originalSuperscript: {
    textDecorationLine: 'line-through',
    color: AppColors.secondary,
    opacity: 0.7,
  },
});
