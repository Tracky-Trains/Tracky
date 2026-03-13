import { light as hapticLight, selection as hapticSelection } from '../../utils/haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Dimensions,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Calendar, DateData } from 'react-native-calendars';
import { FlatList } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { type ColorPalette, BorderRadius, Spacing, withTextShadow } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { PlaceholderBlurb } from '../PlaceholderBlurb';
import { TrainAPIService } from '../../services/api';
import type { Stop, Train } from '../../types/train';
import { addDays, getStartOfDay, isSameDay } from '../../utils/date-helpers';
import { useUnits } from '../../context/UnitsContext';
import { logger } from '../../utils/logger';
import { fetchWithTimeout } from '../../utils/fetch-with-timeout';
import { addDelayToTime, parseTimeToMinutes } from '../../utils/time-formatting';
import TrainCardContent from '../TrainCardContent';
import MarqueeText from './MarqueeText';
import { SkeletonBox } from './SkeletonBox';
import { getCurrentMinutesInTimezone, getCurrentSecondsInTimezone, getTimezoneForStop } from '../../utils/timezone';
import { gtfsParser } from '../../utils/gtfs-parser';
import { formatTemp, weatherApiTempUnit } from '../../utils/units';
import { getWeatherCondition } from '../../utils/weather';
import { SlideUpModalContext } from './slide-up-modal';
import { createStyles as createTrainCardStyles } from '../../screens/styles';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const getCalendarTheme = (colors: ColorPalette, isDark: boolean) => ({
  calendarBackground: colors.background.tertiary,
  dayTextColor: colors.primary,
  monthTextColor: colors.primary,
  arrowColor: colors.primary,
  selectedDayBackgroundColor: '#FFFFFF',
  selectedDayTextColor: '#000000',
  textDisabledColor: colors.tertiary,
  todayTextColor: colors.primary,
  todayBackgroundColor: colors.background.primary,
  textSectionTitleColor: colors.secondary,
  textDayFontWeight: 'bold' as const,
  textMonthFontWeight: 'bold' as const,
  textDayHeaderFontWeight: 'bold' as const,
  textMonthFontSize: 18,
});

