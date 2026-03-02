import * as Haptics from 'expo-haptics';
import { light as hapticLight } from '../../utils/haptics';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppColors, BorderRadius, FontSizes, Spacing } from '../../constants/theme';
import { useUnits } from '../../context/UnitsContext';
import { TrainStorageService } from '../../services/storage';
import type { CompletedTrip } from '../../types/train';
import { calculateProfileStats, formatDuration } from '../../utils/profile-stats';
import { formatDistance } from '../../utils/units';
import { SlideUpModalContext } from './slide-up-modal';

interface ProfileModalProps {
  onClose: () => void;
  onOpenSettings: () => void;
}

const FIRST_THRESHOLD = -80;
const SECOND_THRESHOLD = -200;

const SwipeableHistoryCard = React.memo(function SwipeableHistoryCard({
  trip,
  onDelete,
}: {
  trip: CompletedTrip;
  onDelete: () => void;
}) {
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
      const clampedX = Math.min(0, event.translationX);
      translateX.value = clampedX;

      if (clampedX <= SECOND_THRESHOLD && !hasTriggeredSecondHaptic.value) {
        hasTriggeredSecondHaptic.value = true;
        runOnJS(triggerSecondHaptic)();
      } else if (clampedX > SECOND_THRESHOLD && hasTriggeredSecondHaptic.value) {
        hasTriggeredSecondHaptic.value = false;
      }
    })
    .onEnd(() => {
      if (isDeleting.value) return;

      if (translateX.value <= SECOND_THRESHOLD) {
        runOnJS(performDelete)();
      } else if (translateX.value <= FIRST_THRESHOLD) {
        translateX.value = withSpring(FIRST_THRESHOLD, {
          damping: 50,
          stiffness: 200,
        });
      } else {
        translateX.value = withSpring(0, {
          damping: 50,
          stiffness: 200,
        });
      }
      hasTriggeredSecondHaptic.value = false;
    });

  const tapGesture = Gesture.Tap().onEnd(() => {
    if (isDeleting.value) return;
    if (translateX.value < -10) {
      translateX.value = withSpring(0, { damping: 50, stiffness: 200 });
    }
  });

  const composedGesture = Gesture.Race(panGesture, tapGesture);

  const cardAnimatedStyle = useAnimatedStyle(() => {
    const absX = Math.abs(translateX.value);
    const fadeProgress = interpolate(
      absX,
      [Math.abs(FIRST_THRESHOLD), Math.abs(SECOND_THRESHOLD)],
      [1, 0],
      'clamp',
    );
    return {
      transform: [{ translateX: translateX.value }],
      opacity: fadeProgress,
    };
  });

  const deleteContainerAnimatedStyle = useAnimatedStyle(() => {
    const absX = Math.abs(translateX.value);
    const progress = Math.min(1, absX / Math.abs(FIRST_THRESHOLD));
    return {
      opacity: progress,
      width: absX > 0 ? absX : 0,
    };
  });

  const deleteButtonAnimatedStyle = useAnimatedStyle(() => {
    const absX = Math.abs(translateX.value);
    const pastSecond = absX >= Math.abs(SECOND_THRESHOLD);
    return {
      justifyContent: pastSecond ? 'flex-start' : 'center',
      paddingLeft: pastSecond ? 16 : 0,
    };
  });

  const handleDeletePress = () => {
    performDelete();
  };

  return (
    <View style={swipeStyles.container}>
      {/* Delete button behind the card */}
      <Animated.View style={[swipeStyles.deleteButtonContainer, deleteContainerAnimatedStyle]}>
        <View style={swipeStyles.deleteButtonWrapper}>
          <GestureDetector gesture={Gesture.Tap().onEnd(() => runOnJS(handleDeletePress)())}>
            <Animated.View style={[swipeStyles.deleteButton, deleteButtonAnimatedStyle]}>
              <Ionicons name="trash" size={22} color="#fff" />
            </Animated.View>
          </GestureDetector>
        </View>
      </Animated.View>

      {/* The actual card */}
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.historyCard, { marginBottom: 0 }, cardAnimatedStyle]}>
          <View style={styles.historyHeader}>
            <Image
              source={require('../../assets/images/amtrak.png')}
              style={styles.amtrakLogo}
              fadeDuration={0}
            />
            <Text style={styles.historyTrainNumber}>
              {trip.routeName || 'Amtrak'} {trip.trainNumber}
            </Text>
            <Text style={styles.historyDate}>{trip.date}</Text>
          </View>

          <Text style={styles.historyRoute}>
            {trip.from} to {trip.to}
          </Text>

          <View style={styles.historyTimeRow}>
            <View style={styles.timeInfo}>
              <View style={[styles.arrowIcon, styles.departureIcon]}>
                <MaterialCommunityIcons name="arrow-top-right" size={8} color={AppColors.secondary} />
              </View>
              <Text style={styles.timeCode}>{trip.fromCode}</Text>
              <Text style={styles.timeValue}>{trip.departTime}</Text>
            </View>

            <View style={styles.timeInfo}>
              <View style={[styles.arrowIcon, styles.arrivalIcon]}>
                <MaterialCommunityIcons name="arrow-bottom-left" size={8} color={AppColors.secondary} />
              </View>
              <Text style={styles.timeCode}>{trip.toCode}</Text>
              <Text style={styles.timeValue}>{trip.arriveTime}</Text>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

