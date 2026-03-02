import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView as RNScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { AppColors, BorderRadius, Spacing } from '../../constants/theme';
import { type DistanceUnit, type TempUnit, useUnits } from '../../context/UnitsContext';
import {
  type DeviceCalendar,
  type SyncResult,
  getDeviceCalendars,
  hasCalendarPermission,
  requestCalendarPermission,
  syncPastTrips,
} from '../../services/calendar-sync';
import { TrainStorageService } from '../../services/storage';
import { light as hapticLight, selection as hapticSelection } from '../../utils/haptics';
import { SlideUpModalContext } from './slide-up-modal';

interface SettingsModalProps {
  onClose: () => void;
  onRefreshGTFS: () => void;
}

type SyncState = 'idle' | 'selecting' | 'syncing' | 'done';

const SCAN_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: 'All', value: -1 },
] as const;

const TEMP_OPTIONS: { label: string; value: TempUnit }[] = [
  { label: '°F', value: 'F' },
  { label: '°C', value: 'C' },
];

const DISTANCE_OPTIONS: { label: string; value: DistanceUnit; desc: string }[] = [
  { label: 'Miles', value: 'mi', desc: 'mi' },
  { label: 'Kilometers', value: 'km', desc: 'km' },
  { label: 'Burgers', value: 'burgers', desc: '🍔' },
];