interface DepartureBoardModalProps {
  station: Stop;
  onClose: () => void;
  onTrainSelect: (train: Train) => void;
  onSaveTrain?: (train: Train, travelDate: Date) => Promise<boolean>;
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
  filterMode: 'all' | 'departing' | 'arriving',
  stationTimezone: string | null
): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDate = new Date(selectedDate);
  targetDate.setHours(0, 0, 0, 0);

  // If selected date is not today, show all trains
  if (targetDate.getTime() !== today.getTime()) {
    return true;
  }

  // Times are now in the station's local timezone, so compare "now" in that timezone
  const currentMinutes = getCurrentMinutesInTimezone(stationTimezone ?? gtfsParser.agencyTimezone);

  let relevantTime: string;
  if (filterMode === 'arriving' || train.toCode === stationId) {
    // For arriving filter or trains terminating here, use arrival time
    relevantTime = train.arriveTime;
  } else if (train.fromCode === stationId) {
    // For trains originating here, use departure time
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

/**
 * Get the arrival time for a specific station from a train's stops
 * Returns the time at the station, or falls back to destination arrival time
 */
function getStationArrivalTime(train: Train, stationId: string): { time: string; dayOffset?: number } {
  // If station is the destination, use arriveTime
  if (train.toCode === stationId) {
    return { time: train.arriveTime, dayOffset: train.arriveDayOffset };
  }

  // If station is the origin, use departTime (arrival = departure for origin)
  if (train.fromCode === stationId) {
    return { time: train.departTime, dayOffset: train.departDayOffset };
  }

  // Check intermediate stops for the station
  if (train.intermediateStops) {
    const stop = train.intermediateStops.find(s => s.code === stationId);
    if (stop) {
      return { time: stop.time, dayOffset: undefined };
    }
  }

  // Fallback to destination arrival time
  return { time: train.arriveTime, dayOffset: train.arriveDayOffset };
}

interface DepartureItemProps {
  train: Train;
  stationTime: { time: string; dayOffset?: number };
  stationId: string;
  selectedDate: Date;
  onPress: () => void;
}

const DepartureItem = React.memo(function DepartureItem({ train, stationTime, stationId, selectedDate, onPress }: DepartureItemProps) {
  const { colors } = useTheme();
  const trainCardStyles = useMemo(() => createTrainCardStyles(colors), [colors]);
  const departStyles = useMemo(() => createDepartureStyles(colors), [colors]);

  const depDelay = train.realtime?.delay;

  const countdown = useMemo(() => {
    // Times are in the station's local timezone; compare "now" in same tz
    const stopData = gtfsParser.getStop(stationId);
    const tz = stopData ? getTimezoneForStop(stopData) : gtfsParser.agencyTimezone;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(selectedDate);
    target.setHours(0, 0, 0, 0);
    const daysAway = Math.round((target.getTime() - today.getTime()) / 86400000);

    if (daysAway > 0) {
      return { value: daysAway, unit: daysAway === 1 ? 'DAY' : 'DAYS', past: false };
    }

    const nowSec = getCurrentSecondsInTimezone(tz);
    const departSec = parseTimeToMinutes(stationTime.time) * 60
      + (stationTime.dayOffset ?? 0) * 24 * 3600
      + (depDelay && depDelay > 0 ? depDelay * 60 : 0);
    const deltaSec = departSec + daysAway * 86400 - nowSec;
    const past = deltaSec < 0;
    const absSec = Math.abs(deltaSec);

    const hours = Math.round(absSec / 3600);
    if (hours >= 1) return { value: hours, unit: hours === 1 ? 'HOUR' : 'HOURS', past };
    const minutes = Math.round(absSec / 60);
    if (minutes >= 60) return { value: 1, unit: 'HOUR', past };
    if (minutes >= 1) return { value: minutes, unit: minutes === 1 ? 'MINUTE' : 'MINUTES', past };
    const seconds = Math.round(absSec);
    if (seconds >= 60) return { value: 1, unit: 'MINUTE', past };
    return { value: seconds, unit: seconds === 1 ? 'SECOND' : 'SECONDS', past };
  }, [stationTime, selectedDate, stationId, depDelay]);

  const countdownLabel = countdown.unit;
  const arrDelay = train.realtime?.arrivalDelay;
  const depDelayed = depDelay && depDelay > 0 ? addDelayToTime(train.departTime, depDelay, train.departDayOffset) : undefined;
  const arrDelayed = arrDelay && arrDelay > 0 ? addDelayToTime(train.arriveTime, arrDelay, train.arriveDayOffset) : undefined;

  return (
    <View>
      <TouchableOpacity activeOpacity={0.7} onPress={() => { hapticLight(); onPress(); }}>
        <View style={trainCardStyles.trainCard}>
          <TrainCardContent
            countdownValue={countdown.value}
            countdownLabel={countdownLabel}
            isPast={countdown.past}
            routeName={train.routeName || train.operator}
            trainNumber={train.trainNumber}
            fromName={train.from}
            toName={train.to}
            fromCode={train.fromCode}
            toCode={train.toCode}
            departTime={train.departTime}
            arriveTime={train.arriveTime}
            departDayOffset={train.departDayOffset}
            arriveDayOffset={train.arriveDayOffset}
            intermediateStopCount={train.intermediateStops?.length}
            departDelayMinutes={depDelay}
            departDelayedTime={depDelayed?.time}
            departDelayedDayOffset={depDelayed?.dayOffset}
            arriveDelayMinutes={arrDelay}
            arriveDelayedTime={arrDelayed?.time}
            arriveDelayedDayOffset={arrDelayed?.dayOffset}
          />
        </View>
      </TouchableOpacity>
      <View style={departStyles.separator} />
    </View>
  );
});

function SkeletonDepartureRow({ colors }: { colors: ColorPalette }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 4 }}>
        {/* Left: countdown */}
        <View style={{ width: 52, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <SkeletonBox width={40} height={36} borderRadius={8} />
          <SkeletonBox width={30} height={12} borderRadius={4} style={{ marginTop: 4 }} />
        </View>
        {/* Center: route and times */}
        <View style={{ flex: 1 }}>
          <SkeletonBox width={100} height={14} borderRadius={4} />
          <SkeletonBox width="80%" height={18} borderRadius={4} style={{ marginTop: 6 }} />
          <View style={{ flexDirection: 'row', marginTop: 6, gap: 16 }}>
            <SkeletonBox width={60} height={13} borderRadius={4} />
            <SkeletonBox width={60} height={13} borderRadius={4} />
          </View>
        </View>
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border.primary }} />
    </View>
  );
}

