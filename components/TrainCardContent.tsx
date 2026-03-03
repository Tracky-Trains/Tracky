import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppColors, FontSizes, Spacing } from '../constants/theme';
import { COLORS, styles } from '../screens/styles';
import TimeDisplay from './ui/TimeDisplay';

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
          <View style={styles.timeInfo}>
            <View style={[styles.arrowIcon, styles.departureIcon]}>
              <MaterialCommunityIcons name="arrow-top-right" size={8} color={AppColors.secondary} />
            </View>
            <Text style={styles.timeCode}>{fromCode}</Text>
            <TimeDisplay
              time={departTime}
              dayOffset={departDayOffset}
              style={[styles.timeValue, pastColor]}
              superscriptStyle={localStyles.timeSuperscript}
            />
          </View>

          <View style={styles.timeInfo}>
            <View style={[styles.arrowIcon, styles.arrivalIcon]}>
              <MaterialCommunityIcons name="arrow-bottom-left" size={8} color={AppColors.secondary} />
            </View>
            <Text style={styles.timeCode}>{toCode}</Text>
            <TimeDisplay
              time={arriveTime}
              dayOffset={arriveDayOffset}
              style={[styles.timeValue, pastColor]}
              superscriptStyle={localStyles.timeSuperscript}
            />
          </View>
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
