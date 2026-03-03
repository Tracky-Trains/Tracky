import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppColors, FontSizes, Spacing } from '../constants/theme';
import { COLORS, styles } from '../screens/styles';
import { getDelayColorKey } from '../utils/time-formatting';
import TimeDisplay from './ui/TimeDisplay';

const DELAY_COLORS = {
  delayed: AppColors.delayed,
  onTime: AppColors.success,
} as const;

interface TrainCardContentProps {
  countdownValue: number;
  countdownLabel: string;
  isPast: boolean;
  routeName: string;
  trainNumber: string;
  date?: string;
  fromName: string;
  toName: string;
  fromCode: string;
  toCode: string;
  departTime: string;
  arriveTime: string;
  departDayOffset?: number;
  arriveDayOffset?: number;
  intermediateStopCount?: number;
  // Delay props for departure
  departDelayMinutes?: number;
  departDelayedTime?: string;
  departDelayedDayOffset?: number;
  // Delay props for arrival
  arriveDelayMinutes?: number;
  arriveDelayedTime?: string;
  arriveDelayedDayOffset?: number;
}

export default function TrainCardContent({
  countdownValue,
  countdownLabel,
  isPast,
  routeName,
  trainNumber,
  date,
  fromName,
  toName,
  fromCode,
  toCode,
  departTime,
  arriveTime,
  departDayOffset,
  arriveDayOffset,
  intermediateStopCount,
  departDelayMinutes,
  departDelayedTime,
  departDelayedDayOffset,
  arriveDelayMinutes,
  arriveDelayedTime,
  arriveDelayedDayOffset,
}: TrainCardContentProps) {
  const pastColor = isPast ? { color: AppColors.secondary } : undefined;

  return (
    <View style={localStyles.row}>
      <View style={[styles.trainLeft, isPast && { opacity: 0.4 }]}>
        <Text style={[styles.daysAway, pastColor]}>{countdownValue}</Text>
        <Text style={[styles.daysLabel, pastColor]}>{countdownLabel}</Text>
      </View>

      <View style={styles.trainCenter}>
        <View style={styles.trainHeader}>
          <Image
            source={require('../assets/images/amtrak.png')}
            style={[styles.amtrakLogo, isPast && { opacity: 0.4 }]}
            fadeDuration={0}
          />
          <Text style={[styles.trainNumber, { color: COLORS.secondary, fontWeight: '400' }]}>
            {routeName} {trainNumber}
          </Text>
          {intermediateStopCount != null && intermediateStopCount > 0 && (
            <Text style={localStyles.stops}>
              {intermediateStopCount} stop{intermediateStopCount !== 1 ? 's' : ''}
            </Text>
          )}
          {date != null && <Text style={styles.trainDate}>{date}</Text>}
        </View>

        <Text style={[styles.route, { fontSize: 18 }, pastColor]}>
          {fromName} to {toName}
        </Text>

        <View style={styles.timeRow}>
          {(() => {
            const depColorKey = getDelayColorKey(departDelayMinutes);
            const depBg = depColorKey ? DELAY_COLORS[depColorKey] : pastColor?.color ?? AppColors.secondary;
            return (
              <View style={styles.timeInfo}>
                <View style={[styles.arrowIcon, { backgroundColor: depBg }]}>
                  <MaterialCommunityIcons name="arrow-top-right" size={10} color={AppColors.background.tertiary} />
                </View>
                <Text style={styles.timeCode}>{fromCode}</Text>
                <TimeDisplay
                  time={departDelayMinutes && departDelayMinutes > 0 && departDelayedTime ? departDelayedTime : departTime}
                  dayOffset={departDelayMinutes && departDelayMinutes > 0 && departDelayedDayOffset != null ? departDelayedDayOffset : departDayOffset}
                  style={[styles.timeValue, pastColor, depColorKey && { color: DELAY_COLORS[depColorKey] }]}
                  superscriptStyle={[localStyles.timeSuperscript, depColorKey && { color: DELAY_COLORS[depColorKey] }]}
                />
              </View>
            );
          })()}

          {(() => {
            const arrColorKey = getDelayColorKey(arriveDelayMinutes);
            const arrBg = arrColorKey ? DELAY_COLORS[arrColorKey] : pastColor?.color ?? AppColors.secondary;
            return (
              <View style={styles.timeInfo}>
                <View style={[styles.arrowIcon, { backgroundColor: arrBg }]}>
                  <MaterialCommunityIcons name="arrow-bottom-left" size={10} color={AppColors.background.tertiary} />
                </View>
                <Text style={styles.timeCode}>{toCode}</Text>
                <TimeDisplay
                  time={arriveDelayMinutes && arriveDelayMinutes > 0 && arriveDelayedTime ? arriveDelayedTime : arriveTime}
                  dayOffset={arriveDelayMinutes && arriveDelayMinutes > 0 && arriveDelayedDayOffset != null ? arriveDelayedDayOffset : arriveDayOffset}
                  style={[styles.timeValue, pastColor, arrColorKey && { color: DELAY_COLORS[arrColorKey] }]}
                  superscriptStyle={[localStyles.timeSuperscript, arrColorKey && { color: DELAY_COLORS[arrColorKey] }]}
                />
              </View>
            );
          })()}
        </View>
      </View>
    </View>
  );
}

const localStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    padding: Spacing.lg,
  },
  stops: {
    fontSize: FontSizes.daysLabel,
    color: AppColors.secondary,
    marginLeft: 'auto',
  },
  timeSuperscript: {
    fontSize: 10,
    fontWeight: '600',
    color: AppColors.secondary,
    marginLeft: 2,
    marginTop: -2,
  },
});
