import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Linking,
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { AppColors, BorderRadius, CloseButtonStyle, Spacing } from '../../constants/theme';
import { type DistanceUnit, type TempUnit, useUnits } from '../../context/UnitsContext';
import {
  type DeviceCalendar,
  getDeviceCalendars,
  hasCalendarPermission,
  requestCalendarPermission,
  syncPastTrips,
} from '../../services/calendar-sync';
import { TrainStorageService } from '../../services/storage';
import { light as hapticLight, selection as hapticSelection } from '../../utils/haptics';
import { type LogEntry, LogLevel, logger, openReportBugEmail, openReportBadDataEmail } from '../../utils/logger';
import { SlideUpModalContext } from './slide-up-modal';


interface SettingsModalProps {
  onClose: () => void;
  onRefreshGTFS: () => void;
}

type SyncState = 'idle' | 'selecting' | 'syncing';

const SCAN_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: 'All', value: -1 },
] as const;

const TEMP_OPTIONS: { label: string; value: TempUnit }[] = [
  { label: '\u00B0F', value: 'F' },
  { label: '\u00B0C', value: 'C' },
];

const DISTANCE_OPTIONS: { label: string; value: DistanceUnit; desc: string }[] = [
  { label: 'Miles', value: 'mi', desc: 'mi' },
  { label: 'Kilometers', value: 'km', desc: 'km' },
  { label: '🍔', value: 'burgers', desc: '🍔' },
];

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: '#8B8B8B',
  [LogLevel.INFO]: '#60A5FA',
  [LogLevel.WARN]: '#FBBF24',
  [LogLevel.ERROR]: '#EF4444',
};

