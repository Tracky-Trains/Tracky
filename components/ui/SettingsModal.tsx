import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Linking,
  Platform,
  Share,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { type ColorPalette, BorderRadius, Spacing, getCloseButtonStyle, withTextShadow } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { type DistanceUnit, type TempUnit, useUnits } from '../../context/UnitsContext';
import {
  type DeviceCalendar,
  getDeviceCalendars,
  hasCalendarPermission,
  requestCalendarPermission,
  syncPastTrips,
} from '../../services/calendar-sync';
import * as Notifications from 'expo-notifications';
import { requestPermissions, getPermissionStatus } from '../../services/notifications';
import { type NotificationPrefs, DEFAULT_NOTIFICATION_PREFS, TrainStorageService } from '../../services/storage';
import { TrainActivityManager } from '../../services/train-activity-manager';
import { useTrainContext } from '../../context/TrainContext';
import { light as hapticLight, selection as hapticSelection } from '../../utils/haptics';
import { type LogEntry, LogLevel, logger, openReportBugEmail } from '../../utils/logger';
import { useGTFSRefresh } from '../../context/GTFSRefreshContext';
import { PlaceholderBlurb } from '../PlaceholderBlurb';
import { SlideUpModalContext } from './slide-up-modal';
import { pluralCount } from '../../utils/train-display';

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
  { label: '🌭', value: 'hotdogs', desc: '🌭' },
];