export default function SettingsModal({ onClose, onRefreshGTFS }: SettingsModalProps) {
  const { isFullscreen, isCollapsed, scrollOffset, contentOpacity, panRef } = useContext(SlideUpModalContext);

  const fadeAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: contentOpacity.value,
    };
  });
  const { tempUnit, distanceUnit, setTempUnit, setDistanceUnit } = useUnits();
  const [currentPage, setCurrentPage] = useState<'main' | 'calendar' | 'units' | 'about'>('main');
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());
  const [scanDays, setScanDays] = useState(30);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load saved preferences on mount
  useEffect(() => {
    TrainStorageService.getCalendarSyncPrefs().then(prefs => {
      if (prefs) {
        setSelectedCalendarIds(new Set(prefs.calendarIds));
        setScanDays(prefs.scanDays);
      }
    });
    return () => {
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  }, []);

  // Auto-scan calendars when navigating to the calendar page
  useEffect(() => {
    if (currentPage !== 'calendar' || syncState !== 'idle') return;

    (async () => {
      const permitted = await hasCalendarPermission();
      if (!permitted) {
        const granted = await requestCalendarPermission();
        if (!granted) {
          Alert.alert(
            'Calendar Access Denied',
            'Tracky needs calendar access to find past train trips. You can enable this in Settings.',
          );
          setCurrentPage('main');
          return;
        }
      }

      const deviceCalendars = await getDeviceCalendars();
      setCalendars(deviceCalendars);
      setSyncState('selecting');
    })();
  }, [currentPage]);

  const toggleCalendar = useCallback((id: string) => {
    setSelectedCalendarIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const allSelected = calendars.length > 0 && selectedCalendarIds.size === calendars.length;

  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedCalendarIds(new Set());
    } else {
      setSelectedCalendarIds(new Set(calendars.map(c => c.id)));
    }
  }, [allSelected, calendars]);

  const handleSyncNow = useCallback(async () => {
    const ids = Array.from(selectedCalendarIds);
    if (ids.length === 0) {
      Alert.alert('No Calendars Selected', 'Please select at least one calendar to scan.');
      return;
    }

    // Save preferences
    await TrainStorageService.saveCalendarSyncPrefs({ calendarIds: ids, scanDays });

    setSyncState('syncing');
    try {
      const result = await syncPastTrips(ids, scanDays);
      setSyncResult(result);
      setSyncState('done');
      doneTimerRef.current = setTimeout(() => {
        setSyncState('idle');
        setSyncResult(null);
      }, 3000);
    } catch {
      Alert.alert('Sync Error', 'Something went wrong while scanning your calendar.');
      setSyncState('selecting');
    }
  }, [selectedCalendarIds, scanDays]);

  const handleDeleteGTFS = useCallback(() => {
    Alert.alert('Delete GTFS Data', 'This will remove all cached schedule data. The app will re-download it on next launch.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const keys = [
            'GTFS_LAST_FETCH',
            'GTFS_ROUTES_JSON',
            'GTFS_STOPS_JSON',
            'GTFS_STOP_TIMES_JSON',
            'GTFS_SHAPES_JSON',
            'GTFS_TRIPS_JSON',
            'GTFS_CALENDAR_JSON',
            'GTFS_CALENDAR_DATES_JSON',
          ];
          await AsyncStorage.multiRemove(keys);
          Alert.alert('Done', 'GTFS data deleted.');
        },
      },
    ]);
  }, []);

  const handleDeleteAllRoutes = useCallback(() => {
    Alert.alert('Delete All Routes', 'This will permanently delete all your saved trips. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete All',
        style: 'destructive',
        onPress: async () => {
          await TrainStorageService.clearAllTrains();
          Alert.alert('Done', 'All routes deleted.');
        },
      },
    ]);
  }, []);

  const renderMainPage = () => (
    <>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <TouchableOpacity
          onPress={() => { hapticLight(); onClose(); }}
          style={styles.closeButton}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={24} color={AppColors.primary} />
        </TouchableOpacity>
      </View>

      {/* AUTOMATIONS Section */}
      <Text style={styles.sectionHeader}>AUTOMATIONS</Text>
      <View style={styles.settingsList}>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => { hapticLight(); setCurrentPage('calendar'); }}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="calendar-outline" size={22} color={AppColors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Calendar Sync</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={AppColors.secondary} />
        </TouchableOpacity>
      </View>

      {/* UNITS Section */}
      <Text style={styles.sectionHeader}>UNITS</Text>
      <View style={styles.settingsList}>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => { hapticLight(); setCurrentPage('units'); }}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="speedometer-outline" size={22} color={AppColors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Units</Text>
            <Text style={styles.itemSubtitle}>
              {TEMP_OPTIONS.find(o => o.value === tempUnit)?.label} • {DISTANCE_OPTIONS.find(o => o.value === distanceUnit)?.desc}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={AppColors.secondary} />
        </TouchableOpacity>
      </View>

      {/* DATA Section */}
      <Text style={styles.sectionHeader}>DATA</Text>
      <View style={styles.settingsList}>
        <TouchableOpacity
          style={styles.settingsItem}
          activeOpacity={0.7}
          onPress={() => { hapticLight(); onRefreshGTFS(); }}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="refresh" size={22} color={AppColors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Refresh Amtrak Schedule</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={AppColors.secondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => { hapticLight(); Linking.openURL('mailto:him@jasonxu.me?subject=Incorrect%20Tracky%20Data'); }}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="alert-circle-outline" size={22} color={AppColors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Report a Bug/Bad Data</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={AppColors.secondary} />
        </TouchableOpacity>
      </View>

      {/* ABOUT Section */}
      <Text style={styles.sectionHeader}>ABOUT</Text>
      <View style={styles.settingsList}>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => { hapticLight(); setCurrentPage('about'); }}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="information-circle-outline" size={22} color={AppColors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>About This App</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={AppColors.secondary} />
        </TouchableOpacity>
      </View>

      {/* DEBUG Section */}
      <Text style={styles.sectionHeader}>DEBUG</Text>
      <View style={styles.settingsList}>
        <TouchableOpacity
          style={styles.settingsItem}
          activeOpacity={0.7}
          onPress={() => { hapticLight(); handleDeleteGTFS(); }}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="trash-outline" size={22} color={AppColors.error} />
          </View>
          <View style={styles.itemContent}>
            <Text style={[styles.itemTitle, { color: AppColors.error }]}>Delete GTFS Data</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => { hapticLight(); handleDeleteAllRoutes(); }}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="trash-outline" size={22} color={AppColors.error} />
          </View>
          <View style={styles.itemContent}>
            <Text style={[styles.itemTitle, { color: AppColors.error }]}>Delete All Routes</Text>
          </View>
        </TouchableOpacity>
      </View>
    </>
  );

  const renderCalendarPage = () => (
    <>
      <View style={styles.subPageHeader}>
        <TouchableOpacity onPress={() => { hapticLight(); setCurrentPage('main'); setSyncState('idle'); }}>
          <Ionicons name="chevron-back" size={28} color={AppColors.primary} />
        </TouchableOpacity>
        <Text style={styles.subPageTitle}>Calendar Sync</Text>
      </View>

      {syncState === 'idle' && (
        <View style={styles.syncingRow}>
          <ActivityIndicator size="small" color={AppColors.primary} />
          <Text style={styles.syncingText}>Loading calendars...</Text>
        </View>
      )}

      {syncState === 'selecting' && (
        <View>
          <View style={[styles.panelHeader, { marginTop: Spacing.lg }]}>
            <Text style={styles.sectionHeader}>SELECT CALENDARS</Text>
            <TouchableOpacity onPress={() => { hapticSelection(); handleToggleAll(); }} activeOpacity={0.7}>
              <Text style={styles.toggleAllText}>
                {allSelected ? 'Unselect All' : 'Select All'}
              </Text>
            </TouchableOpacity>
          </View>
          <RNScrollView style={styles.calendarList} nestedScrollEnabled>
            {calendars.map(cal => (
              <TouchableOpacity
                key={cal.id}
                style={styles.calendarRow}
                activeOpacity={0.7}
                onPress={() => { hapticSelection(); toggleCalendar(cal.id); }}
              >
                <View style={[styles.calendarDot, { backgroundColor: cal.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.calendarName}>{cal.title}</Text>
                  <Text style={styles.calendarSource}>{cal.source}</Text>
                </View>
                <Switch
                  value={selectedCalendarIds.has(cal.id)}
                  onValueChange={() => { hapticSelection(); toggleCalendar(cal.id); }}
                  trackColor={{ false: AppColors.border.primary, true: AppColors.primary }}
                />
              </TouchableOpacity>
            ))}
          </RNScrollView>

          <Text style={styles.sectionHeader}>SCAN RANGE</Text>
          <View style={styles.dropdownContainer}>
            {SCAN_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                style={styles.dropdownOption}
                onPress={() => { hapticSelection(); setScanDays(opt.value); }}
                activeOpacity={0.7}
              >
                <Text style={styles.dropdownOptionText}>{opt.label}</Text>
                {scanDays === opt.value && (
                  <Ionicons name="checkmark" size={20} color={AppColors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={styles.syncButton}
            activeOpacity={0.7}
            onPress={() => { hapticLight(); handleSyncNow(); }}
          >
            <Text style={styles.syncButtonText}>Sync Now</Text>
          </TouchableOpacity>
        </View>
      )}

      {syncState === 'syncing' && (
        <View style={styles.syncingRow}>
          <ActivityIndicator size="small" color={AppColors.primary} />
          <Text style={styles.syncingText}>Scanning events...</Text>
        </View>
      )}

      {syncState === 'done' && syncResult && (
        <View style={styles.doneRow}>
          <Ionicons name="checkmark-circle" size={22} color={AppColors.success} />
          <Text style={styles.doneText}>
            Parsed {syncResult.parsed} event{syncResult.parsed !== 1 ? 's' : ''}.
            {' '}Found {syncResult.added} trip{syncResult.added !== 1 ? 's' : ''}
            {syncResult.skipped > 0 &&
              ` (${syncResult.skipped} already existed)`}
          </Text>
        </View>
      )}
    </>
  );

  const renderUnitsPage = () => (
    <>
      <View style={styles.subPageHeader}>
        <TouchableOpacity onPress={() => { hapticLight(); setCurrentPage('main'); }}>
          <Ionicons name="chevron-back" size={28} color={AppColors.primary} />
        </TouchableOpacity>
        <Text style={styles.subPageTitle}>Units</Text>
      </View>

      <Text style={styles.sectionHeader}>TEMPERATURE</Text>
      <View style={styles.pillRow}>
        {TEMP_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.pillOption, tempUnit === opt.value && styles.pillOptionActive]}
            onPress={() => { hapticSelection(); setTempUnit(opt.value); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.pillOptionText, tempUnit === opt.value && styles.pillOptionTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionHeader}>DISTANCE</Text>
      <View style={styles.pillRow}>
        {DISTANCE_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.pillOption, distanceUnit === opt.value && styles.pillOptionActive]}
            onPress={() => { hapticSelection(); setDistanceUnit(opt.value); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.pillOptionText, distanceUnit === opt.value && styles.pillOptionTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </>
  );

  const renderAboutPage = () => (
    <>
      <View style={styles.subPageHeader}>
        <TouchableOpacity onPress={() => { hapticLight(); setCurrentPage('main'); }}>
          <Ionicons name="chevron-back" size={28} color={AppColors.primary} />
        </TouchableOpacity>
        <Text style={styles.subPageTitle}>About This App</Text>
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <Text style={styles.aboutText}>
          Tracky is a beautiful train-tracking companion for Amtrak travelers with heavy inspiration from Flighty (and much love to the devs!). Follow your train in real time, view detailed route maps, and keep a personal log of every journey you take.
        </Text>
        <Text style={styles.aboutText}>
          A <Text style={{ color: AppColors.primary }} onPress={() => Linking.openURL('https://portfolio.jasonxu.me/')}>Jason Xu</Text> project.
        </Text>
        <Text style={styles.aboutText}>
          By the way, I'm <Text style={{ color: AppColors.primary }} onPress={() => Linking.openURL('https://github.com/Mootbing/Tracky')}>Open-Source</Text>!
        </Text>
      </View>
    </>
  );

  return (
    <Animated.View style={[{ flex: 1 }, fadeAnimatedStyle]} pointerEvents={isCollapsed ? 'none' : 'auto'}>
      <ScrollView
        style={[styles.scrollView, { marginHorizontal: -Spacing.xl }]}
        contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: Spacing.xl }}
        scrollEnabled={isFullscreen}
        waitFor={panRef}
        bounces={false}
        nestedScrollEnabled={true}
        onScroll={e => {
          if (scrollOffset) scrollOffset.value = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        {currentPage === 'main' && renderMainPage()}
        {currentPage === 'calendar' && renderCalendarPage()}
        {currentPage === 'units' && renderUnitsPage()}
        {currentPage === 'about' && renderAboutPage()}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  subPageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Spacing.xs,
    gap: Spacing.sm,
  },
  subPageTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    color: AppColors.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.xs,
  },
  title: {
    fontSize: 34,
    fontWeight: 'bold',
    color: AppColors.primary,
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
  scrollView: {
    flex: 1,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: AppColors.secondary,
    letterSpacing: 0.5,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  settingsList: {
    backgroundColor: AppColors.background.primary,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border.primary,
  },
  settingsItemLast: {
    borderBottomWidth: 0,
  },
  itemIconContainer: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 17,
    color: AppColors.primary,
  },
  itemSubtitle: {
    fontSize: 13,
    color: AppColors.secondary,
    marginTop: 2,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleAllText: {
    fontSize: 15,
    fontWeight: '600',
    color: AppColors.primary,
  },
  calendarList: {
    maxHeight: 200,
  },
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  calendarDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: Spacing.md,
  },
  calendarName: {
    fontSize: 15,
    color: AppColors.primary,
    fontWeight: '500',
    marginBottom: 2,
  },
  calendarSource: {
    fontSize: 13,
    color: AppColors.secondary,
  },
  dropdownContainer: {
    backgroundColor: AppColors.background.primary,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    marginTop: Spacing.sm,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border.primary,
  },
  dropdownOptionText: {
    fontSize: 17,
    color: AppColors.primary,
  },
  syncButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppColors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    marginTop: Spacing.lg,
  },
  syncButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: AppColors.background.primary,
  },
  syncingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
  },
  syncingText: {
    fontSize: 15,
    color: AppColors.secondary,
    marginLeft: Spacing.md,
  },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.md,
  },
  doneText: {
    fontSize: 15,
    color: AppColors.primary,
    marginLeft: Spacing.md,
    flex: 1,
  },
  pillRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  pillOption: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: AppColors.background.primary,
    borderWidth: 1,
    borderColor: AppColors.border.primary,
  },
  pillOptionActive: {
    backgroundColor: AppColors.primary,
    borderColor: AppColors.primary,
  },
  pillOptionText: {
    fontSize: 15,
    fontWeight: '600',
    color: AppColors.primary,
  },
  pillOptionTextActive: {
    color: AppColors.background.primary,
  },
  aboutText: {
    fontSize: 15,
    color: AppColors.secondary,
    lineHeight: 22,
    marginBottom: Spacing.sm,
  },
});