function formatLogDate(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${h}:${m}:${s}.${ms}`;
}

export default function SettingsModal({ onClose, onRefreshGTFS }: SettingsModalProps) {
  const { isFullscreen, scrollOffset, panRef } = useContext(SlideUpModalContext);
  const { tempUnit, distanceUnit, setTempUnit, setDistanceUnit } = useUnits();
  const [currentPage, setCurrentPage] = useState<'main' | 'calendar' | 'units' | 'about' | 'debugLog'>('main');
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [calendarsLoaded, setCalendarsLoaded] = useState(false);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());
  const [scanDays, setScanDays] = useState(30);
  const [debugLogs, setDebugLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<LogLevel | 'ALL'>('ALL');
  const [forceCrash, setForceCrash] = useState(false);

  const { width: SCREEN_WIDTH } = Dimensions.get('window');
  const slideX = useSharedValue(0); // 0 = main, 1 = subpage

  const openSubpage = useCallback((page: 'calendar' | 'units' | 'about' | 'debugLog') => {
    hapticLight();
    setCurrentPage(page);
    slideX.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
  }, []);

  const resetSubpageState = useCallback(() => {
    if (currentPage === 'calendar') setSyncState('idle');
    setTimeout(() => setCurrentPage('main'), 300);
  }, [currentPage]);

  const closeSubpage = useCallback(() => {
    hapticLight();
    slideX.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
    resetSubpageState();
  }, [resetSubpageState]);

  const mainAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -slideX.value * SCREEN_WIDTH * 0.3 }],
    opacity: 1 - slideX.value * 0.3,
  }));

  const subpageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - slideX.value) * SCREEN_WIDTH }],
  }));

  const swipeBackGesture = Gesture.Pan()
    .activeOffsetX(20)
    .failOffsetY([-20, 20])
    .onUpdate((e) => {
      const progress = Math.max(0, e.translationX) / SCREEN_WIDTH;
      slideX.value = 1 - progress;
    })
    .onEnd((e) => {
      if (e.translationX > SCREEN_WIDTH * 0.3 || e.velocityX > 500) {
        slideX.value = withTiming(0, { duration: 250, easing: Easing.out(Easing.cubic) });
        runOnJS(resetSubpageState)();
      } else {
        slideX.value = withTiming(1, { duration: 250, easing: Easing.out(Easing.cubic) });
      }
    });

  useEffect(() => {
    TrainStorageService.getCalendarSyncPrefs().then(prefs => {
      if (prefs) {
        setSelectedCalendarIds(new Set(prefs.calendarIds));
        setScanDays(prefs.scanDays);
      }
    });

    // Pre-load calendars if permission already granted
    (async () => {
      const permitted = await hasCalendarPermission();
      if (permitted) {
        const deviceCalendars = await getDeviceCalendars();
        setCalendars(deviceCalendars);
      }
      setCalendarsLoaded(true);
    })();

  }, []);

  useEffect(() => {
    if (currentPage === 'debugLog') {
      logger.flush().then(() => {
        setDebugLogs(logger.getLogs().reverse());
      });
    }
  }, [currentPage]);

  useEffect(() => {
    if (currentPage !== 'calendar' || syncState !== 'idle') return;
    if (!calendarsLoaded) return;
    if (calendars.length > 0) {
      setSyncState('selecting');
      return;
    }

    // Permission not yet granted — request it now
    (async () => {
      const granted = await requestCalendarPermission();
      if (!granted) {
        Alert.alert(
          'Calendar Access Denied',
          'Tracky needs calendar access to find past train trips. You can enable this in Settings.'
        );
        setCurrentPage('main');
        return;
      }
      const deviceCalendars = await getDeviceCalendars();
      setCalendars(deviceCalendars);
      setSyncState('selecting');
    })();
  }, [currentPage, calendarsLoaded, syncState, calendars.length]);

  const toggleCalendar = useCallback((id: string) => {
    setSelectedCalendarIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = calendars.length > 0 && selectedCalendarIds.size === calendars.length;

  const handleToggleAll = useCallback(() => {
    if (allSelected) setSelectedCalendarIds(new Set());
    else setSelectedCalendarIds(new Set(calendars.map(c => c.id)));
  }, [allSelected, calendars]);

  const handleSyncNow = useCallback(async () => {
    const ids = Array.from(selectedCalendarIds);
    if (ids.length === 0) {
      Alert.alert('No Calendars Selected', 'Please select at least one calendar to scan.');
      return;
    }
    await TrainStorageService.saveCalendarSyncPrefs({ calendarIds: ids, scanDays });
    setSyncState('syncing');
    try {
      const result = await syncPastTrips(ids, scanDays);
      const message = result.failReason === 'gtfs_not_loaded'
        ? 'Schedule data not loaded yet. Please wait and try again.'
        : result.failReason === 'no_calendar_events'
          ? `No events found in calendar (${scanDays === -1 ? 'all time' : `last ${scanDays} days`}).`
          : result.failReason === 'no_pattern_match'
            ? `Found ${result.totalCalendarEvents} event${result.totalCalendarEvents !== 1 ? 's' : ''} but none matched "Train to..." pattern.`
            : `Parsed ${result.parsed} event${result.parsed !== 1 ? 's' : ''}. Found ${result.added} trip${result.added !== 1 ? 's' : ''}${result.skipped > 0 ? ` (${result.skipped} already existed)` : ''}.`;
      Alert.alert(result.failReason ? 'Sync Issue' : 'Sync Complete', message);
      setSyncState('selecting');
    } catch {
      Alert.alert('Sync Error', 'Something went wrong while scanning your calendar.');
      setSyncState('selecting');
    }
  }, [selectedCalendarIds, scanDays]);

  const handleDeleteGTFS = useCallback(() => {
    Alert.alert(
      'Delete GTFS Data',
      'This will remove all cached schedule data. The app will re-download it on next launch.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            logger.info('[Settings] User deleted GTFS data');
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
      ]
    );
  }, []);

  const handleDeletePastRoutes = useCallback(() => {
    Alert.alert('Delete All Past Routes', 'This will permanently delete your entire trip history. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete All',
        style: 'destructive',
        onPress: async () => {
          logger.info('[Settings] User deleted all past routes');
          await TrainStorageService.clearTripHistory();
          Alert.alert('Done', 'All past routes deleted.');
        },
      },
    ]);
  }, []);

  const handleDeleteActiveRoutes = useCallback(() => {
    Alert.alert('Delete All Active & Future Routes', 'This will permanently delete all your active and upcoming trips. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete All',
        style: 'destructive',
        onPress: async () => {
          logger.info('[Settings] User deleted all active & future routes');
          await TrainStorageService.clearAllTrains();
          Alert.alert('Done', 'All active & future routes deleted.');
        },
      },
    ]);
  }, []);

  const handleClearLogs = useCallback(() => {
    Alert.alert('Clear Logs', 'This will delete all debug logs.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await logger.clearLogs();
          setDebugLogs([]);
        },
      },
    ]);
  }, []);

  const handleShareLogs = useCallback(async () => {
    await logger.flush();
    const exported = logger.exportLogs();
    await Share.share({ message: exported, title: 'Tracky Debug Logs' });
  }, []);

  const filteredLogs = logFilter === 'ALL' ? debugLogs : debugLogs.filter(l => l.level === logFilter);

  if (forceCrash) {
    throw new Error('Test crash triggered from debug menu');
  }

  const renderMainPage = () => (
    <>
      <Text style={styles.sectionHeader}>AUTOMATIONS</Text>
      <View style={styles.settingsList}>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => openSubpage('calendar')}
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

      <Text style={styles.sectionHeader}>UNITS</Text>
      <View style={styles.settingsList}>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => openSubpage('units')}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="speedometer-outline" size={22} color={AppColors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Units</Text>
            <Text style={styles.itemSubtitle}>
              {TEMP_OPTIONS.find(o => o.value === tempUnit)?.label} {'\u2022'}{' '}
              {DISTANCE_OPTIONS.find(o => o.value === distanceUnit)?.desc}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={AppColors.secondary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionHeader}>DATA</Text>
      <View style={styles.settingsList}>
        <TouchableOpacity
          style={styles.settingsItem}
          activeOpacity={0.7}
          onPress={() => {
            hapticLight();
            onRefreshGTFS();
          }}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="refresh" size={22} color={AppColors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Refresh Amtrak Schedule</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.settingsItem}
          activeOpacity={0.7}
          onPress={() => {
            hapticLight();
            openReportBugEmail();
          }}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="bug-outline" size={22} color={AppColors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Report a Bug</Text>
          </View>
          <Ionicons name="mail-outline" size={20} color={AppColors.secondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => {
            hapticLight();
            openReportBadDataEmail();
          }}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="alert-circle-outline" size={22} color={AppColors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Report Bad Data</Text>
          </View>
          <Ionicons name="mail-outline" size={20} color={AppColors.secondary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionHeader}>ABOUT</Text>
      <View style={styles.settingsList}>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => openSubpage('about')}
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

      {distanceUnit === 'burgers' && (
        <>
          <Text style={styles.sectionHeader}>DEBUG</Text>
          <View style={styles.settingsList}>
            <TouchableOpacity
              style={styles.settingsItem}
              activeOpacity={0.7}
              onPress={() => openSubpage('debugLog')}
            >
              <View style={styles.itemIconContainer}>
                <Ionicons name="document-text-outline" size={22} color={AppColors.primary} />
              </View>
              <View style={styles.itemContent}>
                <Text style={styles.itemTitle}>View Debug Log</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={AppColors.secondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsItem}
              activeOpacity={0.7}
              onPress={() => {
                hapticLight();
                handleDeleteGTFS();
              }}
            >
              <View style={styles.itemIconContainer}>
                <Ionicons name="trash-outline" size={22} color={AppColors.error} />
              </View>
              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: AppColors.error }]}>Delete GTFS Data</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsItem}
              activeOpacity={0.7}
              onPress={() => {
                hapticLight();
                handleDeletePastRoutes();
              }}
            >
              <View style={styles.itemIconContainer}>
                <Ionicons name="trash-outline" size={22} color={AppColors.error} />
              </View>
              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: AppColors.error }]}>Delete All Past Routes</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsItem}
              activeOpacity={0.7}
              onPress={() => {
                hapticLight();
                handleDeleteActiveRoutes();
              }}
            >
              <View style={styles.itemIconContainer}>
                <Ionicons name="trash-outline" size={22} color={AppColors.error} />
              </View>
              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: AppColors.error }]}>Delete All Active & Future Routes</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.settingsItem, styles.settingsItemLast]}
              activeOpacity={0.7}
              onPress={() => {
                hapticLight();
                setForceCrash(true);
              }}
            >
              <View style={styles.itemIconContainer}>
                <Ionicons name="bug-outline" size={22} color={AppColors.error} />
              </View>
              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: AppColors.error }]}>Test Crash Screen</Text>
              </View>
            </TouchableOpacity>
          </View>
        </>
      )}
    </>
  );

  const renderCalendarPage = () => (
    <>
      {syncState === 'idle' && (
        <View style={styles.syncingRow}>
          <ActivityIndicator size="small" color={AppColors.primary} />
          <Text style={styles.syncingText}>Loading calendars...</Text>
        </View>
      )}
      {syncState === 'selecting' && (
        <>
          <View style={[styles.panelHeader, { marginTop: Spacing.lg }]}>
            <Text style={styles.sectionHeader}>CALENDARS</Text>
            <TouchableOpacity
              onPress={() => {
                hapticSelection();
                handleToggleAll();
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.toggleAllText}>{allSelected ? 'Unselect All' : 'Select All'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.settingsList}>
            {calendars.map((cal, i) => (
              <TouchableOpacity
                key={cal.id}
                style={[styles.settingsItem, { paddingHorizontal: Spacing.lg }, i === calendars.length - 1 && styles.settingsItemLast]}
                activeOpacity={0.7}
                onPress={() => {
                  hapticSelection();
                  toggleCalendar(cal.id);
                }}
              >
                <View style={[styles.calendarDot, { marginRight: Spacing.md }]} >
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: cal.color }} />
                </View>
                <View style={styles.itemContent}>
                  <Text style={styles.itemTitle}>{cal.title}</Text>
                  <Text style={styles.itemSubtitle}>{cal.source}</Text>
                </View>
                {selectedCalendarIds.has(cal.id) && <Ionicons name="checkmark" size={20} color={AppColors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.sectionHeader}>SCAN RANGE</Text>
          <View style={styles.settingsList}>
            {SCAN_OPTIONS.map((opt, i) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.settingsItem, { paddingHorizontal: Spacing.lg }, i === SCAN_OPTIONS.length - 1 && styles.settingsItemLast]}
                onPress={() => {
                  hapticSelection();
                  setScanDays(opt.value);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.itemContent}>
                  <Text style={styles.itemTitle}>{opt.label}</Text>
                </View>
                {scanDays === opt.value && <Ionicons name="checkmark" size={20} color={AppColors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.syncButton, { marginTop: Spacing.xl }]}
            activeOpacity={0.7}
            onPress={() => {
              hapticLight();
              handleSyncNow();
            }}
          >
            <Text style={styles.syncButtonText}>Sync Now</Text>
          </TouchableOpacity>
        </>
      )}
      {syncState === 'syncing' && (
        <View style={styles.syncingRow}>
          <ActivityIndicator size="small" color={AppColors.primary} />
          <Text style={styles.syncingText}>Scanning events...</Text>
        </View>
      )}
    </>
  );

  const renderUnitsPage = () => (
    <>
      <Text style={styles.sectionHeader}>TEMPERATURE</Text>
      <View style={styles.settingsList}>
        {TEMP_OPTIONS.map((opt, i) => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.settingsItem, { paddingHorizontal: Spacing.lg }, i === TEMP_OPTIONS.length - 1 && styles.settingsItemLast]}
            onPress={() => {
              hapticSelection();
              setTempUnit(opt.value);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>{opt.label}</Text>
            </View>
            {tempUnit === opt.value && <Ionicons name="checkmark" size={20} color={AppColors.primary} />}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.sectionHeader}>DISTANCE</Text>
      <View style={styles.settingsList}>
        {DISTANCE_OPTIONS.map((opt, i) => (
          <TouchableOpacity
            key={opt.value}
            style={[styles.settingsItem, { paddingHorizontal: Spacing.lg }, i === DISTANCE_OPTIONS.length - 1 && styles.settingsItemLast]}
            onPress={() => {
              hapticSelection();
              setDistanceUnit(opt.value);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>{opt.label}</Text>
            </View>
            {distanceUnit === opt.value && <Ionicons name="checkmark" size={20} color={AppColors.primary} />}
          </TouchableOpacity>
        ))}
      </View>
    </>
  );

  const renderAboutPage = () => (
    <>
      <View style={{ marginTop: Spacing.lg }}>
        <Text style={styles.aboutText}>
          Tracky is a beautiful train-tracking companion for Amtrak travelers with heavy inspiration from Flighty (and
          much love to the devs!). Follow your train in real time, view detailed route maps, and keep a personal log of
          every journey you take.
        </Text>
        <Text style={styles.aboutText}>
          A{' '}
          <Text style={{ color: AppColors.primary }} onPress={() => Linking.openURL('https://portfolio.jasonxu.me/')}>
            Jason Xu
          </Text>{' '}
          project.
        </Text>
        <Text style={styles.aboutText}>
          By the way, I'm{' '}
          <Text
            style={{ color: AppColors.primary }}
            onPress={() => Linking.openURL('https://github.com/Mootbing/Tracky')}
          >
            Open-Source
          </Text>
          !
        </Text>
      </View>
    </>
  );

  const renderDebugLogPage = () => (
    <>
      <View style={[styles.pillRow, { marginTop: Spacing.md, flexWrap: 'wrap' }]}>
        {(['ALL', LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR] as const).map(level => (
          <TouchableOpacity
            key={level}
            style={[
              styles.logFilterPill,
              logFilter === level && styles.logFilterPillActive,
              level !== 'ALL' && { borderColor: LOG_LEVEL_COLORS[level] },
              logFilter === level && level !== 'ALL' && { backgroundColor: LOG_LEVEL_COLORS[level] },
            ]}
            onPress={() => {
              hapticSelection();
              setLogFilter(level);
            }}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.logFilterPillText,
                level !== 'ALL' && logFilter !== level && { color: LOG_LEVEL_COLORS[level] },
                logFilter === level && styles.logFilterPillTextActive,
              ]}
            >
              {level}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.logCount, { marginTop: Spacing.md }]}>
        {filteredLogs.length} log{filteredLogs.length !== 1 ? 's' : ''}
      </Text>

      <View style={styles.logContainer}>
        {filteredLogs.length === 0 ? (
          <View style={styles.logEmptyState}>
            <Ionicons name="document-text-outline" size={40} color={AppColors.tertiary} />
            <Text style={styles.logEmptyText}>No logs yet</Text>
          </View>
        ) : (
          filteredLogs.map((entry, i) => (
            <View
              key={`${entry.timestamp}-${i}`}
              style={[styles.logEntry, { borderLeftWidth: 3, borderLeftColor: LOG_LEVEL_COLORS[entry.level] }]}
            >
              <View style={styles.logEntryHeader}>
                <Text style={[styles.logLevel, { color: LOG_LEVEL_COLORS[entry.level] }]}>{entry.level}</Text>
                <Text style={styles.logTimestamp}>{formatLogDate(entry.timestamp)}</Text>
              </View>
              <Text style={[styles.logMessage, { color: LOG_LEVEL_COLORS[entry.level] }]} numberOfLines={3}>
                {entry.message}
              </Text>
              {entry.data !== undefined && (
                <Text
                  style={[styles.logData, { color: LOG_LEVEL_COLORS[entry.level], opacity: 0.7 }]}
                  numberOfLines={2}
                >
                  {typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data)}
                </Text>
              )}
            </View>
          ))
        )}
      </View>
    </>
  );

  const subpageTitles: Record<string, string> = {
    calendar: 'Calendar Sync',
    units: 'Units',
    about: 'About This App',
    debugLog: 'Debug Log',
  };

  return (
    <View style={styles.modalContent}>
      {/* Main settings page */}
      <Animated.View style={[styles.pageContainer, mainAnimatedStyle]}>
        <View style={styles.fixedHeader}>
          <View style={styles.header}>
            <Text style={styles.title}>Settings</Text>
            <TouchableOpacity
              onPress={() => {
                hapticLight();
                onClose();
              }}
              style={styles.closeButton}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={24} color={AppColors.primary} />
            </TouchableOpacity>
          </View>
        </View>
        <ScrollView
          style={styles.scrollView}
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
          {renderMainPage()}
        </ScrollView>
      </Animated.View>

      {/* Subpage — slides in from right */}
      {currentPage !== 'main' && (
        <GestureDetector gesture={swipeBackGesture}>
        <Animated.View style={[styles.subpageContainer, subpageAnimatedStyle]}>
          <View style={styles.fixedHeader}>
            <View style={styles.subpageHeader}>
              <TouchableOpacity
                onPress={closeSubpage}
                style={styles.backButton}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={28} color={AppColors.primary} />
              </TouchableOpacity>
              <Text style={styles.title}>{subpageTitles[currentPage]}</Text>
              {currentPage === 'debugLog' && (
                <View style={styles.headerActions}>
                  <TouchableOpacity
                    onPress={() => {
                      hapticLight();
                      handleShareLogs();
                    }}
                    style={styles.logHeaderButton}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="share-outline" size={20} color={AppColors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      hapticLight();
                      handleClearLogs();
                    }}
                    style={styles.logHeaderButton}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="trash-outline" size={20} color={AppColors.error} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
          <ScrollView
            style={styles.scrollView}
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
            {currentPage === 'calendar' && renderCalendarPage()}
            {currentPage === 'units' && renderUnitsPage()}
            {currentPage === 'about' && renderAboutPage()}
            {currentPage === 'debugLog' && renderDebugLogPage()}
          </ScrollView>
        </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  modalContent: { flex: 1, marginHorizontal: -Spacing.xl, minHeight: '100%', overflow: 'hidden' },
  pageContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: AppColors.background.primary,
  },
  subpageContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: AppColors.background.primary,
  },
  fixedHeader: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
    backgroundColor: AppColors.background.primary,
  },
  divider: { height: 1, backgroundColor: AppColors.border.primary, marginVertical: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing.xs },
  subpageHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: Spacing.xs },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: 34, fontWeight: 'bold', color: AppColors.primary },
  closeButton: {
    ...CloseButtonStyle,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -Spacing.sm,
  },
  scrollView: { flex: 1 },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: AppColors.secondary,
    letterSpacing: 0.5,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  settingsList: { backgroundColor: AppColors.background.primary, borderRadius: BorderRadius.md, overflow: 'hidden' },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border.primary,
  },
  settingsItemLast: { borderBottomWidth: 0 },
  itemIconContainer: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
  itemContent: { flex: 1 },
  itemTitle: { fontSize: 17, color: AppColors.primary },
  itemSubtitle: { fontSize: 13, color: AppColors.secondary, marginTop: 2 },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  panelLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: AppColors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  toggleAllText: { fontSize: 15, fontWeight: '600', color: AppColors.primary },
  calendarDot: { alignItems: 'center', justifyContent: 'center' },
  syncButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AppColors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
  },
  syncButtonText: { fontSize: 17, fontWeight: '600', color: AppColors.background.primary },
  syncingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md },
  syncingText: { fontSize: 15, color: AppColors.secondary, marginLeft: Spacing.md },
  pillRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  pillOption: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: AppColors.background.primary,
    borderWidth: 1,
    borderColor: AppColors.border.primary,
  },
  pillOptionActive: { backgroundColor: AppColors.primary, borderColor: AppColors.primary },
  pillOptionText: { fontSize: 15, fontWeight: '600', color: AppColors.primary },
  pillOptionTextActive: { color: AppColors.background.primary },
  aboutText: { fontSize: 15, color: AppColors.secondary, lineHeight: 22, marginBottom: Spacing.sm },
  logHeaderButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: AppColors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: AppColors.border.primary,
  },
  logFilterPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.sm,
    backgroundColor: AppColors.background.primary,
    borderWidth: 1,
    borderColor: AppColors.border.primary,
  },
  logFilterPillActive: { backgroundColor: AppColors.primary, borderColor: AppColors.primary },
  logFilterPillText: { fontSize: 11, fontWeight: '700', color: AppColors.secondary, letterSpacing: 0.5 },
  logFilterPillTextActive: { color: AppColors.background.primary },
  logCount: { fontSize: 12, color: AppColors.secondary, marginBottom: Spacing.sm },
  logContainer: { gap: 1 },
  logEmptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.xl * 2, gap: Spacing.md },
  logEmptyText: { fontSize: 15, color: AppColors.secondary },
  logEntry: {
    backgroundColor: AppColors.background.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border.primary,
  },
  logEntryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  logLevel: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    letterSpacing: 0.5,
  },
  logTimestamp: {
    fontSize: 10,
    color: AppColors.tertiary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  logMessage: {
    fontSize: 12,
    color: AppColors.primary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    lineHeight: 17,
  },
  logData: {
    fontSize: 10,
    color: AppColors.secondary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    marginTop: 2,
    lineHeight: 14,
  },
});