type SortField = 'date' | 'from' | 'to' | 'route';
type SortDirection = 'asc' | 'desc';

export default function ProfileModal({ onClose, onOpenSettings }: ProfileModalProps) {
  const [history, setHistory] = useState<CompletedTrip[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const { isFullscreen, scrollOffset, panRef } = React.useContext(SlideUpModalContext);
  const { distanceUnit } = useUnits();

  const currentYear = new Date().getFullYear();

  // Get unique years from trip history, sorted descending
  const years = useMemo(() => {
    const yearSet = new Set<number>();
    history.forEach(trip => {
      const tripYear = new Date(trip.travelDate).getFullYear();
      yearSet.add(tripYear);
    });
    return Array.from(yearSet).sort((a, b) => b - a);
  }, [history]);

  useEffect(() => {
    TrainStorageService.backfillHistoryStats()
      .then(() => TrainStorageService.getTripHistory())
      .then(setHistory);
  }, []);

  const handleDeleteHistory = useCallback(async (trip: CompletedTrip) => {
    await TrainStorageService.deleteFromHistory(trip.tripId, trip.fromCode, trip.toCode);
    const updated = await TrainStorageService.getTripHistory();
    setHistory(updated);
  }, []);

  const stats = useMemo(() =>
    calculateProfileStats(history, selectedYear || undefined),
    [history, selectedYear]
  );

  // Toggle sort field or direction
  const handleSortPress = useCallback((field: SortField) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to descending for date, ascending for others
      setSortField(field);
      setSortDirection(field === 'date' ? 'desc' : 'asc');
    }
  }, [sortField]);

  // Filter and sort history
  const filteredAndSortedHistory = useMemo(() => {
    let filtered = history.filter(trip => {
      if (!selectedYear) return true;
      return new Date(trip.travelDate).getFullYear() === selectedYear;
    });

    // Sort based on selected field
    return filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'date':
          comparison = new Date(a.travelDate).getTime() - new Date(b.travelDate).getTime();
          break;
        case 'from':
          comparison = (a.from || '').localeCompare(b.from || '');
          break;
        case 'to':
          comparison = (a.to || '').localeCompare(b.to || '');
          break;
        case 'route':
          comparison = (a.routeName || '').localeCompare(b.routeName || '');
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [history, selectedYear, sortField, sortDirection]);

  // Group trips based on sort field
  const groupedTrips = useMemo(() => {
    const groups: { [key: string]: CompletedTrip[] } = {};
    
    filteredAndSortedHistory.forEach(trip => {
      let groupKey = '';
      
      switch (sortField) {
        case 'date':
          groupKey = new Date(trip.travelDate).getFullYear().toString();
          break;
        case 'from':
          groupKey = `${trip.from} (${trip.fromCode})`;
          break;
        case 'to':
          groupKey = `${trip.to} (${trip.toCode})`;
          break;
        case 'route':
          groupKey = trip.routeName || 'Unknown Route';
          break;
      }
      
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(trip);
    });
    
    // Sort group keys based on field type and direction
    const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
      let comparison = 0;
      
      if (sortField === 'date') {
        // For dates (years), sort numerically
        comparison = parseInt(a) - parseInt(b);
      } else {
        // For other fields, sort alphabetically
        comparison = a.localeCompare(b);
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    
    // Return ordered array of [key, value] pairs
    return sortedGroupKeys.map(key => [key, groups[key]] as [string, CompletedTrip[]]);
  }, [filteredAndSortedHistory, sortField, sortDirection]);

  const handleSharePassport = useCallback(async () => {
    hapticLight();
    const yearText = selectedYear || 'All-Time';
    const message = `🚂 My Train Passport ${yearText}\n\n` +
      `✈️ Trips: ${stats.totalTrips}\n` +
      `📍 Distance: ${formatDistance(stats.totalDistance, distanceUnit)}\n` +
      `⏱️ Travel Time: ${formatDuration(stats.totalDuration)}\n` +
      `🚉 Stations: ${stats.uniqueStations}\n` +
      `🛤️ Routes: ${stats.uniqueRoutes}`;

    try {
      await Share.share({ message });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  }, [selectedYear, stats, distanceUnit]);

  const handleShareDelays = useCallback(async () => {
    hapticLight();
    const yearText = selectedYear || 'All-Time';
    const totalHours = Math.floor(stats.totalDelayMinutes / 60);
    const avgMinutes = Math.round(stats.averageDelayMinutes);
    
    const message = `🚂 My Train Delay Stats ${yearText}\n\n` +
      `⏰ ${totalHours} hours lost from delays\n` +
      `📊 Delayed trips averaged ${avgMinutes}m late`;
    
    try {
      await Share.share({ message });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  }, [selectedYear, stats]);

  const handleShareMostRidden = useCallback(async () => {
    hapticLight();
    if (!stats.mostRiddenRoute) return;
    
    const message = `🚂 Most Ridden Route\n\n` +
      `${stats.mostRiddenRoute.routeName}\n` +
      `${stats.mostRiddenRoute.count} trips`;
    
    try {
      await Share.share({ message });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  }, [stats]);

  const handleYearPress = useCallback((year: number | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedYear(year);
  }, []);

  const handleClosePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  }, [onClose]);

  const handleSettingsPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onOpenSettings();
  }, [onOpenSettings]);

  const handleComingSoon = useCallback((title: string, message: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(title, message);
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {/* Header with Profile Info */}
      <View style={styles.profileHeader}>
        <View style={styles.profileInfo}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarEmoji}>🚂</Text>
          </View>
          <View style={styles.profileTextContainer}>
            <Text style={styles.profileName}>Tracky</Text>
            <Text style={styles.profileSubtitle}>My Train Log</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={handleClosePress}
          style={styles.closeButton}
          activeOpacity={0.6}
        >
          <Ionicons name="close" size={24} color={AppColors.primary} />
        </TouchableOpacity>
      </View>

      {/* Action Pills */}
      <View style={styles.actionPillsContainer}>
        {/* <TouchableOpacity
          style={styles.actionPill}
          activeOpacity={0.7}
          onPress={() => {}}
        >
          <Ionicons name="people" size={14} color={AppColors.secondary} />
          <Text style={styles.actionPillText}>Rail Friends</Text>
        </TouchableOpacity> */}
        <TouchableOpacity
          style={styles.actionPill}
          activeOpacity={0.6}
          onPress={handleSettingsPress}
        >
          <Ionicons name="settings-sharp" size={14} color={AppColors.primary} />
          <Text style={styles.actionPillText}>Settings</Text>
        </TouchableOpacity>
      </View>

      {/* Year Filter */}
      {history.length > 0 && (
        <View style={styles.yearFilterContainer}>
          <TouchableOpacity
            style={[styles.yearButton, selectedYear === null && styles.yearButtonActive]}
            onPress={() => handleYearPress(null)}
            activeOpacity={0.6}
          >
            <Text style={[styles.yearButtonText, selectedYear === null && styles.yearButtonTextActive]}>
              ALL-TIME
            </Text>
          </TouchableOpacity>
          {years.map(year => (
            <TouchableOpacity
              key={year}
              style={[styles.yearButton, selectedYear === year && styles.yearButtonActive]}
              onPress={() => handleYearPress(year)}
              activeOpacity={0.6}
            >
              <Text style={[styles.yearButtonText, selectedYear === year && styles.yearButtonTextActive]}>
                {year}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Scrollable Content */}
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={isFullscreen}
        bounces={false}
        nestedScrollEnabled={true}
        onScroll={e => {
          scrollOffset.value = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        waitFor={panRef}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Passport Card */}
        <View style={styles.passportCard}>
          <View style={styles.passportHeader}>
            <View style={styles.passportTitleRow}>
              <MaterialCommunityIcons name="train" size={20} color="#fff" />
              <Text style={styles.passportTitle}>
                {selectedYear || 'ALL-TIME'} TRAIN PASSPORT
              </Text>
            </View>
            <TouchableOpacity onPress={handleSharePassport} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.6}>
              <Ionicons name="share-outline" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          <Text style={styles.passportSubtitle}>🎫 PASSPORT • PASS • RAIL PASS</Text>

          <View style={styles.passportStatsGrid}>
            <View style={styles.passportStatBlock}>
              <Text style={styles.passportStatLabel}>TRIPS</Text>
              <Text style={styles.passportStatValue} numberOfLines={1}>{stats.totalTrips}</Text>
            </View>
            <View style={styles.passportStatBlock}>
              <Text style={styles.passportStatLabel}>DISTANCE</Text>
              <Text style={styles.passportStatValue} numberOfLines={1}>{formatDistance(stats.totalDistance, distanceUnit)}</Text>
              <Text style={styles.passportStatSubtext}>
                {stats.totalDistance > 0 ? `${(stats.totalDistance / 24901).toFixed(1)}x around the world` : '—'}
              </Text>
            </View>
          </View>

          <View style={styles.passportStatsRow}>
            <View style={styles.passportStatSmall}>
              <Text style={styles.passportStatLabel}>TRAVEL TIME</Text>
              <Text style={styles.passportStatValueSmall} numberOfLines={1}>{formatDuration(stats.totalDuration)}</Text>
            </View>
            <View style={styles.passportStatSmall}>
              <Text style={styles.passportStatLabel}>STATIONS</Text>
              <Text style={styles.passportStatValueSmall} numberOfLines={1}>{stats.uniqueStations}</Text>
            </View>
            <View style={styles.passportStatSmall}>
              <Text style={styles.passportStatLabel}>ROUTES</Text>
              <Text style={styles.passportStatValueSmall} numberOfLines={1}>{stats.uniqueRoutes}</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.allStatsButton} activeOpacity={0.6} onPress={() => handleComingSoon('Coming Soon', 'Detailed train stats are on the way!')}>
            <Text style={styles.allStatsButtonText}>All Train Stats</Text>
            <Ionicons name="chevron-forward" size={16} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Delay Stats Card */}
        {stats.delayedTripsCount > 0 && (
          <View style={styles.delayCard}>
            <View style={styles.delayHeader}>
              <Text style={styles.delayBigNumber}>{Math.floor(stats.totalDelayMinutes / 60)}</Text>
              <TouchableOpacity onPress={handleShareDelays} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.6}>
                <Ionicons name="share-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={styles.delayTitle}>hours lost from delays</Text>
            <Text style={styles.delaySubtext}>
              Delayed trips averaged {Math.round(stats.averageDelayMinutes)}m late
            </Text>
            <TouchableOpacity style={styles.delayButton} activeOpacity={0.6} onPress={() => handleComingSoon('Coming Soon', 'Detailed delay stats are on the way!')}>
              <Text style={styles.delayButtonText}>All Delay Stats</Text>
              <Ionicons name="chevron-forward" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        )}

        {/* Most Ridden Route Card */}
        {stats.mostRiddenRoute && stats.mostRiddenRoute.count > 1 && (
          <View style={styles.mostRiddenCard}>
            <View style={styles.mostRiddenHeader}>
              <Text style={styles.mostRiddenTitle}>Most ridden route</Text>
              <TouchableOpacity onPress={handleShareMostRidden} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.6}>
                <Ionicons name="share-outline" size={22} color={AppColors.secondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.mostRiddenRouteName}>{stats.mostRiddenRoute.routeName}</Text>
            <Text style={styles.mostRiddenCount}>{stats.mostRiddenRoute.count} trips</Text>
            <View style={styles.mostRiddenIcon}>
              <MaterialCommunityIcons name="train-car" size={32} color={AppColors.secondary} />
            </View>
          </View>
        )}

        {/* Trip History Section */}
        <Text style={styles.sectionLabel}>PAST TRIPS</Text>
        
        {/* Filter/Sort Bar */}
        {history.length > 0 && (
          <View style={styles.filterBar}>
            <TouchableOpacity
              style={[styles.filterButton, sortField === 'date' && styles.filterButtonActive]}
              onPress={() => handleSortPress('date')}
              activeOpacity={0.6}
            >
              <Text style={[styles.filterButtonText, sortField === 'date' && styles.filterButtonTextActive]}>
                Date {sortField === 'date' && (sortDirection === 'desc' ? '↓' : '↑')}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.filterButton, sortField === 'from' && styles.filterButtonActive]}
              onPress={() => handleSortPress('from')}
              activeOpacity={0.6}
            >
              <Text style={[styles.filterButtonText, sortField === 'from' && styles.filterButtonTextActive]}>
                From {sortField === 'from' && (sortDirection === 'desc' ? '↓' : '↑')}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.filterButton, sortField === 'to' && styles.filterButtonActive]}
              onPress={() => handleSortPress('to')}
              activeOpacity={0.6}
            >
              <Text style={[styles.filterButtonText, sortField === 'to' && styles.filterButtonTextActive]}>
                To {sortField === 'to' && (sortDirection === 'desc' ? '↓' : '↑')}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.filterButton, sortField === 'route' && styles.filterButtonActive]}
              onPress={() => handleSortPress('route')}
              activeOpacity={0.6}
            >
              <Text style={[styles.filterButtonText, sortField === 'route' && styles.filterButtonTextActive]}>
                Route {sortField === 'route' && (sortDirection === 'desc' ? '↓' : '↑')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Grouped trips with separators */}
        {filteredAndSortedHistory.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="time-outline" size={36} color={AppColors.secondary} />
            <Text style={styles.emptyText}>No past trips yet</Text>
            <Text style={styles.emptySubtext}>Completed trips will appear here</Text>
          </View>
        ) : (
          groupedTrips.map(([groupKey, trips]) => (
            <View key={groupKey}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupHeaderText}>{groupKey}</Text>
                <Text style={styles.groupHeaderCount}>
                  {trips.length} {trips.length === 1 ? 'TRIP' : 'TRIPS'}
                </Text>
              </View>
              {trips.map((trip, index) => (
                <SwipeableHistoryCard
                  key={`${trip.tripId}-${trip.fromCode}-${index}`}
                  trip={trip}
                  onDelete={() => handleDeleteHistory(trip)}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
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
});

const styles = StyleSheet.create({
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
    paddingTop: Spacing.xs,
  },
  profileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatarContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: AppColors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: AppColors.border.primary,
  },
  avatarEmoji: {
    fontSize: 32,
  },
  profileTextContainer: {
    gap: 2,
  },
  profileName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: AppColors.primary,
  },
  profileSubtitle: {
    fontSize: 15,
    color: AppColors.secondary,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: AppColors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppColors.border.primary,
  },
  actionPillsContainer: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AppColors.background.secondary,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 5,
    borderWidth: 1,
    borderColor: AppColors.border.secondary,
  },
  actionPillText: {
    fontSize: 13,
    fontWeight: '500',
    color: AppColors.primary,
  },
  yearFilterContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  yearButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  yearButtonActive: {
    backgroundColor: AppColors.background.secondary,
  },
  yearButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: AppColors.secondary,
  },
  yearButtonTextActive: {
    color: '#fff',
  },
  scrollContent: {
    paddingBottom: Spacing.xxl,
  },
  passportCard: {
    backgroundColor: '#3949AB',
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    marginBottom: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  passportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  passportTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  passportTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 0.5,
  },
  passportSubtitle: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: Spacing.lg,
    letterSpacing: 0.5,
  },
  passportStatsGrid: {
    flexDirection: 'row',
    gap: Spacing.lg,
    marginBottom: Spacing.md,
  },
  passportStatBlock: {
    flex: 1,
  },
  passportStatLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  passportStatValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
  },
  passportStatSubtext: {
    fontSize: 13,
    color: '#fff',
    marginTop: 2,
  },
  passportStatsRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  passportStatSmall: {
    flex: 1,
  },
  passportStatValueSmall: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  allStatsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  allStatsButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  delayCard: {
    backgroundColor: '#B71C1C',
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    marginBottom: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  delayHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  delayBigNumber: {
    fontSize: 64,
    fontWeight: 'bold',
    color: '#fff',
    lineHeight: 64,
  },
  delayTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
    marginBottom: Spacing.sm,
  },
  delaySubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: Spacing.lg,
  },
  delayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  delayButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  mostRiddenCard: {
    backgroundColor: AppColors.background.secondary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: AppColors.border.primary,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 200,
  },
  mostRiddenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  mostRiddenTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: AppColors.secondary,
  },
  mostRiddenRouteName: {
    fontSize: 42,
    fontWeight: 'bold',
    color: AppColors.primary,
    marginBottom: Spacing.xs,
  },
  mostRiddenCount: {
    fontSize: 16,
    color: AppColors.secondary,
  },
  mostRiddenIcon: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    opacity: 0.15,
  },
  sectionLabel: {
    fontSize: 10,
    color: AppColors.secondary,
    letterSpacing: 0.5,
    marginBottom: Spacing.md,
    marginTop: Spacing.md,
    fontWeight: '600',
  },
  filterBar: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
    paddingHorizontal: 2,
  },
  filterButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: AppColors.background.secondary,
    borderWidth: 1,
    borderColor: AppColors.border.secondary,
  },
  filterButtonActive: {
    backgroundColor: AppColors.background.primary,
    borderColor: AppColors.border.primary,
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: AppColors.secondary,
  },
  filterButtonTextActive: {
    color: AppColors.primary,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
    marginTop: Spacing.md,
    paddingHorizontal: 2,
  },
  groupHeaderText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: AppColors.primary,
  },
  groupHeaderCount: {
    fontSize: 13,
    fontWeight: '600',
    color: AppColors.secondary,
    letterSpacing: 0.5,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxl,
    gap: Spacing.sm,
  },
  emptyText: {
    fontSize: 14,
    color: AppColors.secondary,
    fontWeight: '500',
  },
  emptySubtext: {
    fontSize: 12,
    color: AppColors.tertiary,
  },
  historyCard: {
    backgroundColor: AppColors.background.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: AppColors.border.primary,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  amtrakLogo: {
    width: 16,
    height: 16,
    marginRight: 3,
    resizeMode: 'contain',
  },
  historyTrainNumber: {
    fontSize: FontSizes.trainNumber,
    color: AppColors.secondary,
    fontWeight: '400',
    marginLeft: 3,
    marginRight: Spacing.md,
  },
  historyDate: {
    fontSize: FontSizes.flightDate,
    color: AppColors.secondary,
    marginLeft: 'auto',
  },
  historyRoute: {
    fontSize: 16,
    fontWeight: '600',
    color: AppColors.primary,
    marginBottom: Spacing.sm,
  },
  historyTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  arrowIcon: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  departureIcon: {
    backgroundColor: AppColors.tertiary,
  },
  arrivalIcon: {
    backgroundColor: AppColors.tertiary,
  },
  timeCode: {
    fontSize: FontSizes.timeCode,
    color: AppColors.secondary,
    marginRight: Spacing.sm,
  },
  timeValue: {
    fontSize: FontSizes.timeValue,
    color: AppColors.primary,
    fontWeight: '500',
  },
});
