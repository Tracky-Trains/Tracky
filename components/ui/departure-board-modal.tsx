import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppColors, BorderRadius, Spacing } from '../../constants/theme';
import { TrainAPIService } from '../../services/api';
import type { Stop, Train } from '../../types/train';
import { addDays, getStartOfDay, isSameDay } from '../../utils/date-helpers';
import { logger } from '../../utils/logger';
import { parseTimeToMinutes } from '../../utils/time-formatting';
import { SlideUpModalContext } from './slide-up-modal';
import TimeDisplay from './TimeDisplay';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface DepartureBoardModalProps {
  station: Stop;
  onClose: () => void;
  onTrainSelect: (train: Train) => void;
  onSaveTrain?: (train: Train) => Promise<boolean>;
}

/**
 * Format date for display (e.g., "Today", "Tomorrow", "Jan 17")
 */
function formatDateDisplay(date: Date): string {
  const today = getStartOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const targetDate = getStartOfDay(date);

  if (isSameDay(targetDate, today)) {
    return 'Today';
  } else if (isSameDay(targetDate, tomorrow)) {
    return 'Tomorrow';
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

// parseTimeToMinutes is now imported from utils/time-formatting

/**
 * Check if a train is still upcoming based on the relevant time for the station
 * For terminating trains, check arrival time; for others, check departure/pass time
 */
function isTrainUpcoming(
  train: Train,
  selectedDate: Date,
  stationId: string,
  filterMode: 'all' | 'beginning' | 'terminating'
): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(selectedDate);
  targetDate.setHours(0, 0, 0, 0);

  // If selected date is not today, show all trains
  if (targetDate.getTime() !== today.getTime()) {
    return true;
  }

  // For today, determine which time to check based on filter mode and station
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let relevantTime: string;
  if (filterMode === 'terminating' || train.toCode === stationId) {
    // For terminating trains, use arrival time at this station
    relevantTime = train.arriveTime;
  } else if (train.fromCode === stationId) {
    // For beginning trains, use departure time
    relevantTime = train.departTime;
  } else {
    // For passing through trains, check intermediate stops or fall back to departure
    const stop = train.intermediateStops?.find(s => s.code === stationId);
    relevantTime = stop?.time || train.departTime;
  }

  const trainMinutes = parseTimeToMinutes(relevantTime);
  return trainMinutes > currentMinutes - 5; // 5 minute grace period
}

/**
 * Get the departure time for a specific station from a train's stops
 * Returns the time at the station, or falls back to origin departure time
 */
function getStationDepartureTime(train: Train, stationId: string): { time: string; dayOffset?: number } {
  // If station is the origin, use departTime
  if (train.fromCode === stationId) {
    return { time: train.departTime, dayOffset: train.departDayOffset };
  }

  // If station is the destination, use arriveTime
  if (train.toCode === stationId) {
    return { time: train.arriveTime, dayOffset: train.arriveDayOffset };
  }

  // Check intermediate stops for the station
  if (train.intermediateStops) {
    const stop = train.intermediateStops.find(s => s.code === stationId);
    if (stop) {
      return { time: stop.time, dayOffset: undefined };
    }
  }

  // Fallback to origin departure time
  return { time: train.departTime, dayOffset: train.departDayOffset };
}

// Swipe threshold - card bounces back at 50% of reveal width
const SWIPE_THRESHOLD = -80;
const BOUNCE_BACK_THRESHOLD = -40; // 50% of SWIPE_THRESHOLD

interface SwipeableDepartureItemProps {
  train: Train;
  stationTime: { time: string; dayOffset?: number };
  stationId: string;
  onPress: () => void;
  onSave: () => void;
}

function SwipeableDepartureItem({ train, stationTime, stationId, onPress, onSave }: SwipeableDepartureItemProps) {
  const translateX = useSharedValue(0);
  const hasTriggeredHaptic = useSharedValue(false);
  const isSaving = useSharedValue(false);

  const triggerHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const triggerSaveHaptic = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleSave = () => {
    triggerSaveHaptic();
    onSave();
    // Bounce back after saving
    translateX.value = withSpring(0, {
      damping: 50,
      stiffness: 200,
    });
  };

  const panGesture = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-10, 10])
    .onUpdate(event => {
      if (isSaving.value) return;

      // Only allow left swipe (negative values)
      const clampedX = Math.min(0, Math.max(SWIPE_THRESHOLD, event.translationX));
      translateX.value = clampedX;

      // Haptic when crossing threshold
      if (clampedX <= BOUNCE_BACK_THRESHOLD && !hasTriggeredHaptic.value) {
        hasTriggeredHaptic.value = true;
        runOnJS(triggerHaptic)();
      } else if (clampedX > BOUNCE_BACK_THRESHOLD && hasTriggeredHaptic.value) {
        hasTriggeredHaptic.value = false;
      }
    })
    .onEnd(() => {
      if (isSaving.value) return;

      // If past 50% threshold, trigger save and bounce back
      if (translateX.value <= BOUNCE_BACK_THRESHOLD) {
        runOnJS(handleSave)();
      } else {
        // Bounce back
        translateX.value = withSpring(0, {
          damping: 50,
          stiffness: 200,
        });
      }
      hasTriggeredHaptic.value = false;
    });

  const tapGesture = Gesture.Tap().onEnd(() => {
    if (isSaving.value) return;

    if (translateX.value < -10) {
      // If swiped, tap closes it
      translateX.value = withSpring(0, {
        damping: 50,
        stiffness: 200,
      });
    } else {
      runOnJS(onPress)();
    }
  });

  const composedGesture = Gesture.Race(panGesture, tapGesture);

  const cardAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }],
    };
  });

  const saveContainerAnimatedStyle = useAnimatedStyle(() => {
    const absX = Math.abs(translateX.value);
    const progress = Math.min(1, absX / Math.abs(BOUNCE_BACK_THRESHOLD));

    return {
      opacity: progress,
      width: absX > 0 ? absX : 0,
    };
  });

  const handleSavePress = () => {
    handleSave();
  };

  return (
    <View style={swipeStyles.container}>
      {/* Save button behind the card */}
      <Animated.View style={[swipeStyles.saveButtonContainer, saveContainerAnimatedStyle]}>
        <View style={swipeStyles.saveButtonWrapper}>
          <GestureDetector gesture={Gesture.Tap().onEnd(() => runOnJS(handleSavePress)())}>
            <Animated.View style={swipeStyles.saveButton}>
              <Ionicons name="bookmark" size={20} color="#fff" />
            </Animated.View>
          </GestureDetector>
        </View>
      </Animated.View>

      {/* The actual card */}
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.departureItem, { borderBottomWidth: 0 }, cardAnimatedStyle]}>
          <View style={styles.departureTime}>
            <TimeDisplay
              time={stationTime.time}
              dayOffset={stationTime.dayOffset}
              style={styles.timeText}
              superscriptStyle={styles.timeSuperscript}
            />
            {train.realtime?.delay != null && train.realtime.delay > 0 ? (
              <Text style={styles.delayText}>+{train.realtime.delay}m</Text>
            ) : null}
          </View>
          <View style={styles.departureInfo}>
            <View style={styles.trainHeader}>
              <Text style={styles.trainNumber}>
                {train.routeName || 'Amtrak'}
                {train.trainNumber ? ` ${train.trainNumber}` : ''}
              </Text>
              {train.realtime?.status ? (
                <View
                  style={[
                    styles.statusBadge,
                    train.realtime.delay != null && train.realtime.delay > 0
                      ? styles.statusDelayed
                      : styles.statusOnTime,
                  ]}
                >
                  <Text style={styles.statusText}>
                    {train.realtime.delay != null && train.realtime.delay > 0 ? 'Delayed' : 'On Time'}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.destinationRow}>
              <Text style={styles.destinationText}>
                {stationId === train.fromCode || stationId === train.toCode
                  ? `${train.fromCode} → ${train.toCode}`
                  : `${train.fromCode} → ${stationId} → ${train.toCode}`}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={AppColors.tertiary} />
        </Animated.View>
      </GestureDetector>
      {/* Border at bottom of container */}
      <View style={swipeStyles.borderBottom} />
    </View>
  );
}

