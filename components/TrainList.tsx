import * as Haptics from 'expo-haptics';
import { light as hapticLight } from '../utils/haptics';
import { TrainTrack } from 'lucide-react-native';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppColors, Spacing } from '../constants/theme';
import { COLORS, styles } from '../screens/styles';
import type { Train } from '../types/train';
import TimeDisplay from './ui/TimeDisplay';
import { SlideUpModalContext } from './ui/slide-up-modal';
import { parseTimeToDate } from '../utils/time-formatting';
import { getCountdownForTrain } from '../utils/train-display';

// Re-export for backwards compatibility
export { parseTimeToDate, getCountdownForTrain };

// First threshold - shows delete button
const FIRST_THRESHOLD = -80;
// Second threshold - triggers auto-delete on release
const SECOND_THRESHOLD = -200;

interface SwipeableTrainCardProps {
  train: Train;
  onPress: () => void;
  onDelete: () => void;
  isFirst?: boolean;
  contentOpacity?: SharedValue<number>;
}

function SwipeableTrainCard({ train, onPress, onDelete, isFirst, contentOpacity }: SwipeableTrainCardProps) {
  const translateX = useSharedValue(0);
  const hasTriggeredSecondHaptic = useSharedValue(false);
  const isDeleting = useSharedValue(false);

  const triggerSecondHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };

  const triggerDeleteHaptic = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleDelete = () => {
    triggerDeleteHaptic();
    onDelete();
  };

  const performDelete = () => {
    isDeleting.value = true;
    translateX.value = withTiming(-500, { duration: 200 }, () => {
      runOnJS(handleDelete)();
    });
  };

  const panGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-10, 10])
    .onUpdate(event => {
      if (isDeleting.value) return;

      // Only allow left swipe (negative values), no max limit
      const clampedX = Math.min(0, event.translationX);
      translateX.value = clampedX;

      // Haptic only when crossing second threshold (auto-delete point)
      if (clampedX <= SECOND_THRESHOLD && !hasTriggeredSecondHaptic.value) {
        hasTriggeredSecondHaptic.value = true;
        runOnJS(triggerSecondHaptic)();
      } else if (clampedX > SECOND_THRESHOLD && hasTriggeredSecondHaptic.value) {
        hasTriggeredSecondHaptic.value = false;
      }
    })
    .onEnd(() => {
      if (isDeleting.value) return;

      // If past second threshold, auto-delete
      if (translateX.value <= SECOND_THRESHOLD) {
        runOnJS(performDelete)();
      } else if (translateX.value <= FIRST_THRESHOLD) {
        // Snap to show delete button
        translateX.value = withSpring(FIRST_THRESHOLD, {
          damping: 50,
          stiffness: 200,
        });
      } else {
        // Snap back
        translateX.value = withSpring(0, {
          damping: 50,
          stiffness: 200,
        });
      }
      hasTriggeredSecondHaptic.value = false;
    });

  const triggerLightHaptic = () => {
    hapticLight();
  };

  const tapGesture = Gesture.Tap().onEnd(() => {
    if (isDeleting.value) return;

    if (translateX.value < -10) {
      // If swiped, tap closes it
      translateX.value = withSpring(0, {
        damping: 50,
        stiffness: 200,
      });
    } else {
      runOnJS(triggerLightHaptic)();
      runOnJS(onPress)();
    }
  });

  const composedGesture = Gesture.Race(panGesture, tapGesture);

  const cardAnimatedStyle = useAnimatedStyle(() => {
    const absX = Math.abs(translateX.value);
    // Fade from 1 to 0 as we go from FIRST_THRESHOLD to SECOND_THRESHOLD
    const fadeProgress = interpolate(absX, [Math.abs(FIRST_THRESHOLD), Math.abs(SECOND_THRESHOLD)], [1, 0], 'clamp');

    return {
      transform: [{ translateX: translateX.value }],
      opacity: fadeProgress,
    };
  });

  // Delete button container fills the revealed space
  const deleteContainerAnimatedStyle = useAnimatedStyle(() => {
    const absX = Math.abs(translateX.value);
    const progress = Math.min(1, absX / Math.abs(FIRST_THRESHOLD));

    return {
      opacity: progress,
      width: absX > 0 ? absX : 0,
    };
  });

  // Delete button (the pill) - icon alignment changes based on swipe distance
  const deleteButtonAnimatedStyle = useAnimatedStyle(() => {
    const absX = Math.abs(translateX.value);
    const pastSecondThreshold = absX >= Math.abs(SECOND_THRESHOLD);

    return {
      justifyContent: pastSecondThreshold ? 'flex-start' : 'center',
      paddingLeft: pastSecondThreshold ? 16 : 0,
    };
  });

  const countdown = getCountdownForTrain(train);
  // Proper pluralization: "1 HOUR" vs "2 HOURS"
  const singularUnit = countdown.unit.slice(0, -1); // Remove trailing 'S' (DAYS->DAY, HOURS->HOUR, etc.)
  const unitText = countdown.value === 1 ? singularUnit : countdown.unit;
  const unitLabel = `${unitText}${countdown.past ? ' AGO' : ''}`;
  const isPast = countdown.past;

  // Animated margin for first item - increases as modal collapses
  const firstItemMarginStyle = useAnimatedStyle(() => {
    if (!isFirst || !contentOpacity) {
      return {};
    }
    // When contentOpacity is 1 (half height), margin is default (Spacing.md)
    // When contentOpacity is 0 (collapsed), margin is 100
    const marginBottom = interpolate(contentOpacity.value, [0, 1], [100, Spacing.md], 'clamp');
    return {
      marginBottom,
    };
  });

  // Animated opacity for rest of the list (not the first item) - fades out as modal collapses
  const restItemOpacityStyle = useAnimatedStyle(() => {
    if (isFirst || !contentOpacity) {
      return {};
    }
    return {
      opacity: contentOpacity.value,
    };
  });

  const handleDeletePress = () => {
    performDelete();
  };

  return (
    <Animated.View style={[swipeStyles.container, firstItemMarginStyle, restItemOpacityStyle]}>
      {/* Delete button behind the card */}
      <Animated.View style={[swipeStyles.deleteButtonContainer, deleteContainerAnimatedStyle]}>
        <View style={swipeStyles.deleteButtonWrapper}>
          <GestureDetector gesture={Gesture.Tap().onEnd(() => runOnJS(handleDeletePress)())}>
            <Animated.View style={[swipeStyles.deleteButton, deleteButtonAnimatedStyle]}>
              <Ionicons name="trash" size={22} color={AppColors.primary} />
            </Animated.View>
          </GestureDetector>
        </View>
      </Animated.View>

      {/* The actual card */}
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.trainCard, { marginBottom: 0 }, cardAnimatedStyle]}>
          <View style={styles.trainLeft}>
            <Text style={[styles.daysAway, isPast && { color: COLORS.secondary }]}>{countdown.value}</Text>
            <Text style={[styles.daysLabel, isPast && { color: COLORS.secondary }]}>{unitLabel}</Text>
          </View>

          <View style={styles.trainCenter}>
            <View style={styles.trainHeader}>
              <Image source={require('../assets/images/amtrak.png')} style={styles.amtrakLogo} fadeDuration={0} />
              <Text style={[styles.trainNumber, { color: COLORS.secondary, fontWeight: '400' }]}>
                {train.routeName ? train.routeName : train.operator} {train.trainNumber}
              </Text>
              <Text style={styles.trainDate}>{train.date}</Text>
            </View>

            <Text style={[styles.route, { fontSize: 18 }]}>
              {train.from} to {train.to}
            </Text>

            <View style={styles.timeRow}>
              <View style={styles.timeInfo}>
                <View style={[styles.arrowIcon, styles.departureIcon]}>
                  <MaterialCommunityIcons name="arrow-top-right" size={8} color={AppColors.secondary} />
                </View>
                <Text style={styles.timeCode}>{train.fromCode}</Text>
                <TimeDisplay
                  time={train.departTime}
                  dayOffset={train.departDayOffset}
                  style={styles.timeValue}
                  superscriptStyle={swipeStyles.timeSuperscript}
                />
              </View>

              <View style={styles.timeInfo}>
                <View style={[styles.arrowIcon, styles.arrivalIcon]}>
                  <MaterialCommunityIcons name="arrow-bottom-left" size={8} color={AppColors.secondary} />
                </View>
                <Text style={styles.timeCode}>{train.toCode}</Text>
                <TimeDisplay
                  time={train.arriveTime}
                  dayOffset={train.arriveDayOffset}
                  style={styles.timeValue}
                  superscriptStyle={swipeStyles.timeSuperscript}
                />
              </View>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

