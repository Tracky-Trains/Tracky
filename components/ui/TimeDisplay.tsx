import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { AppColors, Spacing } from '../../constants/theme';
import { formatDelayStatus } from '../../utils/time-formatting';

interface TimeDisplayProps {
  time: string;
  dayOffset?: number;
  style?: StyleProp<TextStyle>;
  superscriptStyle?: StyleProp<TextStyle>;
  containerStyle?: ViewStyle;
  // Delay support
  delayMinutes?: number;
  delayedTime?: string;
  delayedDayOffset?: number;
  // Layout: 'horizontal' (default) = side by side, 'vertical' = stacked (delayed on top, original smaller below)
  delayLayout?: 'horizontal' | 'vertical';
  // Hide the (+#m) label next to delayed time
  hideDelayLabel?: boolean;
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
  delayLayout = 'horizontal',
  hideDelayLabel = false,
}: TimeDisplayProps) {
  const hasDelay = delayMinutes != null && delayMinutes > 0 && delayedTime;
  const delayStr = hasDelay ? formatDelayStatus(delayMinutes) : '';

  if (hasDelay && delayLayout === 'vertical') {
    // Vertical layout: delayed time on top, original time smaller below
    return (
      <View style={[styles.delayContainerVertical, containerStyle]}>
        <View style={styles.container}>
          <Text style={[style, styles.delayedTime]}>{delayedTime}</Text>
          {(delayedDayOffset ?? 0) > 0 && (
            <Text style={[styles.superscript, superscriptStyle, styles.delayedSuperscript]}>+{delayedDayOffset}</Text>
          )}
        </View>
        <View style={styles.originalTimeRow}>
          <Text style={[style, styles.originalTimeSmall, styles.delayLabel]}>{delayStr} · </Text>
          <View style={styles.originalTimeContainer}>
            <Text style={[style, styles.originalTimeSmall]}>{time}</Text>
            {dayOffset > 0 && (
              <Text style={[styles.superscript, superscriptStyle, styles.originalSuperscript, styles.originalSuperscriptSmall]}>+{dayOffset}</Text>
            )}
          </View>
        </View>
      </View>
    );
  }

  if (hasDelay) {
    // Horizontal layout: side by side (default)
    return (
      <View style={[styles.delayContainer, containerStyle]}>
        {/* New delayed time (primary) with delay label */}
        <View style={styles.container}>
          <Text style={[style, styles.delayedTime]}>{delayedTime}{!hideDelayLabel ? ` (${delayStr})` : ''}</Text>
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
  delayContainerVertical: {
    flexDirection: 'column',
    alignItems: 'flex-end',
  },
  delayedTime: {
    color: AppColors.delayed,
  },
  delayedSuperscript: {
    color: AppColors.delayed,
  },
  originalTimeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  originalTimeContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  originalTime: {
    textDecorationLine: 'line-through',
    color: AppColors.secondary,
    opacity: 0.7,
    fontSize: 14,
    fontWeight: '400',
  },
  originalTimeSmall: {
    textDecorationLine: 'line-through',
    color: AppColors.secondary,
    opacity: 0.7,
    fontSize: 11,
  },
  originalSuperscript: {
    textDecorationLine: 'line-through',
    color: AppColors.secondary,
    opacity: 0.7,
  },
  originalSuperscriptSmall: {
    fontSize: 8,
  },
  delayLabel: {
    textDecorationLine: 'none',
  },
});