const LOG_FILTER_KEY = 'DEBUG_LOG_FILTER';

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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { isFullscreen, scrollOffset, panRef } = useContext(SlideUpModalContext);
  const { tempUnit, distanceUnit, setTempUnit, setDistanceUnit } = useUnits();
  const [currentPage, setCurrentPage] = useState<
    'main' | 'calendar' | 'units' | 'about' | 'dataProviders' | 'debugLog' | 'notifications'
  >('main');
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [calendarsLoaded, setCalendarsLoaded] = useState(false);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());
  const [scanDays, setScanDays] = useState(30);
  const [matchGtfs, setMatchGtfs] = useState(false);
  const [debugLogs, setDebugLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<LogLevel | 'ALL'>('ALL');
  const [forceCrash, setForceCrash] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const { savedTrains } = useTrainContext();
  const { debugShowLoadingScreen } = useGTFSRefresh();

  const { width: SCREEN_WIDTH } = Dimensions.get('window');
  const slideX = useSharedValue(0); // 0 = main, 1 = subpage

  const openSubpage = useCallback(
    (page: 'calendar' | 'units' | 'about' | 'dataProviders' | 'debugLog' | 'notifications') => {
      hapticLight();
      setCurrentPage(page);
      slideX.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
    },
    []
  );

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
    opacity: 1 - slideX.value,
  }));

  const subpageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - slideX.value) * SCREEN_WIDTH }],
  }));

  const swipeBackGesture = Gesture.Pan()
    .activeOffsetX(20)
    .failOffsetY([-20, 20])
    .onUpdate(e => {
      const progress = Math.max(0, e.translationX) / SCREEN_WIDTH;
      slideX.value = 1 - progress;
    })
    .onEnd(e => {
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
        setMatchGtfs(prefs.matchGtfs ?? false);
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

    TrainStorageService.getNotificationPrefs().then(setNotifPrefs);

    AsyncStorage.getItem(LOG_FILTER_KEY).then(val => {
      if (val === 'ALL' || Object.values(LogLevel).includes(val as LogLevel)) {
        setLogFilter(val as LogLevel | 'ALL');
      }
    });
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
    await TrainStorageService.saveCalendarSyncPrefs({ calendarIds: ids, scanDays, matchGtfs });
    setSyncState('syncing');
    try {
      const result = await syncPastTrips(ids, scanDays, matchGtfs);
      const range = scanDays === -1 ? 'all time' : `last ${scanDays} days`;
      let title: string;
      let message: string;

      if (result.failReason === 'gtfs_not_loaded') {
        title = 'Sync Issue';
        message = "Amtrak schedule data hasn't loaded yet. Try again in a moment.";
      } else if (result.failReason === 'no_calendar_events') {
        title = 'No Events Found';
        message = `No calendar events found in the ${range}.\n\nMake sure the selected calendar${ids.length > 1 ? 's have' : ' has'} events in this range.`;
      } else if (result.failReason === 'no_pattern_match') {
        title = 'No Train Events';
        message = `Scanned ${pluralCount(result.totalCalendarEvents ?? 0, 'event')} (${range}) but none matched the "Train to ..." pattern.\n\nEvents must be titled like "Train to Philadelphia" to be detected.`;
      } else if (result.added === 0 && result.skipped > 0) {
        title = 'Already Synced';
        const indexed = result.totalCalendarEvents ?? 0;
        message = `Scanned ${pluralCount(indexed, 'event')}, found ${pluralCount(result.matched, 'trip')}.\n\nAll ${result.skipped} already exist in your history.`;
      } else if (result.matched === 0) {
        title = 'No Matches';
        const indexed = result.totalCalendarEvents ?? 0;
        message = `Scanned ${pluralCount(indexed, 'event')}, found ${pluralCount(result.parsed, 'train event')} but couldn\'t match any to ${matchGtfs ? 'current timetables' : 'known stations'}.\n\nCheck that event locations and destinations use valid station names.`;
      } else {
        title = 'Sync Complete';
        const indexed = result.totalCalendarEvents ?? 0;
        const lines: string[] = [];
        lines.push(
          `Scanned ${pluralCount(indexed, 'event')}, found ${pluralCount(result.matched, 'trip')}.`
        );
        lines.push(`${result.added} added to history.`);
        if (result.skipped > 0) {
          lines.push(`${result.skipped} already existed.`);
        }
        if (result.added > 0 && result.addedTrips.length > 0) {
          const preview = result.addedTrips.slice(0, 5);
          lines.push('');
          for (const t of preview) {
            lines.push(`${t.from} → ${t.to} (${t.date})`);
          }
          if (result.addedTrips.length > 5) {
            lines.push(`...and ${result.addedTrips.length - 5} more`);
          }
        }
        message = lines.join('\n');
      }

      Alert.alert(title, message);
      setSyncState('selecting');
    } catch {
      Alert.alert('Sync Error', 'Something went wrong while scanning your calendar.');
      setSyncState('selecting');
    }
  }, [selectedCalendarIds, scanDays, matchGtfs]);

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
            // Remove timestamp from AsyncStorage
            await AsyncStorage.removeItem('GTFS_LAST_FETCH');
            // Remove legacy AsyncStorage keys (if any remain)
            const legacyKeys = [
              'GTFS_ROUTES_JSON', 'GTFS_STOPS_JSON', 'GTFS_STOP_TIMES_JSON',
              'GTFS_SHAPES_JSON', 'GTFS_TRIPS_JSON', 'GTFS_CALENDAR_JSON',
              'GTFS_CALENDAR_DATES_JSON', 'GTFS_AGENCY_TIMEZONE',
            ];
            await AsyncStorage.multiRemove(legacyKeys).catch(() => {});
            // Remove filesystem cache directory
            try {
              const { Directory, Paths } = require('expo-file-system');
              const cacheDir = new Directory(Paths.document, 'gtfs-cache');
              if (cacheDir.exists) cacheDir.delete();
            } catch { /* ignore */ }
            Alert.alert('Done', 'GTFS data deleted.');
          },
        },
      ]
    );
  }, []);

  const handleDeletePastRoutes = useCallback(() => {
    Alert.alert(
      'Delete All Past Routes',
      'This will permanently delete your entire trip history. This cannot be undone.',
      [
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
      ]
    );
  }, []);

  const handleDeleteActiveRoutes = useCallback(() => {
    Alert.alert(
      'Delete All Active & Future Routes',
      'This will permanently delete all your active and upcoming trips. This cannot be undone.',
      [
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
      ]
    );
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

  const handleNotifToggle = useCallback(
    async (key: keyof NotificationPrefs, value: boolean) => {
      // On first enable, request permission
      if (value) {
        const status = await getPermissionStatus();
        if (status === 'denied') {
          Alert.alert('Notifications Disabled', 'Enable notifications in your device settings to use this feature.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]);
          return;
        }
        if (status === 'undetermined') {
          const granted = await requestPermissions();
          if (!granted) return;
        }
      }
      const updated = { ...notifPrefs, [key]: value };
      setNotifPrefs(updated);
      hapticSelection();
      TrainActivityManager.onPrefsChanged(updated, savedTrains).catch(e => logger.warn('TrainActivityManager.onPrefsChanged failed', e));
    },
    [notifPrefs, savedTrains]
  );

  const handleTestNotification = useCallback(() => {
    const sendTest = async (type: string) => {
      const granted = await requestPermissions();
      if (!granted) {
        Alert.alert('Permission Required', 'Enable notifications to send a test.');
        return;
      }
      const notifications: Record<string, { title: string; body: string }> = {
        morning: {
          title: 'Train 91 \u2022 NYP \u2192 BOS',
          body: 'Good morning! Your train today is On Time. 54\u00B0 Partly Cloudy at NYP, 48\u00B0 Clear at BOS.',
        },
        departure: {
          title: 'Train 91 departs in 2 hours',
          body: 'Departs from New York Penn Station at 2:30 PM. Currently On Time.',
        },
        delay: {
          title: 'Train 91 Delay Update',
          body: 'NYP \u2192 BOS \u2014 now Delayed 25m (was On Time)',
        },
        arrival: {
          title: 'Arrived at Boston South Station!',
          body: 'Train 91 from New York. 48\u00B0 Partly Cloudy. This is your 5th time here.',
        },
      };
      const n = notifications[type];
      if (!n) return;
      await Notifications.scheduleNotificationAsync({
        content: { title: n.title, body: n.body, sound: 'default' },
        trigger: null,
      });
      logger.info(`[Debug] Sent test notification: ${type}`);
    };

    Alert.alert('Test Notification', 'Which notification type?', [
      { text: 'Morning Status', onPress: () => sendTest('morning') },
      { text: 'Departure Reminder', onPress: () => sendTest('departure') },
      { text: 'Delay Alert', onPress: () => sendTest('delay') },
      { text: 'Arrival Alert', onPress: () => sendTest('arrival') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, []);

  const handleTestLiveActivity = useCallback(() => {
    const LA = () => require('../../services/live-activity');

    const baseTrain = {
      tripId: 'test-live-activity',
      trainNumber: '91',
      routeName: 'Northeast Regional',
      fromCode: 'NYP',
      toCode: 'BOS',
      from: 'New York',
      to: 'Boston',
      daysAway: 0,
    };

    const runAction = async (action: string) => {
      try {
        const LiveActivityService = LA();
        if (!LiveActivityService.isSupported()) {
          Alert.alert('Not Supported', 'Live Activities require iOS 16.2+ and a development build.');
          return;
        }
        if (action === 'end') {
          await LiveActivityService.endAll();
          Alert.alert('Done', 'All Live Activities ended.');
          return;
        }
        // End any existing test activity first so the new state is visible
        await LiveActivityService.endAll();
        const scenarios: Record<string, object> = {
          ontime_long:   { ...baseTrain, departTime: '9:25 AM',  arriveTime: '6:45 PM',  realtime: { delay: 0  } },
          ontime_short:  { ...baseTrain, departTime: '2:30 PM',  arriveTime: '3:05 PM',  realtime: { delay: 0  } },
          delayed:       { ...baseTrain, departTime: '2:30 PM',  arriveTime: '6:45 PM',  realtime: { delay: 18 } },
          arrived:       { ...baseTrain, departTime: '8:00 AM',  arriveTime: '8:01 AM',  realtime: { delay: 0  } },
        };
        const train = scenarios[action];
        const started = await LiveActivityService.startForTrain(train);
        if (started) {
          Alert.alert('Live Activity Started', 'Check the Dynamic Island or Lock Screen.\n\nLong-press the Dynamic Island pill to see the expanded view.');
        } else {
          Alert.alert('Not Available', 'Make sure you are running a development build and Live Activities are enabled in Settings > Tracky.');
        }
      } catch (e) {
        logger.error('[Debug] Live Activity test failed:', e);
        Alert.alert('Failed', `${e instanceof Error ? e.message : String(e)}`);
      }
    };

    Alert.alert('Test Live Activity', 'Pick a scenario to preview all Dynamic Island + Lock Screen states:', [
      { text: '🟢 On Time — Long journey (9h)',  onPress: () => runAction('ontime_long')  },
      { text: '🟢 On Time — Short trip (35m)',   onPress: () => runAction('ontime_short') },
      { text: '🔴 Delayed 18m',                  onPress: () => runAction('delayed')      },
      { text: '⬛ Arrived',                       onPress: () => runAction('arrived')      },
      { text: 'End All',                          onPress: () => runAction('end')          },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, []);

  const filteredLogs = logFilter === 'ALL' ? debugLogs : debugLogs.filter(l => l.level === logFilter);

  if (forceCrash) {
    throw new Error('Test crash triggered from debug menu');
  }

  const handleDeleteSyncedTrips = useCallback(() => {
    Alert.alert(
      'Delete Synced Trips',
      'This will delete all trips that were imported from your calendar. Manually added trips will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const removed = await TrainStorageService.deleteCalendarSyncedTrips();
            logger.info(`[Settings] Deleted ${removed} calendar-synced trips`);
            Alert.alert('Done', `Deleted ${pluralCount(removed, 'synced trip')}.`);
          },
        },
      ]
    );
  }, []);

  const renderMainPage = () => (
    <>
      <Text style={styles.sectionHeader}>NOTIFICATIONS</Text>
      <View style={styles.settingsList}>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => openSubpage('notifications')}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="notifications-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Notifications</Text>
            <Text style={styles.itemSubtitle}>Reminders, alerts, Live Activities</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
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
            <Ionicons name="speedometer-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Units</Text>
            <Text style={styles.itemSubtitle}>
              {TEMP_OPTIONS.find(o => o.value === tempUnit)?.label} {'\u2022'}{' '}
              {DISTANCE_OPTIONS.find(o => o.value === distanceUnit)?.desc}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionHeader}>AUTOMATIONS</Text>
      <View style={styles.settingsList}>
        <TouchableOpacity
          style={styles.settingsItem}
          activeOpacity={0.7}
          onPress={() => openSubpage('calendar')}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="calendar-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Calendar Sync</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => {
            hapticLight();
            handleDeleteSyncedTrips();
          }}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="trash-outline" size={22} color={colors.error} />
          </View>
          <View style={styles.itemContent}>
            <Text style={[styles.itemTitle, { color: colors.error }]}>Delete All Synced Trips</Text>
          </View>
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
            <Ionicons name="refresh" size={22} color={colors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Refresh Amtrak Schedule</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => {
            hapticLight();
            openReportBugEmail();
          }}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="bug-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Report a Bug / Bad Data</Text>
          </View>
          <Ionicons name="logo-github" size={20} color={colors.secondary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionHeader}>ABOUT</Text>
      <View style={styles.settingsList}>
        <TouchableOpacity style={styles.settingsItem} activeOpacity={0.7} onPress={() => openSubpage('about')}>
          <View style={styles.itemIconContainer}>
            <Ionicons name="information-circle-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>About This App</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.settingsItem, styles.settingsItemLast]}
          activeOpacity={0.7}
          onPress={() => openSubpage('dataProviders')}
        >
          <View style={styles.itemIconContainer}>
            <Ionicons name="server-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Data Providers</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
        </TouchableOpacity>
      </View>

      {distanceUnit === 'hotdogs' && (
        <>
          <Text style={styles.sectionHeader}>DEBUG</Text>
          <View style={styles.settingsList}>
            <TouchableOpacity style={styles.settingsItem} activeOpacity={0.7} onPress={() => openSubpage('debugLog')}>
              <View style={styles.itemIconContainer}>
                <Ionicons name="document-text-outline" size={22} color={colors.primary} />
              </View>
              <View style={styles.itemContent}>
                <Text style={styles.itemTitle}>View Debug Log</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.secondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsItem}
              activeOpacity={0.7}
              onPress={() => {
                hapticLight();
                handleTestNotification();
              }}
            >
              <View style={styles.itemIconContainer}>
                <Ionicons name="notifications-outline" size={22} color="#FBBF24" />
              </View>
              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: '#FBBF24' }]}>Test Notifications</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsItem}
              activeOpacity={0.7}
              onPress={() => {
                hapticLight();
                handleTestLiveActivity();
              }}
            >
              <View style={styles.itemIconContainer}>
                <Ionicons name="phone-portrait-outline" size={22} color="#FBBF24" />
              </View>
              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: '#FBBF24' }]}>Test Live Activity</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsItem}
              activeOpacity={0.7}
              onPress={() => {
                hapticLight();
                setForceCrash(true);
              }}
            >
              <View style={styles.itemIconContainer}>
                <Ionicons name="bug-outline" size={22} color="#FBBF24" />
              </View>
              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: '#FBBF24' }]}>Test Crash Screen</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsItem}
              activeOpacity={0.7}
              onPress={() => {
                hapticLight();
                onClose();
                setTimeout(() => debugShowLoadingScreen(), 300);
              }}
            >
              <View style={styles.itemIconContainer}>
                <Ionicons name="reload-outline" size={22} color="#FBBF24" />
              </View>
              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: '#FBBF24' }]}>Test Loading Screen (5s)</Text>
              </View>
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
                <Ionicons name="trash-outline" size={22} color={colors.error} />
              </View>
              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: colors.error }]}>Delete GTFS Data</Text>
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
                <Ionicons name="trash-outline" size={22} color={colors.error} />
              </View>
              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: colors.error }]}>Delete All Past Routes</Text>
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
                <Ionicons name="trash-outline" size={22} color={colors.error} />
              </View>
              <View style={styles.itemContent}>
                <Text style={[styles.itemTitle, { color: colors.error }]}>Delete All Active & Future Routes</Text>
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
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.syncingText}>Loading calendars...</Text>
        </View>
      )}
      {syncState === 'selecting' && (
        <>
          <View style={styles.panelHeader}>
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
                style={[
                  styles.settingsItem,
                  { paddingHorizontal: Spacing.lg },
                  i === calendars.length - 1 && styles.settingsItemLast,
                ]}
                activeOpacity={0.7}
                onPress={() => {
                  hapticSelection();
                  toggleCalendar(cal.id);
                }}
              >
                <View style={[styles.calendarDot, { marginRight: Spacing.md }]}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: cal.color }} />
                </View>
                <View style={styles.itemContent}>
                  <Text style={styles.itemTitle}>{cal.title}</Text>
                  <Text style={styles.itemSubtitle}>{cal.source}</Text>
                </View>
                {selectedCalendarIds.has(cal.id) && <Ionicons name="checkmark" size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.sectionHeader}>SCAN RANGE</Text>
          <View style={styles.settingsList}>
            {SCAN_OPTIONS.map((opt, i) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.settingsItem,
                  { paddingHorizontal: Spacing.lg },
                  i === SCAN_OPTIONS.length - 1 && styles.settingsItemLast,
                ]}
                onPress={() => {
                  hapticSelection();
                  setScanDays(opt.value);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.itemContent}>
                  <Text style={styles.itemTitle}>{opt.label}</Text>
                </View>
                {scanDays === opt.value && <Ionicons name="checkmark" size={20} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.sectionHeader}>MATCH GTFS TIMETABLES</Text>
          <View style={styles.settingsList}>
            {[
              { label: 'Strict', value: true, desc: 'Only sync trips found in current timetables' },
              { label: 'Allow All', value: false, desc: 'Sync all calendar events as trips' },
            ].map((opt, i) => (
              <TouchableOpacity
                key={opt.label}
                style={[styles.settingsItem, { paddingHorizontal: Spacing.lg }, i === 1 && styles.settingsItemLast]}
                onPress={() => {
                  hapticSelection();
                  setMatchGtfs(opt.value);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.itemContent}>
                  <Text style={styles.itemTitle}>{opt.label}</Text>
                  <Text style={styles.itemSubtitle}>{opt.desc}</Text>
                </View>
                {matchGtfs === opt.value && <Ionicons name="checkmark" size={20} color={colors.primary} />}
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
          <ActivityIndicator size="small" color={colors.primary} />
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
            style={[
              styles.settingsItem,
              { paddingHorizontal: Spacing.lg },
              i === TEMP_OPTIONS.length - 1 && styles.settingsItemLast,
            ]}
            onPress={() => {
              hapticSelection();
              setTempUnit(opt.value);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>{opt.label}</Text>
            </View>
            {tempUnit === opt.value && <Ionicons name="checkmark" size={20} color={colors.primary} />}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.sectionHeader}>DISTANCE</Text>
      <View style={styles.settingsList}>
        {DISTANCE_OPTIONS.map((opt, i) => (
          <TouchableOpacity
            key={opt.value}
            style={[
              styles.settingsItem,
              { paddingHorizontal: Spacing.lg },
              i === DISTANCE_OPTIONS.length - 1 && styles.settingsItemLast,
            ]}
            onPress={() => {
              hapticSelection();
              setDistanceUnit(opt.value);
            }}
            activeOpacity={0.7}
          >
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>{opt.label}</Text>
            </View>
            {distanceUnit === opt.value && <Ionicons name="checkmark" size={20} color={colors.primary} />}
          </TouchableOpacity>
        ))}
      </View>
    </>
  );

  const renderAboutPage = () => (
    <>
      <View>
        <Text style={styles.sectionHeader}>ABOUT</Text>
        <Text style={styles.aboutText}>
          A beautiful train-tracking companion for Amtrak travelers, heavily inspired by Flighty.
        </Text>
        <View style={[styles.settingsList, { marginTop: Spacing.md }]}>
          <TouchableOpacity
            style={styles.settingsItem}
            activeOpacity={0.7}
            onPress={() => {
              hapticLight();
              Linking.openURL('https://portfolio.jasonxu.me/');
            }}
          >
            <View style={styles.itemIconContainer}>
              <Text style={{ fontSize: 22 }}>🐄</Text>
            </View>
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>A Jason Xu Project</Text>
              <Text style={styles.itemSubtitle}>Moo? Moo... Moo!</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.secondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.settingsItem, styles.settingsItemLast]}
            activeOpacity={0.7}
            onPress={() => {
              hapticLight();
              Linking.openURL('https://github.com/Mootbing/Tracky');
            }}
          >
            <View style={styles.itemIconContainer}>
              <Ionicons name="logo-github" size={22} color={colors.primary} />
            </View>
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>View on GitHub</Text>
              <Text style={styles.itemSubtitle}>Tracky's open-source!</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.secondary} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.sectionHeader, { marginTop: Spacing.xl }]}>CONTRIBUTORS WANTED</Text>
        <Text style={styles.aboutText}>
          Tracky currently only supports Amtrak. Want to help bring support for other rail systems? We'd love
          contributors to help expand coverage to more networks.
        </Text>
        <View style={[styles.settingsList, { marginTop: Spacing.md }]}>
          <TouchableOpacity
            style={[styles.settingsItem, styles.settingsItemLast]}
            activeOpacity={0.7}
            onPress={() => {
              hapticLight();
              Linking.openURL('https://github.com/Mootbing/Tracky/compare');
            }}
          >
            <View style={styles.itemIconContainer}>
              <Ionicons name="git-pull-request-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>I'm Interested!</Text>
              <Text style={styles.itemSubtitle}>Open a PR — Note: the app is built with Expo, not Swift</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.secondary} />
          </TouchableOpacity>
        </View>
      </View>
    </>
  );

  const renderDataProvidersPage = () => (
    <>
      <View style={{ marginTop: Spacing.lg }}>
        <Text style={styles.aboutText}>
          Tracky relies on the following data sources to provide schedule and real-time train information.
        </Text>
        <Text style={styles.sectionHeader}>SCHEDULE DATA</Text>
        <View style={styles.settingsList}>
          <TouchableOpacity
            style={[styles.settingsItem, styles.settingsItemLast]}
            activeOpacity={0.7}
            onPress={() => {
              hapticLight();
              Linking.openURL('https://www.amtrak.com');
            }}
          >
            <View style={styles.itemIconContainer}>
              <Ionicons name="train-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>Amtrak GTFS</Text>
              <Text style={styles.itemSubtitle}>Routes, stops, trips, and timetables</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.secondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionHeader}>REAL-TIME DATA</Text>
        <View style={styles.settingsList}>
          <TouchableOpacity
            style={[styles.settingsItem, styles.settingsItemLast]}
            activeOpacity={0.7}
            onPress={() => {
              hapticLight();
              Linking.openURL('https://transitdocs.com');
            }}
          >
            <View style={styles.itemIconContainer}>
              <Ionicons name="pulse-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>Transitdocs</Text>
              <Text style={styles.itemSubtitle}>Live positions, delays, and service alerts</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.secondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionHeader}>WEATHER</Text>
        <View style={styles.settingsList}>
          <TouchableOpacity
            style={[styles.settingsItem, styles.settingsItemLast]}
            activeOpacity={0.7}
            onPress={() => {
              hapticLight();
              Linking.openURL('https://open-meteo.com');
            }}
          >
            <View style={styles.itemIconContainer}>
              <Ionicons name="partly-sunny-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>Open-Meteo</Text>
              <Text style={styles.itemSubtitle}>Current weather conditions and forecasts</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.secondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionHeader}>MAP</Text>
        <View style={styles.settingsList}>
          <TouchableOpacity
            style={[styles.settingsItem, styles.settingsItemLast]}
            activeOpacity={0.7}
            onPress={() => {
              hapticLight();
              Linking.openURL(Platform.OS === 'ios' ? 'https://maps.apple.com' : 'https://maps.google.com');
            }}
          >
            <View style={styles.itemIconContainer}>
              <Ionicons name="map-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>{Platform.OS === 'ios' ? 'Apple Maps' : 'Google Maps'}</Text>
              <Text style={styles.itemSubtitle}>Map tiles, satellite imagery, and routing</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.secondary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.sectionHeader}>TIMEZONE</Text>
        <View style={styles.settingsList}>
          <TouchableOpacity
            style={[styles.settingsItem, styles.settingsItemLast]}
            activeOpacity={0.7}
            onPress={() => {
              hapticLight();
              Linking.openURL('https://github.com/photostructure/tz-lookup');
            }}
          >
            <View style={styles.itemIconContainer}>
              <Ionicons name="time-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle}>tz-lookup</Text>
              <Text style={styles.itemSubtitle}>Offline timezone resolution from coordinates</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.secondary} />
          </TouchableOpacity>
        </View>
      </View>
    </>
  );

  const renderDebugLogPage = () => (
    <>
      <View style={styles.logContainer}>
        {filteredLogs.length === 0 ? (
          <PlaceholderBlurb
            icon="document-text-outline"
            title="No logs yet"
            subtitle="App activity will be logged here"
          />
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

  const renderNotificationsPage = () => (
    <>
      <Text style={styles.sectionHeader}>BEFORE YOUR TRIP</Text>
      <View style={styles.settingsList}>
        <View style={styles.settingsItem}>
          <View style={styles.itemIconContainer}>
            <Ionicons name="sunny-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Morning Status Alerts</Text>
            <Text style={styles.itemSubtitle}>Weather & on-time status at 7 AM</Text>
          </View>
          <Switch
            value={notifPrefs.morningAlerts}
            onValueChange={v => handleNotifToggle('morningAlerts', v)}
            trackColor={{ false: colors.border.primary, true: colors.accent }}
          />
        </View>
        <View style={[styles.settingsItem, styles.settingsItemLast]}>
          <View style={styles.itemIconContainer}>
            <Ionicons name="time-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Departure Reminders</Text>
            <Text style={styles.itemSubtitle}>Notify 2 hours before departure</Text>
          </View>
          <Switch
            value={notifPrefs.departureReminders}
            onValueChange={v => handleNotifToggle('departureReminders', v)}
            trackColor={{ false: colors.border.primary, true: colors.accent }}
          />
        </View>
      </View>

      <Text style={styles.sectionHeader}>DURING YOUR TRIP</Text>
      <View style={styles.settingsList}>
        <View style={styles.settingsItem}>
          <View style={styles.itemIconContainer}>
            <Ionicons name="warning-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Delay Alerts</Text>
            <Text style={styles.itemSubtitle}>Notify when delays change significantly</Text>
          </View>
          <Switch
            value={notifPrefs.delayAlerts}
            onValueChange={v => handleNotifToggle('delayAlerts', v)}
            trackColor={{ false: colors.border.primary, true: colors.accent }}
          />
        </View>
        <View style={[styles.settingsItem, styles.settingsItemLast]}>
          <View style={styles.itemIconContainer}>
            <Ionicons name="flag-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.itemContent}>
            <Text style={styles.itemTitle}>Arrival Alerts</Text>
            <Text style={styles.itemSubtitle}>Weather & visit stats on arrival</Text>
          </View>
          <Switch
            value={notifPrefs.arrivalAlerts}
            onValueChange={v => handleNotifToggle('arrivalAlerts', v)}
            trackColor={{ false: colors.border.primary, true: colors.accent }}
          />
        </View>
      </View>

      {Platform.OS === 'ios' && (
        <>
          <Text style={styles.sectionHeader}>LIVE TRACKING</Text>
          <View style={styles.settingsList}>
            <View style={[styles.settingsItem, styles.settingsItemLast]}>
              <View style={styles.itemIconContainer}>
                <Ionicons name="phone-portrait-outline" size={22} color={colors.primary} />
              </View>
              <View style={styles.itemContent}>
                <Text style={styles.itemTitle}>Live Activities</Text>
                <Text style={styles.itemSubtitle}>Show train on Lock Screen & Dynamic Island</Text>
              </View>
              <Switch
                value={notifPrefs.liveActivities}
                onValueChange={v => handleNotifToggle('liveActivities', v)}
                trackColor={{ false: colors.border.primary, true: colors.accent }}
              />
            </View>
          </View>
        </>
      )}
    </>
  );

  const subpageTitles: Record<string, string> = {
    calendar: 'Calendar Sync',
    units: 'Units',
    about: 'About This App',
    dataProviders: 'Data Providers',
    debugLog: 'Debug Log',
    notifications: 'Notifications',
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
              <Ionicons name="close" size={24} color={colors.primary} />
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
                <TouchableOpacity onPress={closeSubpage} style={styles.backButton} activeOpacity={0.7}>
                  <Ionicons name="chevron-back" size={28} color={colors.primary} />
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
                      <Ionicons name="share-outline" size={20} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        hapticLight();
                        handleClearLogs();
                      }}
                      style={styles.logHeaderButton}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
              {currentPage === 'debugLog' && (
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
                          AsyncStorage.setItem(LOG_FILTER_KEY, level);
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
                  <Text style={[styles.logCount, { marginTop: Spacing.sm }]}>
                    {pluralCount(filteredLogs.length, 'log')}
                  </Text>
                </>
              )}
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
              {currentPage === 'dataProviders' && renderDataProvidersPage()}
              {currentPage === 'debugLog' && renderDebugLogPage()}
              {currentPage === 'notifications' && renderNotificationsPage()}
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      )}
    </View>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create(withTextShadow({
  modalContent: { flex: 1, marginHorizontal: -Spacing.xl, minHeight: '100%', overflow: 'hidden' },
  pageContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  subpageContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  fixedHeader: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  divider: { height: 1, backgroundColor: colors.border.primary, marginVertical: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing.xs },
  subpageHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: Spacing.xs },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    position: 'absolute' as const,
    right: 0,
    top: Spacing.xs,
  },
  title: { fontSize: 34, fontWeight: 'bold', color: colors.primary },
  closeButton: {
    ...getCloseButtonStyle(colors),
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
    color: colors.secondary,
    letterSpacing: 0.5,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  settingsList: { borderRadius: BorderRadius.md, overflow: 'hidden' },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.primary,
  },
  settingsItemLast: { borderBottomWidth: 0 },
  itemIconContainer: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: Spacing.md },
  itemContent: { flex: 1 },
  itemTitle: { fontSize: 17, color: colors.primary },
  itemSubtitle: { fontSize: 13, color: colors.secondary, marginTop: 2 },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  panelLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  toggleAllText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  calendarDot: { alignItems: 'center', justifyContent: 'center' },
  syncButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
  },
  syncButtonText: { fontSize: 17, fontWeight: '600', color: colors.background.primary },
  syncingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md },
  syncingText: { fontSize: 15, color: colors.secondary, marginLeft: Spacing.md },
  pillRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  pillOption: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  pillOptionActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillOptionText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  pillOptionTextActive: { color: colors.background.primary },
  aboutText: { fontSize: 15, color: colors.secondary, lineHeight: 22, marginBottom: Spacing.sm },
  logHeaderButton: {
    ...getCloseButtonStyle(colors),
  },
  logFilterPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  logFilterPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  logFilterPillText: { fontSize: 11, fontWeight: '700', color: colors.secondary, letterSpacing: 0.5 },
  logFilterPillTextActive: { color: colors.background.primary },
  logCount: { fontSize: 12, color: colors.secondary, marginBottom: Spacing.sm },
  logContainer: { gap: 1 },
  logEntry: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.primary,
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
    color: colors.tertiary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  logMessage: {
    fontSize: 12,
    color: colors.primary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    lineHeight: 17,
  },
  logData: {
    fontSize: 10,
    color: colors.secondary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    marginTop: 2,
    lineHeight: 14,
  },
}, colors.textShadow));