interface TrainListProps {
  trains: Train[];
  onTrainSelect: (t: Train) => void;
  onDeleteTrain?: (train: Train) => void;
}

export function TrainList({ trains, onTrainSelect, onDeleteTrain }: TrainListProps) {
  const { contentOpacity } = React.useContext(SlideUpModalContext);

  if (trains.length === 0) {
    return (
      <View style={styles.noTrainsContainer}>
        <TrainTrack size={48} color={COLORS.primary} />
        <Text style={styles.noTrainsText}>No saved trips yet</Text>
      </View>
    );
  }

  return (
    <>
      {trains.map((train, index) => (
        <SwipeableTrainCard
          key={train.id}
          train={train}
          onPress={() => onTrainSelect(train)}
          onDelete={() => onDeleteTrain?.(train)}
          isFirst={index === 0}
          contentOpacity={contentOpacity}
        />
      ))}
    </>
  );
}

const swipeStyles = StyleSheet.create({
  container: {
    position: 'relative',
    marginBottom: Spacing.md,
  },
  deleteButtonContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingRight: 4,
    paddingLeft: 12,
  },
  deleteButtonWrapper: {
    height: 44,
    flex: 1,
    justifyContent: 'center',
  },
  deleteButton: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: AppColors.error,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  timeSuperscript: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.secondary,
    marginLeft: 2,
    marginTop: -2,
  },
});