export default function DepartureBoardModal({
  station,
  onClose,
  onTrainSelect,
  onSaveTrain,
}: DepartureBoardModalProps) {
  const { colors, isDark, closeButtonStyle } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const departStyles = useMemo(() => createDepartureStyles(colors), [colors]);
  const trainCardStyles = useMemo(() => createTrainCardStyles(colors), [colors]);
  const calendarTheme = useMemo(() => getCalendarTheme(colors, isDark), [colors, isDark]);

  const [departures, setDepartures] = useState<Train[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTransitioning, setFilterTransitioning] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'departing' | 'arriving'>('all');
  const [weather, setWeather] = useState<{ temp: number; icon: string } | null>(null);
  const { tempUnit } = useUnits();

  const { isCollapsed, isFullscreen, scrollOffset, contentOpacity, panRef, snapToPoint } = React.useContext(SlideUpModalContext);

  // Animated style for content that fades between half and collapsed states
  const fadeAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: contentOpacity.value,
    };
  });

  // Check if modal is at half height (not collapsed and not fullscreen)
  const isHalfHeight = !isCollapsed && !isFullscreen;

  // Fetch departures for the station
  // setLoading(true) first, then defer the heavy GTFS work so the skeleton paints before the lag.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        const trains = await TrainAPIService.getTrainsForStation(station.stop_id, selectedDate);
        if (cancelled) return;
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
        logger.info(`[DepartureBoard] Fetched ${deduped.length} trains for ${station.stop_id} on ${toDateString(selectedDate)}`);
        setDepartures(deduped);
      } catch (error) {
        if (cancelled) return;
        logger.error('[DepartureBoard] Error fetching departures:', error);
        setDepartures([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 50);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [station.stop_id, selectedDate]);

  // Fetch weather for station (current for today, daily forecast for future dates)
  useEffect(() => {
    let cancelled = false;
    const fetchWeather = async () => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const selected = new Date(selectedDate);
        selected.setHours(0, 0, 0, 0);
        const isToday = selected.getTime() === today.getTime();
        const unit = weatherApiTempUnit(tempUnit);

        let temp: number;
        let code: number;

        if (isToday) {
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${station.stop_lat}&longitude=${station.stop_lon}&current=temperature_2m,weather_code&temperature_unit=${unit}&timezone=auto`;
          const res = await fetchWithTimeout(url, { timeoutMs: 10000 });
          if (!res.ok || cancelled) return;
          const data = await res.json();
          temp = data.current?.temperature_2m ?? 0;
          code = data.current?.weather_code ?? 0;
        } else {
          const dateStr = selected.toISOString().slice(0, 10);
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${station.stop_lat}&longitude=${station.stop_lon}&daily=temperature_2m_max,temperature_2m_min,weather_code&start_date=${dateStr}&end_date=${dateStr}&temperature_unit=${unit}&timezone=auto`;
          const res = await fetchWithTimeout(url, { timeoutMs: 10000 });
          if (!res.ok || cancelled) return;
          const data = await res.json();
          const high = data.daily?.temperature_2m_max?.[0] ?? 0;
          const low = data.daily?.temperature_2m_min?.[0] ?? 0;
          temp = (high + low) / 2;
          code = data.daily?.weather_code?.[0] ?? 0;
        }

        if (!cancelled) {
          const info = getWeatherCondition(code);
          setWeather({
            temp: Math.round(temp),
            icon: info.icon,
          });
        }
      } catch (err) {
        logger.debug('[DepartureBoard] Weather fetch failed (non-critical):', err);
      }
    };
    fetchWeather();
    return () => { cancelled = true; };
  }, [station.stop_id, station.stop_lat, station.stop_lon, tempUnit, selectedDate]);

  // Compute station timezone once for filtering
  const stationTimezone = useMemo(() => getTimezoneForStop(station), [station]);

  // Format local time at the station
  const [localTime, setLocalTime] = useState<string | null>(null);
  useEffect(() => {
    const update = () => {
      if (!stationTimezone) { setLocalTime(null); return; }
      try {
        const now = new Date();
        const formatted = now.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: stationTimezone,
          timeZoneName: 'short',
        });
        setLocalTime(formatted);
      } catch { setLocalTime(null); }
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [stationTimezone]);

  // Filter departures based on search, date, and filter mode
  const filteredDepartures = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = departures.filter(train => {
      // Filter by upcoming time for today (using relevant time based on filter mode)
      if (!isTrainUpcoming(train, selectedDate, station.stop_id, filterMode, stationTimezone)) {
        return false;
      }

      // Filter by departing/arriving mode
      if (filterMode !== 'all') {
        // For departing: show trains that depart from this station (not terminating here)
        const isDeparting = train.toCode !== station.stop_id;
        // For arriving: show trains that arrive at this station (not originating here)
        const isArriving = train.fromCode !== station.stop_id;
        if (filterMode === 'departing' && !isDeparting) return false;
        if (filterMode === 'arriving' && !isArriving) return false;
      }

      // Filter by search query (destination, train number, route name)
      if (query) {
        return (
          train.to.toLowerCase().includes(query) ||
          train.toCode.toLowerCase().includes(query) ||
          train.from.toLowerCase().includes(query) ||
          train.fromCode.toLowerCase().includes(query) ||
          train.trainNumber.toLowerCase().includes(query) ||
          (train.routeName?.toLowerCase().includes(query) ?? false)
        );
      }

      return true;
    });

    // Sort based on filter mode
    return filtered.sort((a, b) => {
      if (filterMode === 'arriving') {
        // Sort by arrival time at this station
        const aTime = getStationArrivalTime(a, station.stop_id);
        const bTime = getStationArrivalTime(b, station.stop_id);
        return parseTimeToMinutes(aTime.time) - parseTimeToMinutes(bTime.time);
      } else if (filterMode === 'departing') {
        // Sort by departure time from this station
        const aTime = getStationDepartureTime(a, station.stop_id);
        const bTime = getStationDepartureTime(b, station.stop_id);
        return parseTimeToMinutes(aTime.time) - parseTimeToMinutes(bTime.time);
      } else {
        // 'all' mode: sort by the time at this station
        const aTime = getStationDepartureTime(a, station.stop_id);
        const bTime = getStationDepartureTime(b, station.stop_id);
        return parseTimeToMinutes(aTime.time) - parseTimeToMinutes(bTime.time);
      }
    });
  }, [departures, selectedDate, searchQuery, filterMode, station.stop_id, stationTimezone]);

  const calendarMinDate = useMemo(() => toDateString(new Date()), []);

  const calendarMarkedDates = useMemo(() => {
    const marks: Record<string, { selected?: boolean; selectedColor?: string }> = {};
    marks[toDateString(selectedDate)] = { selected: true, selectedColor: '#FFFFFF' };
    return marks;
  }, [selectedDate, isDark]);

  // Handle filter change with brief skeleton flash so the list swap isn't jarring
  const handleFilterChange = useCallback((mode: 'all' | 'departing' | 'arriving') => {
    hapticSelection();
    if (mode === filterMode) return;
    setFilterTransitioning(true);
    // Yield a frame so skeleton paints, then apply filter
    setTimeout(() => {
      setFilterMode(mode);
      setFilterTransitioning(false);
    }, 50);
  }, [filterMode]);

  // Date navigation — set loading immediately so skeleton shows in the same render
  const navigateDate = useCallback((direction: 'prev' | 'next') => {
    setLoading(true);
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

  // Handle calendar day press — set loading immediately so skeleton shows in the same render
  const handleDayPress = useCallback((day: DateData) => {
    hapticLight();
    setLoading(true);
    const [y, m, d] = day.dateString.split('-').map(Number);
    setSelectedDate(new Date(y, m - 1, d));
    setShowDatePicker(false);
  }, []);

  const handleTrainPress = useCallback(
    (train: Train) => {
      onSaveTrain?.(train, selectedDate);
    },
    [onSaveTrain, selectedDate]
  );

  const departureKeyExtractor = useCallback((item: Train) => `${item.tripId || item.id}`, []);

  const renderDepartureItem = useCallback(({ item: train }: { item: Train }) => {
    if (!train || !train.departTime) return null;
    const stationTime =
      filterMode === 'arriving'
        ? getStationArrivalTime(train, station.stop_id)
        : getStationDepartureTime(train, station.stop_id);
    return (
      <DepartureItem
        train={train}
        stationTime={stationTime}
        stationId={station.stop_id}
        selectedDate={selectedDate}
        onPress={() => handleTrainPress(train)}
      />
    );
  }, [filterMode, station.stop_id, selectedDate, handleTrainPress]);

  const departureListHeader = useMemo(() => (
    <Text style={styles.sectionTitle}>
      {filterMode === 'arriving' ? 'Arriving' : filterMode === 'departing' ? 'Departing' : 'All Trains'}{' '}
      ({filteredDepartures.length})
    </Text>
  ), [filterMode, filteredDepartures.length, styles]);

  // departureListEmpty is no longer needed — skeleton rows are rendered
  // outside the fade wrapper, and the empty placeholder is inlined in FlatList

  return (
    <View style={styles.modalContent}>
      {/* Fixed Header Area */}
      <View style={[styles.fixedHeader, isScrolled && styles.fixedHeaderScrolled]}>
        {/* Header - Title and close button */}
        <View style={styles.header}>
          <View style={styles.headerTextContainer}>
            <View style={styles.headerSubtitleRow}>
              <Text style={styles.headerSubtitle}>{station.stop_id}</Text>
              {weather && (
                <View style={styles.weatherBadge}>
                  <Text style={styles.weatherDot}> · </Text>
                  <Ionicons name={weather.icon as any} size={14} color={colors.secondary} />
                  <Text style={styles.weatherTemp}> {weather.temp}°{tempUnit}</Text>
                </View>
              )}
              {localTime && (
                <Text style={styles.weatherDot}> · </Text>
              )}
              {localTime && (
                <Text style={styles.headerSubtitle}>{localTime}</Text>
              )}
            </View>
            <MarqueeText text={station.stop_name} style={styles.headerTitle} />
          </View>
          <TouchableOpacity onPress={() => { hapticLight(); onClose(); }} style={[closeButtonStyle, styles.closeButton]} activeOpacity={0.6}>
            <Ionicons name="close" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <Animated.View style={fadeAnimatedStyle}>
          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={18} color={colors.secondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by destination or train..."
              placeholderTextColor={colors.tertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => { hapticLight(); if (!isFullscreen) snapToPoint?.('max'); }}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => { hapticLight(); setSearchQuery(''); }}>
                <Ionicons name="close-circle" size={18} color={colors.secondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Date Selector and Filter Row */}
          <View style={styles.dateSelectorRow}>
            {/* Date Navigation */}
            <View style={styles.dateSelector}>
              <TouchableOpacity
                style={[styles.dateArrow, !canGoBack && styles.dateArrowDisabled]}
                onPress={() => { if (canGoBack) { hapticLight(); navigateDate('prev'); } }}
                disabled={!canGoBack}
              >
                <Ionicons name="chevron-back" size={20} color={canGoBack ? colors.primary : colors.tertiary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.dateDisplay} onPress={() => { hapticLight(); setShowDatePicker(true); }} activeOpacity={0.7}>
                <Ionicons name="calendar-outline" size={16} color={colors.secondary} />
                <Text style={styles.dateText}>{formatDateDisplay(selectedDate)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dateArrow} onPress={() => { hapticLight(); navigateDate('next'); }}>
                <Ionicons name="chevron-forward" size={20} color={colors.primary} />
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
                onPress={() => handleFilterChange('all')}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterText, filterMode === 'all' && styles.filterTextActive]}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterButton, filterMode === 'departing' && styles.filterButtonActive]}
                onPress={() => handleFilterChange('departing')}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="arrow-top-right"
                  size={18}
                  color={colors.primary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.filterButton,
                  styles.filterButtonRight,
                  filterMode === 'arriving' && styles.filterButtonActive,
                ]}
                onPress={() => handleFilterChange('arriving')}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="arrow-bottom-left"
                  size={18}
                  color={colors.primary}
                />
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>

      {/* Skeleton rows outside fade wrapper — visible immediately during slide-in, date change, or filter change */}
      {(loading || filterTransitioning) && (
        <View style={{ flex: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.md }}>
          {[0, 1, 2, 3, 4].map(i => (
            <SkeletonDepartureRow key={i} colors={colors} />
          ))}
        </View>
      )}
      {/* Real content inside fade wrapper */}
      {!loading && !filterTransitioning && (
      <Animated.View style={[{ flex: 1 }, fadeAnimatedStyle]}>
        {/* Date Picker */}
        {showDatePicker && (
          <View style={styles.datePickerContainer}>
            <Calendar
              theme={calendarTheme}
              markedDates={calendarMarkedDates}
              minDate={calendarMinDate}
              onDayPress={handleDayPress}
              hideExtraDays
              enableSwipeMonths
            />
          </View>
        )}

        <FlatList
          data={filteredDepartures}
          keyExtractor={departureKeyExtractor}
          renderItem={renderDepartureItem}
          ListHeaderComponent={filteredDepartures.length > 0 ? departureListHeader : null}
          ListEmptyComponent={
            <PlaceholderBlurb
              icon="train-outline"
              title={
                searchQuery
                  ? 'No trains match your search'
                  : filterMode === 'departing'
                    ? 'No departing trains found'
                    : filterMode === 'arriving'
                      ? 'No arriving trains found'
                      : 'No trains found for this station'
              }
              subtitle={searchQuery ? 'Try a different search term' : 'Try changing the filter or date'}
            />
          }
          style={styles.scrollContent}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: isHalfHeight ? SCREEN_HEIGHT * 0.5 : 100, paddingHorizontal: Spacing.xl }}
          showsVerticalScrollIndicator={true}
          scrollEnabled={isFullscreen}
          waitFor={panRef}
          onScroll={e => {
            const offsetY = e.nativeEvent.contentOffset.y;
            if (scrollOffset) scrollOffset.value = offsetY;
            setIsScrolled(offsetY > 0);
          }}
          scrollEventThrottle={16}
          bounces={isFullscreen}
          nestedScrollEnabled={true}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={9}
          removeClippedSubviews={true}
        />
      </Animated.View>
      )}
    </View>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create(withTextShadow({
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
    borderBottomColor: colors.border.primary,
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
  headerSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.secondary,
  },
  weatherBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weatherDot: {
    fontSize: 14,
    color: colors.tertiary,
  },
  weatherTemp: {
    fontSize: 14,
    color: colors.secondary,
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.primary,
  },
  closeButton: {
    position: 'absolute',
    zIndex: 20,
    right: Spacing.xl,
    top: -Spacing.sm,
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
    backgroundColor: colors.background.tertiary,
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
    backgroundColor: colors.background.tertiary,
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.tertiary,
  },
  filterTextActive: {
    color: colors.primary,
  },
  dateArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background.tertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateArrowDisabled: {
    backgroundColor: colors.background.primary,
  },
  dateDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: colors.background.tertiary,
    borderRadius: BorderRadius.md,
  },
  dateText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  datePickerContainer: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    backgroundColor: colors.background.tertiary,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    padding: Spacing.md,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.xl,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: colors.background.tertiary,
    borderRadius: BorderRadius.md,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.primary,
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
    color: colors.secondary,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.secondary,
    marginBottom: Spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
}, colors.textShadow));

const createDepartureStyles = (colors: ColorPalette) => StyleSheet.create({
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border.primary,
  },
});
