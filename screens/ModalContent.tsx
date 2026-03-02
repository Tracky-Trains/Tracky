import React, { useContext, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { TrainList } from '../components/TrainList';
import { TwoStationSearch } from '../components/TwoStationSearch';
import { SlideUpModalContext } from '../components/ui/slide-up-modal';
import { useGTFSRefresh } from '../context/GTFSRefreshContext';
import { useTrainContext } from '../context/TrainContext';
import { useFrequentlyUsed } from '../hooks/useFrequentlyUsed';
import { hasCalendarPermission, syncFutureTrips } from '../services/calendar-sync';
import { TrainStorageService } from '../services/storage';
import type { SavedTrainRef, Train } from '../types/train';
import { COLORS, styles } from './styles';
import { light as hapticLight } from '../utils/haptics';
import { parseTimeToDate } from '../utils/time-formatting';
import { logger } from '../utils/logger';

export interface ModalContentHandle {
  triggerRefresh: () => void;
}

export const ModalContent = React.forwardRef<ModalContentHandle, { onTrainSelect?: (train: Train) => void; onOpenProfile?: () => void }>(function ModalContent({ onTrainSelect, onOpenProfile }, ref) {
  const { isFullscreen, isCollapsed, scrollOffset, contentOpacity, panRef, snapToPoint } =
    useContext(SlideUpModalContext);

  const fadeAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: contentOpacity.value,
    };
  });
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const { savedTrains, setSavedTrains, setSelectedTrain } = useTrainContext();
  const { refresh: refreshFrequentlyUsed } = useFrequentlyUsed();
  const { isLoadingCache, initializeGTFS, triggerRefresh } = useGTFSRefresh();

  // Refs to avoid stale closures in useEffect
  const refreshFrequentlyUsedRef = useRef(refreshFrequentlyUsed);
  refreshFrequentlyUsedRef.current = refreshFrequentlyUsed;
  const snapToPointRef = useRef(snapToPoint);
  snapToPointRef.current = snapToPoint;

  // Track if initialization has run
  const hasInitialized = useRef(false);

  // Only block UI for initial cache load (no cache at all)
  const isLoading = isLoadingCache;

  // Load saved trains from storage service (after GTFS cache is loaded)
  // Also auto-archive past trips to history
  useEffect(() => {
    if (isLoadingCache) return;

    const loadSavedTrains = async () => {
      const trains = await TrainStorageService.getSavedTrains();

      // Auto-archive past trips (travel date before today, or arrived today)
      const now = new Date();

      const pastTrains = trains.filter(t => {
        if (!t.daysAway && t.daysAway !== 0) return false;
        // Yesterday or earlier — definitely past
        if (t.daysAway < 0) return true;
        // Today — check if arrival time has passed
        if (t.daysAway === 0 && t.arriveTime) {
          const arriveDate = parseTimeToDate(t.arriveTime, now);
          if (arriveDate.getTime() < now.getTime()) return true;
        }
        return false;
      });

      for (const train of pastTrains) {
        await TrainStorageService.moveToHistory(train);
      }

      if (pastTrains.length > 0) {
        // Reload after archiving
        const updatedTrains = await TrainStorageService.getSavedTrains();
        setSavedTrains(updatedTrains);
      } else {
        setSavedTrains(trains);
      }

      // Auto-sync future trips from calendar (if permission already granted)
      try {
        const permitted = await hasCalendarPermission();
        if (permitted) {
          const prefs = await TrainStorageService.getCalendarSyncPrefs();
          if (prefs && prefs.calendarIds.length > 0) {
            const syncResult = await syncFutureTrips(prefs.calendarIds);
            if (syncResult.added > 0) {
              const refreshed = await TrainStorageService.getSavedTrains();
              setSavedTrains(refreshed);
              const tripLines = syncResult.addedTrips
                .map(t => `${t.from} → ${t.to} (${t.date})`)
                .join('\n');
              Alert.alert(
                'Trips Found from Calendar',
                tripLines,
              );
            }
          }
        }
      } catch (e) {
        logger.error('Auto calendar sync failed:', e);
      }
    };
    loadSavedTrains();
  }, [setSavedTrains, isLoadingCache]);

  // Load cached GTFS and check if refresh is needed on mount (runs once)
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    initializeGTFS(() => {
      refreshFrequentlyUsedRef.current();
    });
  }, [initializeGTFS]);

  // Save train with segmentation support
  const saveTrainWithSegment = async (tripId: string, fromCode: string, toCode: string, travelDate: Date) => {
    const ref: SavedTrainRef = {
      tripId,
      fromCode,
      toCode,
      travelDate: travelDate.getTime(),
      savedAt: Date.now(),
    };
    const saved = await TrainStorageService.saveTrainRef(ref);
    if (saved) {
      const updatedTrains = await TrainStorageService.getSavedTrains();
      setSavedTrains(updatedTrains);
    }
    return saved;
  };

  // Expose refresh to parent via ref
  React.useImperativeHandle(ref, () => ({
    triggerRefresh,
  }), [triggerRefresh]);

  // Sort saved trains by departure time (earliest first)
  const flights = [...savedTrains].sort((a, b) => {
    // First compare by travel date if available
    if (a.travelDate && b.travelDate) {
      const dateA = new Date(a.travelDate);
      const dateB = new Date(b.travelDate);
      if (dateA.getTime() !== dateB.getTime()) {
        return dateA.getTime() - dateB.getTime();
      }
    } else if (a.daysAway !== undefined && b.daysAway !== undefined) {
      if (a.daysAway !== b.daysAway) {
        return a.daysAway - b.daysAway;
      }
    }
    // If same day, compare by departure time
    const now = new Date();
    const departA = parseTimeToDate(a.departTime, now);
    const departB = parseTimeToDate(b.departTime, now);
    return departA.getTime() - departB.getTime();
  });

  // Exit search mode when modal is collapsed
  useEffect(() => {
    if (isCollapsed) {
      if (isSearchFocused) setIsSearchFocused(false);
    }
  }, [isCollapsed, isSearchFocused]);

  const handleOpenSearch = () => {
    snapToPoint?.('max');
    setIsSearchFocused(true);
  };

  const handleCloseSearch = () => {
    setIsSearchFocused(false);
    snapToPoint?.('min');
  };

  const handleSelectTrip = async (tripId: string, fromCode: string, toCode: string, date: Date) => {
    await saveTrainWithSegment(tripId, fromCode, toCode, date);
    setIsSearchFocused(false);
    snapToPoint?.('min');
  };

  const handleDeleteTrain = async (train: Train) => {
    await TrainStorageService.deleteTrainByTripId(train.tripId || '', train.fromCode, train.toCode);
    const updatedTrains = await TrainStorageService.getSavedTrains();
    setSavedTrains(updatedTrains);
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Fixed Header */}
      <View>
        <View style={styles.titleRow}>
          <Text style={styles.title}>
            {isSearchFocused ? 'Add Train' : 'My Trains'}
          </Text>
        </View>
        {!isSearchFocused && !isLoading && (
          <TouchableOpacity
            onPress={() => { hapticLight(); onOpenProfile?.(); }}
            style={styles.refreshButton}
            activeOpacity={0.7}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Profile"
          >
            <Ionicons name="person" size={22} color={COLORS.primary} />
          </TouchableOpacity>
        )}

        {isSearchFocused && <Text style={styles.subtitle}>Search by train number, route, or station</Text>}

        {/* Search Button (when not searching) */}
        {!isLoading && !isSearchFocused && (
          <TouchableOpacity
            style={styles.searchContainer}
            activeOpacity={0.7}
            onPress={() => { hapticLight(); handleOpenSearch(); }}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Add a train"
          >
            <Ionicons name="search" size={20} color={COLORS.secondary} />
            <Text style={styles.searchButtonText}>Start your journey...</Text>
          </TouchableOpacity>
        )}
      </View>

      <Animated.View style={[{ flex: 1 }, fadeAnimatedStyle]} pointerEvents={isCollapsed ? 'none' : 'auto'}>
        {/* Search lives outside ScrollView so the input stays fixed */}
        {isSearchFocused && !isCollapsed && (
          <TwoStationSearch onSelectTrip={handleSelectTrip} onClose={handleCloseSearch} />
        )}

        {/* Scrollable Content */}
        {!isSearchFocused && (
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            scrollEnabled={isFullscreen}
            nestedScrollEnabled={true}
            onScroll={e => {
              const offsetY = e.nativeEvent.contentOffset.y;
              scrollOffset.value = offsetY;
            }}
            scrollEventThrottle={16}
            waitFor={panRef}
            keyboardShouldPersistTaps="handled"
          >
            {!isLoading && (
              <TrainList
                flights={flights}
                onTrainSelect={train => {
                  setSelectedTrain(train);
                  if (typeof onTrainSelect === 'function') onTrainSelect(train);
                }}
                onDeleteTrain={handleDeleteTrain}
              />
            )}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
});