export default function DepartureBoardModal({
  station,
  onClose,
  onTrainSelect,
  onSaveTrain,
}: DepartureBoardModalProps) {
  const [departures, setDepartures] = useState<Train[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'beginning' | 'terminating'>('all');

  const { isCollapsed, isFullscreen, scrollOffset, contentOpacity } = React.useContext(SlideUpModalContext);

  // Animated style for content that fades between half and collapsed states
  const fadeAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: contentOpacity.value,
    };
  });

  // Check if modal is at half height (not collapsed and not fullscreen)
  const isHalfHeight = !isCollapsed && !isFullscreen;

  // Fetch departures for the station
  useEffect(() => {
    const fetchDepartures = async () => {
      setLoading(true);
      try {
        const trains = await TrainAPIService.getTrainsForStation(station.stop_id, selectedDate);
        // Sort by departure time
        trains.sort((a, b) => {
          const aMinutes = parseTimeToMinutes(a.departTime);
          const bMinutes = parseTimeToMinutes(b.departTime);
          return aMinutes - bMinutes;
        });
        // Deduplicate by train number + departure time (same train on different days has different tripIds)
        const seen = new Set<string>();
        const deduped = trains.filter(train => {
          const key = `${train.trainNumber}-${train.departTime}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setDepartures(deduped);
      } catch (error) {
        logger.error('Error fetching departures:', error);
        setDepartures([]);
      } finally {
        setLoading(false);
      }
    };

    fetchDepartures();
  }, [station.stop_id, selectedDate]);

  // Filter departures based on search, date, and filter mode
  const filteredDepartures = useMemo(() => {
    const filtered = departures.filter(train => {
      // Filter by upcoming time for today (using relevant time based on filter mode)
      if (!isTrainUpcoming(train, selectedDate, station.stop_id, filterMode)) {
        return false;
      }

      // Filter by beginning/terminating mode
      if (filterMode !== 'all') {
        // For beginning: only show trains where this station is the origin
        const isBeginning = train.fromCode === station.stop_id;
        // For terminating: only show trains where this station is the final destination
        const isTerminating = train.toCode === station.stop_id;
        if (filterMode === 'beginning' && !isBeginning) return false;
        if (filterMode === 'terminating' && !isTerminating) return false;
      }

      // Filter by search query (destination, train number, route name)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesDestination = train.to.toLowerCase().includes(query);
        const matchesToCode = train.toCode.toLowerCase().includes(query);
        const matchesOrigin = train.from.toLowerCase().includes(query);
        const matchesFromCode = train.fromCode.toLowerCase().includes(query);
        const matchesTrainNumber = train.trainNumber.toLowerCase().includes(query);
        const matchesRouteName = train.routeName?.toLowerCase().includes(query);
        return (
          matchesDestination ||
          matchesToCode ||
          matchesOrigin ||
          matchesFromCode ||
          matchesTrainNumber ||
          matchesRouteName
        );
      }

      return true;
    });

    // Sort based on filter mode
    return filtered.sort((a, b) => {
      if (filterMode === 'terminating') {
        // Sort by arrival time at this station
        const aMinutes = parseTimeToMinutes(a.arriveTime);
        const bMinutes = parseTimeToMinutes(b.arriveTime);
        return aMinutes - bMinutes;
      } else if (filterMode === 'beginning') {
        // Sort by departure time (this station is the origin)
        const aMinutes = parseTimeToMinutes(a.departTime);
        const bMinutes = parseTimeToMinutes(b.departTime);
        return aMinutes - bMinutes;
      } else {
        // 'all' mode: sort by the time at this station
        const aTime = getStationDepartureTime(a, station.stop_id);
        const bTime = getStationDepartureTime(b, station.stop_id);
        const aMinutes = parseTimeToMinutes(aTime.time);
        const bMinutes = parseTimeToMinutes(bTime.time);
        return aMinutes - bMinutes;
      }
    });
  }, [departures, selectedDate, searchQuery, filterMode, station.stop_id]);

  // Date navigation
  const navigateDate = useCallback((direction: 'prev' | 'next') => {
    setSelectedDate(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
      return newDate;
    });
  }, []);

  const canGoBack = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(selectedDate);
    selected.setHours(0, 0, 0, 0);
    return selected.getTime() > today.getTime();
  }, [selectedDate]);

  // Handle date picker change
  const handleDateChange = useCallback((event: DateTimePickerEvent, date?: Date) => {
    // On Android, the picker closes automatically; on iOS, we need to handle it
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (event.type === 'set' && date) {
      // Ensure date is not in the past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const newDate = new Date(date);
      newDate.setHours(0, 0, 0, 0);
      if (newDate.getTime() >= today.getTime()) {
        setSelectedDate(date);
      }
    }
  }, []);

  // Close date picker on iOS
  const handleDatePickerDone = useCallback(() => {
    setShowDatePicker(false);
  }, []);

  const handleTrainPress = useCallback(
    (train: Train) => {
      // For terminating: keep original origin, set destination to this station
      // For beginning/all: set origin to this station, keep original destination
      // Also update the departure/arrival times to match the station
      const stationTime = getStationDepartureTime(train, station.stop_id);
      const updatedTrain: Train =
        filterMode === 'terminating'
          ? {
              ...train,
              // Explicitly preserve the original origin
              fromCode: train.fromCode,
              from: train.from,
              // Set destination to this station
              toCode: station.stop_id,
              to: station.stop_name,
              arriveTime: stationTime.time,
              arriveDayOffset: stationTime.dayOffset,
            }
          : {
              ...train,
              // Set origin to this station
              fromCode: station.stop_id,
              from: station.stop_name,
              departTime: stationTime.time,
              departDayOffset: stationTime.dayOffset,
              // Explicitly preserve the original destination
              toCode: train.toCode,
              to: train.to,
            };
      onTrainSelect(updatedTrain);
    },
    [station, onTrainSelect, filterMode]
  );

  return (
    <View style={styles.modalContent}>
      {/* Fixed Header Area */}
      <View style={[styles.fixedHeader, isScrolled && styles.fixedHeaderScrolled]}>
        {/* Header - Title and close button */}
        <View style={styles.header}>
          <View style={styles.headerTextContainer}>
            <Text style={styles.headerSubtitle}>{station.stop_id}</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {station.stop_name}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.6}>
            <Ionicons name="close" size={24} color={AppColors.primary} />
          </TouchableOpacity>
        </View>

        <Animated.View style={fadeAnimatedStyle} pointerEvents={isCollapsed ? 'none' : 'auto'}>
          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={18} color={AppColors.secondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by destination or train..."
              placeholderTextColor={AppColors.tertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={AppColors.secondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Date Selector and Filter Row */}
          <View style={styles.dateSelectorRow}>
            {/* Date Navigation */}
            <View style={styles.dateSelector}>
              <TouchableOpacity
                style={[styles.dateArrow, !canGoBack && styles.dateArrowDisabled]}
                onPress={() => canGoBack && navigateDate('prev')}
                disabled={!canGoBack}
              >
                <Ionicons name="chevron-back" size={20} color={canGoBack ? AppColors.primary : AppColors.tertiary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.dateDisplay} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
                <Ionicons name="calendar-outline" size={16} color={AppColors.secondary} />
                <Text style={styles.dateText}>{formatDateDisplay(selectedDate)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dateArrow} onPress={() => navigateDate('next')}>
                <Ionicons name="chevron-forward" size={20} color={AppColors.primary} />
              </TouchableOpacity>
            </View>

            {/* Filter Toggle - integrated pill style */}
            <View style={styles.filterToggle}>
              <TouchableOpacity
                style={[
                  styles.filterButton,
                  styles.filterButtonLeft,
                  filterMode === 'all' && styles.filterButtonActive,
                ]}
                onPress={() => setFilterMode('all')}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterText, filterMode === 'all' && styles.filterTextActive]}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterButton, filterMode === 'beginning' && styles.filterButtonActive]}
                onPress={() => setFilterMode('beginning')}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="arrow-top-right"
                  size={18}
                  color={filterMode === 'beginning' ? AppColors.primary : AppColors.tertiary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.filterButton,
                  styles.filterButtonRight,
                  filterMode === 'terminating' && styles.filterButtonActive,
                ]}
                onPress={() => setFilterMode('terminating')}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="arrow-bottom-left"
                  size={18}
                  color={filterMode === 'terminating' ? AppColors.primary : AppColors.tertiary}
                />
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>

      <Animated.View style={[{ flex: 1 }, fadeAnimatedStyle]} pointerEvents={isCollapsed ? 'none' : 'auto'}>
        {/* Date Picker */}
        {showDatePicker && (
          <View style={styles.datePickerContainer}>
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={handleDateChange}
              minimumDate={new Date()}
              themeVariant="dark"
              accentColor="#FFFFFF"
            />
            {Platform.OS === 'ios' && (
              <TouchableOpacity style={styles.datePickerDoneButton} onPress={handleDatePickerDone}>
                <Text style={styles.datePickerDoneText}>Done</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: isHalfHeight ? SCREEN_HEIGHT * 0.5 : 100 }}
          showsVerticalScrollIndicator={true}
          onScroll={e => {
            const offsetY = e.nativeEvent.contentOffset.y;
            if (scrollOffset) scrollOffset.value = offsetY;
            setIsScrolled(offsetY > 0);
          }}
          scrollEventThrottle={16}
          bounces={true}
          nestedScrollEnabled={true}
        >
          {/* Departures List */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={AppColors.primary} />
              <Text style={styles.loadingText}>Loading departures...</Text>
            </View>
          ) : filteredDepartures.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="train-outline" size={48} color={AppColors.tertiary} />
              <Text style={styles.emptyText}>
                {searchQuery
                  ? 'No trains match your search'
                  : filterMode === 'beginning'
                    ? 'No trains found beginning at this station'
                    : filterMode === 'terminating'
                      ? 'No trains found terminating at this station'
                      : 'No trains found for this station'}
              </Text>
            </View>
          ) : (
            <View style={styles.departuresList}>
              <Text style={styles.sectionTitle}>
                {filterMode === 'terminating' ? 'Terminating' : filterMode === 'beginning' ? 'Beginning' : 'All Trains'}{' '}
                ({filteredDepartures.length})
              </Text>
              {filteredDepartures.map((train, index) => {
                if (!train || !train.departTime) return null;
                // Get the correct time for this station (not the origin's departure time)
                const stationTime =
                  filterMode === 'terminating'
                    ? { time: train.arriveTime, dayOffset: train.arriveDayOffset }
                    : getStationDepartureTime(train, station.stop_id);
                return (
                  <SwipeableDepartureItem
                    key={`${train.tripId || train.id}-${index}`}
                    train={train}
                    stationTime={stationTime}
                    stationId={station.stop_id}
                    onPress={() => handleTrainPress(train)}
                    onSave={() => onSaveTrain?.(train)}
                  />
                );
              })}
            </View>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  modalContent: {
    flex: 1,
    marginHorizontal: -Spacing.xl,
  },
  fixedHeader: {
    backgroundColor: 'transparent',
    zIndex: 10,
  },
  fixedHeaderScrolled: {
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border.primary,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: 0,
    paddingBottom: Spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  scrollContent: {
    flex: 1,
  },
  headerTextContainer: {
    flex: 1,
    marginRight: 48 + Spacing.md,
  },
  headerSubtitle: {
    fontSize: 14,
    color: AppColors.secondary,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: AppColors.primary,
  },
  closeButton: {
    position: 'absolute',
    zIndex: 20,
    right: Spacing.xl,
    top: -Spacing.sm,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: AppColors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: AppColors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: AppColors.border.primary,
  },
  dateSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  dateSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AppColors.background.tertiary,
    borderRadius: 18,
    height: 36,
  },
  filterButton: {
    height: 36,
    paddingHorizontal: Spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterButtonLeft: {
    borderTopLeftRadius: 18,
    borderBottomLeftRadius: 18,
  },
  filterButtonRight: {
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
  },
  filterButtonActive: {
    backgroundColor: AppColors.background.tertiary,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: AppColors.tertiary,
  },
  filterTextActive: {
    color: AppColors.primary,
  },
  dateArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: AppColors.background.tertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateArrowDisabled: {
    backgroundColor: AppColors.background.primary,
  },
  dateDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: AppColors.background.tertiary,
    borderRadius: BorderRadius.md,
  },
  dateText: {
    fontSize: 16,
    fontWeight: '600',
    color: AppColors.primary,
  },
  datePickerContainer: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    backgroundColor: AppColors.background.tertiary,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  datePickerDoneButton: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: AppColors.border.primary,
  },
  datePickerDoneText: {
    fontSize: 16,
    fontWeight: '600',
    color: AppColors.accent,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.xl,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: AppColors.background.tertiary,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: AppColors.primary,
    paddingVertical: Spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: Spacing.md,
    fontSize: 14,
    color: AppColors.secondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    marginTop: Spacing.md,
    fontSize: 14,
    color: AppColors.secondary,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
  },
  departuresList: {
    paddingHorizontal: Spacing.xl,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: AppColors.secondary,
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  departureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border.primary,
  },
  departureTime: {
    width: 80,
    alignItems: 'flex-start',
  },
  timeText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: AppColors.primary,
  },
  timeSuperscript: {
    fontSize: 10,
    fontWeight: '600',
    color: AppColors.secondary,
    marginLeft: 2,
    marginTop: -2,
  },
  delayText: {
    fontSize: 12,
    color: AppColors.error,
    fontWeight: '600',
    marginTop: 2,
  },
  departureInfo: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  trainHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 4,
  },
  trainNumber: {
    fontSize: 15,
    fontWeight: '600',
    color: AppColors.primary,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
  },
  statusOnTime: {
    backgroundColor: '#1A332E',
  },
  statusDelayed: {
    backgroundColor: '#3A1A1A',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: AppColors.primary,
  },
  destinationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  destinationText: {
    fontSize: 14,
    color: AppColors.secondary,
  },
  arrivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  arrivalText: {
    fontSize: 12,
    color: AppColors.tertiary,
  },
  arrivalSuperscript: {
    fontSize: 8,
    fontWeight: '600',
    color: AppColors.tertiary,
    marginLeft: 1,
    marginTop: -2,
  },
});

const swipeStyles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  saveButtonContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingRight: 4,
    paddingLeft: 12,
  },
  saveButtonWrapper: {
    height: 36,
    flex: 1,
    justifyContent: 'center',
  },
  saveButton: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: AppColors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  borderBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: AppColors.border.primary,
  },
});
