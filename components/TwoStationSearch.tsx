import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Calendar, DateData } from 'react-native-calendars';
import { ScrollView } from 'react-native-gesture-handler';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { type ColorPalette, BorderRadius, FontSizes, Spacing, withTextShadow } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import TrainCardContent from './TrainCardContent';
import { light as hapticLight, selection as hapticSelection, success as hapticSuccess } from '../utils/haptics';
import { getTrainDisplayName } from '../services/api';
import { TrainIcon } from './TrainIcon';
import { RealtimeService } from '../services/realtime';
import { TrainStorageService } from '../services/storage';
import type { EnrichedStopTime, Route, SearchResult, Stop, Trip } from '../types/train';
import { useTrainContext } from '../context/TrainContext';
import { SlideUpModalContext } from './ui/slide-up-modal';
import { gtfsParser } from '../utils/gtfs-parser';
import { logger } from '../utils/logger';
import { LocationSuggestionsService } from '../services/location-suggestions';
import { pluralCount } from '../utils/train-display';

interface TripResult {
  tripId: string;
  fromStop: EnrichedStopTime;
  toStop: EnrichedStopTime;
  intermediateStops: EnrichedStopTime[];
}

interface TwoStationSearchProps {
  onSelectTrip: (tripId: string, fromCode: string, toCode: string, date: Date) => void;
  onClose: () => void;
}

import { formatDateForDisplay } from '../utils/date-helpers';
import { addDelayToTime, formatTime, formatTimeWithDayOffset } from '../utils/time-formatting';
import { convertGtfsTimeForStop, getCurrentSecondsInTimezone } from '../utils/timezone';

const formatDateForPill = formatDateForDisplay;

function getCountdownFromDeparture(departureTime: string, travelDate: Date, delayMinutes?: number): { value: number; unit: string; past: boolean } {
  const [hStr, mStr] = departureTime.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const departSecOfDay = h * 3600 + m * 60 // handles GTFS h>=24 naturally
    + (delayMinutes && delayMinutes > 0 ? delayMinutes * 60 : 0);

  const tz = gtfsParser.agencyTimezone;
  const now = new Date();
  const nowSec = getCurrentSecondsInTimezone(tz);

  // Get today's date in agency timezone
  const todayParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || undefined,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const todayYear = parseInt(todayParts.find(p => p.type === 'year')!.value, 10);
  const todayMonth = parseInt(todayParts.find(p => p.type === 'month')!.value, 10);
  const todayDay = parseInt(todayParts.find(p => p.type === 'day')!.value, 10);

  // Day difference between travelDate and today (in agency tz)
  const travelDay = new Date(travelDate.getFullYear(), travelDate.getMonth(), travelDate.getDate());
  const todayDate = new Date(todayYear, todayMonth - 1, todayDay);
  const dayDiff = Math.round((travelDay.getTime() - todayDate.getTime()) / 86400000);

  const deltaSec = dayDiff * 86400 + departSecOfDay - nowSec;
  const past = deltaSec < 0;
  const absSec = Math.abs(deltaSec);

  const days = Math.round(absSec / 86400);
  if (days >= 1) return { value: days, unit: days === 1 ? 'DAY' : 'DAYS', past };
  const hours = Math.round(absSec / 3600);
  if (hours >= 1) return { value: hours, unit: hours === 1 ? 'HOUR' : 'HOURS', past };
  const minutes = Math.round(absSec / 60);
  if (minutes >= 1) return { value: minutes, unit: minutes === 1 ? 'MINUTE' : 'MINUTES', past };
  const seconds = Math.round(absSec);
  return { value: seconds, unit: seconds === 1 ? 'SECOND' : 'SECONDS', past };
}
const SCREEN_HEIGHT = Dimensions.get('window').height;

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

interface UnifiedResults {
  trains: SearchResult[];
  routes: SearchResult[];
  stations: SearchResult[];
}

// Sub-list shown when a route is selected (before picking a specific train)
interface RouteTrainItem {
  trainNumber: string;
  displayName: string;
  headsign: string;
  endpointLabel: string;
}

export function TwoStationSearch({ onSelectTrip, onClose }: TwoStationSearchProps) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const calendarTheme = useMemo(() => getCalendarTheme(colors, isDark), [colors, isDark]);
  const { panRef, scrollOffset, isFullscreen } = React.useContext(SlideUpModalContext);

  // --- Keyboard height tracking ---
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // --- Shared state ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(gtfsParser.isLoaded);
  const searchInputRef = useRef<TextInput>(null);

  // --- Station flow state (Path 2a) ---
  const [fromStation, setFromStation] = useState<Stop | null>(null);
  const [toStation, setToStation] = useState<Stop | null>(null);
  const [stationResults, setStationResults] = useState<Stop[]>([]);
  const [tripResults, setTripResults] = useState<TripResult[]>([]);
  const [tripDelays, setTripDelays] = useState<Map<string, { departDelay?: number; arriveDelay?: number }>>(new Map());
  const [activeField, setActiveField] = useState<'from' | 'to'>('from');

  // --- Train-number flow state (Path 2b) ---
  const [selectedTrainNumber, setSelectedTrainNumber] = useState<string | null>(null);
  const [selectedTrainName, setSelectedTrainName] = useState<string>('');
  const [resolvedTripId, setResolvedTripId] = useState<string | null>(null);
  const [trainStops, setTrainStops] = useState<EnrichedStopTime[]>([]);
  const [selectedFromStop, setSelectedFromStop] = useState<EnrichedStopTime | null>(null);
  const [trainNotRunning, setTrainNotRunning] = useState(false);

  // --- Unified search state (Path 1) ---
  const [unifiedResults, setUnifiedResults] = useState<UnifiedResults>({ trains: [], routes: [], stations: [] });

  // --- Route expansion state ---
  const [expandedRouteTrains, setExpandedRouteTrains] = useState<RouteTrainItem[] | null>(null);
  const [expandedRouteName, setExpandedRouteName] = useState<string>('');
  const [liveTrainNumbers, setLiveTrainNumbers] = useState<Set<string>>(new Set());
  const [filterLiveOnly, setFilterLiveOnly] = useState(false);
  const [routeFilterQuery, setRouteFilterQuery] = useState('');

  // --- Suggestion item type ---
  type SuggestionItem = {
    type: 'route' | 'station' | 'train';
    label: string;
    subtitle: string;
    routeId?: string;
    stop?: Stop;
    toStop?: Stop;
    trainNumber?: string;
    displayName?: string;
  };

  // --- Suggestions for empty search (three independent sections) ---
  const [nearbySuggestions, setNearbySuggestions] = useState<SuggestionItem[]>([]);
  const [historySuggestions, setHistorySuggestions] = useState<SuggestionItem[]>([]);
  const [popularSuggestions, setPopularSuggestions] = useState<SuggestionItem[]>([]);

  // --- "Alternatives to my train today" ---
  const { savedTrains } = useTrainContext();
  const todayTrain = useMemo(() => {
    const now = new Date();
    return savedTrains.find(t => t.daysAway === 0 && t.fromCode && t.toCode);
  }, [savedTrains]);

  useEffect(() => {
    if (!isDataLoaded) return;

    // Popular (always shown)
    const allRoutes = gtfsParser.getAllRoutes();
    const popular: SuggestionItem[] = [];
    const nerRoute = allRoutes.find(r => r.route_long_name.toLowerCase().includes('northeast regional'));
    if (nerRoute) {
      popular.push({ type: 'route', label: 'Northeast Regional', subtitle: 'Route', routeId: nerRoute.route_id });
    }
    const acelaRoute = allRoutes.find(r => r.route_long_name.toLowerCase().includes('acela'));
    if (acelaRoute) {
      popular.push({ type: 'route', label: 'Acela', subtitle: 'Route', routeId: acelaRoute.route_id });
    }
    const nyp = gtfsParser.getStop('NYP');
    if (nyp) {
      popular.push({ type: 'station', label: nyp.stop_name, subtitle: 'NYP · Station', stop: nyp });
    }
    setPopularSuggestions(popular);

    // Nearby (from location service)
    const locationSuggestions = LocationSuggestionsService.getCachedSuggestions();
    if (locationSuggestions && locationSuggestions.length > 0) {
      setNearbySuggestions(locationSuggestions);
    }

    // History
    TrainStorageService.getTripHistory().then(history => {
      if (history.length > 0) {
        const routeCounts = new Map<string, { count: number; routeName: string; fromCode: string; toCode: string }>();
        for (const trip of history) {
          const key = `${trip.fromCode}-${trip.toCode}`;
          const existing = routeCounts.get(key);
          if (existing) {
            existing.count++;
          } else {
            routeCounts.set(key, { count: 1, routeName: trip.routeName, fromCode: trip.fromCode, toCode: trip.toCode });
          }
        }
        const sorted = [...routeCounts.values()].sort((a, b) => b.count - a.count).slice(0, 1);
        setHistorySuggestions(sorted.map(r => ({
          type: 'station' as const,
          label: `${r.fromCode} → ${r.toCode}`,
          subtitle: `${r.routeName} · ${pluralCount(r.count, 'trip')}`,
          stop: gtfsParser.getStop(r.fromCode) || undefined,
          toStop: gtfsParser.getStop(r.toCode) || undefined,
        })));
      }
    });
  }, [isDataLoaded]);

  // --- Train service date range (for constraining date picker in train flow) ---
  const trainServiceInfo = useMemo(() => {
    if (!selectedTrainNumber || !isDataLoaded) return null;
    return gtfsParser.getServiceInfoForTrain(selectedTrainNumber);
  }, [selectedTrainNumber, isDataLoaded]);

  // Check if GTFS data is loaded
  useEffect(() => {
    const checkLoaded = () => {
      if (gtfsParser.isLoaded && !isDataLoaded) {
        setIsDataLoaded(true);
      }
    };
    checkLoaded();
    const interval = setInterval(checkLoaded, 500);
    return () => clearInterval(interval);
  }, [isDataLoaded]);

  // Search logic — branches based on current state
  useEffect(() => {
    if (!isDataLoaded || searchQuery.length === 0) {
      setUnifiedResults({ trains: [], routes: [], stations: [] });
      setStationResults([]);
      return;
    }

    if (fromStation && !toStation) {
      // Station flow: picking arrival station
      const results = gtfsParser.searchStations(searchQuery);
      setStationResults(results);
    } else if (!fromStation && !selectedTrainNumber && !expandedRouteTrains) {
      // Initial view: unified search (skip when filtering within a route)
      const results = gtfsParser.searchUnified(searchQuery);
      setUnifiedResults(results);
    }
  }, [searchQuery, isDataLoaded, fromStation, toStation, selectedTrainNumber, expandedRouteTrains]);

  // Find trips when both stations AND date are selected (station flow)
  useEffect(() => {
    if (fromStation && toStation && selectedDate) {
      logger.info(
        `[Search] Finding trips: ${fromStation.stop_name} → ${toStation.stop_name} on ${selectedDate.toLocaleDateString()}`
      );
      const trips = gtfsParser.findTripsWithStops(fromStation.stop_id, toStation.stop_id, selectedDate);
      logger.info(`[Search] Found ${trips.length} trips`);
      setTripResults(trips);
    } else {
      setTripResults([]);
    }
  }, [fromStation, toStation, selectedDate]);

  // Fetch delays for today's search results
  useEffect(() => {
    if (tripResults.length === 0 || !selectedDate) {
      setTripDelays(new Map());
      return;
    }
    // Only fetch delays if the selected date is today
    const now = new Date();
    const isToday =
      selectedDate.getFullYear() === now.getFullYear() &&
      selectedDate.getMonth() === now.getMonth() &&
      selectedDate.getDate() === now.getDate();
    if (!isToday) {
      setTripDelays(new Map());
      return;
    }

    let cancelled = false;
    const fetchDelays = async () => {
      const delays = new Map<string, { departDelay?: number; arriveDelay?: number }>();
      await Promise.all(
        tripResults.map(async (trip) => {
          const [depDelay, arrDelay] = await Promise.all([
            RealtimeService.getDelayForStop(trip.tripId, trip.fromStop.stop_id),
            RealtimeService.getArrivalDelayForStop(trip.tripId, trip.toStop.stop_id),
          ]);
          if (depDelay != null || arrDelay != null) {
            delays.set(trip.tripId, {
              departDelay: depDelay ?? undefined,
              arriveDelay: arrDelay ?? undefined,
            });
          }
        })
      );
      if (!cancelled) setTripDelays(delays);
    };

    fetchDelays();
    const interval = setInterval(fetchDelays, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [tripResults, selectedDate]);

  // Show date picker when both stations are selected but no date yet (station flow)
  useEffect(() => {
    if (fromStation && toStation && !selectedDate) {
      setShowDatePicker(true);
    }
  }, [fromStation, toStation, selectedDate]);

  // Resolve trip when train number + date are both set (train flow)
  useEffect(() => {
    if (!selectedTrainNumber || !selectedDate) {
      setResolvedTripId(null);
      setTrainStops([]);
      setTrainNotRunning(false);
      return;
    }
    const trip = gtfsParser.getTripForTrainOnDate(selectedTrainNumber, selectedDate);
    if (!trip) {
      setTrainNotRunning(true);
      setResolvedTripId(null);
      setTrainStops([]);
      return;
    }
    // Check if this trip's service is actually active on the date
    const isActive = gtfsParser.isServiceActiveOnDate(trip.service_id, selectedDate);
    if (!isActive) {
      setTrainNotRunning(true);
      setResolvedTripId(null);
      setTrainStops([]);
      return;
    }
    setTrainNotRunning(false);
    setResolvedTripId(trip.trip_id);
    const stops = gtfsParser.getStopTimesForTrip(trip.trip_id);
    setTrainStops(stops);
  }, [selectedTrainNumber, selectedDate]);

  // --- Handlers ---

  const handleSelectStation = (station: Stop) => {
    hapticSelection();
    if (activeField === 'from') {
      setFromStation(station);
      setActiveField('to');
      setSearchQuery('');
      setTimeout(() => searchInputRef.current?.focus(), 100);
    } else {
      setToStation(station);
      setSearchQuery('');
    }
  };

  const handleClearFrom = () => {
    hapticLight();
    setFromStation(null);
    setToStation(null);
    setSelectedDate(null);
    setTripResults([]);
    setActiveField('from');
    setSearchQuery('');
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const handleClearTo = () => {
    hapticLight();
    setToStation(null);
    setSelectedDate(null);
    setTripResults([]);
    setActiveField('to');
    setSearchQuery('');
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const handleClearDate = () => {
    hapticLight();
    setSelectedDate(null);
    setTripResults([]);
    setTrainStops([]);
    setResolvedTripId(null);
    setSelectedFromStop(null);
    setTrainNotRunning(false);
    setShowDatePicker(true);
  };

  const handleClearTrain = () => {
    hapticLight();
    setSelectedTrainNumber(null);
    setSelectedTrainName('');
    setSelectedDate(null);
    setResolvedTripId(null);
    setTrainStops([]);
    setSelectedFromStop(null);
    setTrainNotRunning(false);
    setExpandedRouteTrains(null);
    setExpandedRouteName('');
    setSearchQuery('');
    setRouteFilterQuery('');
    setFilterLiveOnly(false);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const calendarMinDate = useMemo(() => {
    if (trainServiceInfo) return toDateString(trainServiceInfo.minDate);
    return toDateString(new Date());
  }, [trainServiceInfo]);

  const calendarMaxDate = useMemo(() => {
    if (trainServiceInfo) return toDateString(trainServiceInfo.maxDate);
    return undefined;
  }, [trainServiceInfo]);

  const calendarMarkedDates = useMemo(() => {
    const marks: Record<string, { disabled?: boolean; disabledColor?: string; selected?: boolean; selectedColor?: string }> = {};

    if (selectedTrainNumber && trainServiceInfo && isDataLoaded) {
      const trips = gtfsParser.getTripsByNumber(selectedTrainNumber);
      if (trips.length > 0) {
        const current = new Date(trainServiceInfo.minDate);
        const end = trainServiceInfo.maxDate;
        while (current <= end) {
          const active = trips.some(trip => gtfsParser.isServiceActiveOnDate(trip.service_id, current));
          if (!active) {
            marks[toDateString(current)] = { disabled: true, disabledColor: '#555555' };
          }
          current.setDate(current.getDate() + 1);
        }
      }
    }

    if (selectedDate) {
      const key = toDateString(selectedDate);
      marks[key] = { ...marks[key], selected: true, selectedColor: '#FFFFFF' };
    }

    return marks;
  }, [selectedTrainNumber, trainServiceInfo, isDataLoaded, selectedDate]);

  const handleDayPress = (day: DateData) => {
    // Don't allow selecting disabled (greyed-out) dates
    const mark = calendarMarkedDates[day.dateString];
    if (mark?.disabled) return;

    hapticSuccess();
    const [y, m, d] = day.dateString.split('-').map(Number);
    setSelectedDate(new Date(y, m - 1, d));
    setShowDatePicker(false);
  };

  const handleSelectTrain = (trainNumber: string, displayName: string) => {
    hapticSelection();
    setSelectedTrainNumber(trainNumber);
    setSelectedTrainName(displayName);
    setSearchQuery('');
    setRouteFilterQuery('');
    setShowDatePicker(true);
    setExpandedRouteTrains(null);
    setExpandedRouteName('');
  };

  const handleSelectRoute = (route: Route) => {
    hapticSelection();
    const trains = gtfsParser.getTrainNumbersForRoute(route.route_id);
    if (trains.length === 1) {
      // Single train on route — go directly to train flow
      handleSelectTrain(trains[0].trainNumber, trains[0].displayName);
    } else {
      setExpandedRouteTrains(trains);
      setExpandedRouteName(route.route_long_name);
      setSearchQuery('');
      // Fetch live train numbers for status indicators
      RealtimeService.getAllActiveTrains().then(active => {
        const nums = new Set(active.map(t => t.trainNumber));
        setLiveTrainNumbers(nums);
      }).catch(e => logger.warn('Failed to fetch active trains', e));
    }
  };

  const handleSelectTrainStop = (stop: EnrichedStopTime) => {
    if (!resolvedTripId || !selectedDate) return;

    if (!selectedFromStop) {
      // First tap — set boarding stop
      hapticSelection();
      setSelectedFromStop(stop);
    } else if (stop.stop_sequence <= selectedFromStop.stop_sequence) {
      // Tapped earlier/same stop — reset from to this stop
      hapticSelection();
      setSelectedFromStop(stop);
    } else {
      // Second tap — destination stop, complete the selection
      hapticSuccess();
      onSelectTrip(resolvedTripId, selectedFromStop.stop_code, stop.stop_code, selectedDate);
    }
  };

  // --- Determine which view to render ---

  const hasUnifiedResults =
    unifiedResults.trains.length > 0 || unifiedResults.routes.length > 0 || unifiedResults.stations.length > 0;

  // ============================================================
  // PATH 1: Initial unified search (no station, no train selected)
  // ============================================================
  if (!fromStation && !selectedTrainNumber && !expandedRouteTrains) {
    const showingSearch = searchQuery.length > 0 && !showDatePicker;

    return (
      <View style={styles.container}>
        {/* Search bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={colors.secondary} />
          <TextInput
            ref={searchInputRef}
            style={styles.fullSearchInput}
            placeholder="Train number, route, or station"
            placeholderTextColor={colors.secondary}
            value={searchQuery}
            onChangeText={text => {
              setSearchQuery(text);
              setExpandedRouteName('');
            }}
            autoFocus
          />
          <TouchableOpacity
            onPress={() => {
              hapticLight();
              onClose();
            }}
          >
            <Ionicons name="close-circle" size={20} color={colors.secondary} />
          </TouchableOpacity>
        </View>

        {/* Results */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: (isFullscreen ? 100 : SCREEN_HEIGHT * 0.5) + keyboardHeight }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} scrollEnabled={isFullscreen} waitFor={panRef} bounces={false} onScroll={e => { if (scrollOffset) scrollOffset.value = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
          {/* Unified search results */}
          {showingSearch && (
            <View style={styles.resultsContainer}>
              {!isDataLoaded ? (
                <Text style={styles.noResults}>Loading...</Text>
              ) : !hasUnifiedResults ? (
                <Text style={styles.noResults}>No results found</Text>
              ) : (
                <>
                  {/* STATIONS section */}
                  {unifiedResults.stations.length > 0 && (
                    <>
                      <Text style={styles.sectionLabel}>STATIONS</Text>
                      {unifiedResults.stations.map(result => {
                        const stop = result.data as Stop;
                        return (
                          <TouchableOpacity
                            key={result.id}
                            style={styles.stationItem}
                            onPress={() => handleSelectStation(stop)}
                          >
                            <View style={styles.stationIcon}>
                              <Ionicons name="location" size={20} color={colors.primary} />
                            </View>
                            <View style={styles.stationInfo}>
                              <Text style={styles.stationName}>{result.name}</Text>
                              <Text style={styles.stationCode}>{result.subtitle}</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}

                  {/* ROUTES section */}
                  {unifiedResults.routes.length > 0 && (
                    <>
                      <Text
                        style={[styles.sectionLabel, unifiedResults.stations.length > 0 && { marginTop: Spacing.lg }]}
                      >
                        ROUTES
                      </Text>
                      {unifiedResults.routes.map(result => {
                        const route = result.data as Route;
                        return (
                          <TouchableOpacity
                            key={result.id}
                            style={styles.stationItem}
                            onPress={() => handleSelectRoute(route)}
                          >
                            <View style={styles.stationIcon}>
                              <Ionicons name="git-branch-outline" size={20} color={colors.primary} />
                            </View>
                            <View style={styles.stationInfo}>
                              <Text style={styles.stationName}>{result.name}</Text>
                              {result.subtitle ? <Text style={styles.stationCode}>{result.subtitle}</Text> : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}

                  {/* TRAINS section */}
                  {unifiedResults.trains.length > 0 && (
                    <>
                      <Text
                        style={[
                          styles.sectionLabel,
                          (unifiedResults.stations.length > 0 || unifiedResults.routes.length > 0) && {
                            marginTop: Spacing.lg,
                          },
                        ]}
                      >
                        TRAINS
                      </Text>
                      {unifiedResults.trains.map(result => {
                        const trip = result.data as Trip;
                        return (
                          <TouchableOpacity
                            key={result.id}
                            style={styles.stationItem}
                            onPress={() => handleSelectTrain(trip.trip_short_name || '', result.name)}
                          >
                            <View style={styles.stationIcon}>
                              <TrainIcon name={result.name} size={20} />
                            </View>
                            <View style={styles.stationInfo}>
                              <Text style={styles.stationName}>{result.name}</Text>
                              {result.subtitle ? <Text style={styles.stationCode}>{result.subtitle}</Text> : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </View>
          )}

          {/* Alternatives to my train today */}
          {!showingSearch && todayTrain && (
            <View style={styles.resultsContainer}>
              <Text style={styles.sectionLabel}>TODAY&apos;S TRIP</Text>
              <TouchableOpacity
                style={styles.stationItem}
                onPress={() => {
                  hapticSelection();
                  const from = gtfsParser.getStop(todayTrain.fromCode);
                  const to = gtfsParser.getStop(todayTrain.toCode);
                  if (from && to) {
                    setFromStation(from);
                    setToStation(to);
                    setSearchQuery('');
                    setSelectedDate(new Date());
                  }
                }}
              >
                <View style={styles.stationIcon}>
                  <Ionicons name="git-branch-outline" size={20} color={colors.primary} />
                </View>
                <View style={styles.stationInfo}>
                  <Text style={styles.stationName}>Alternatives to {todayTrain.trainNumber}</Text>
                  <Text style={styles.stationCode}>{todayTrain.fromCode} → {todayTrain.toCode} · {todayTrain.routeName}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.secondary} />
              </TouchableOpacity>
            </View>
          )}

          {/* Suggestion sections when search is empty */}
          {!showingSearch && [
            { key: 'history', label: 'BASED ON YOUR HISTORY', items: historySuggestions },
            { key: 'nearby', label: 'NEARBY', items: nearbySuggestions },
            { key: 'popular', label: 'POPULAR', items: popularSuggestions },
          ].map(section => section.items.length > 0 && (
            <View key={section.key} style={styles.resultsContainer}>
              <Text style={styles.sectionLabel}>{section.label}</Text>
              {section.items.map((suggestion, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.stationItem}
                  onPress={() => {
                    if (suggestion.type === 'train' && suggestion.trainNumber) {
                      handleSelectTrain(suggestion.trainNumber, suggestion.displayName || suggestion.label);
                    } else if (suggestion.type === 'route' && suggestion.routeId) {
                      const route = gtfsParser.getRoute(suggestion.routeId);
                      if (route) handleSelectRoute(route);
                    } else if (suggestion.stop && suggestion.toStop) {
                      hapticSelection();
                      setFromStation(suggestion.stop);
                      setToStation(suggestion.toStop);
                      setSearchQuery('');
                    } else if (suggestion.stop) {
                      handleSelectStation(suggestion.stop);
                    }
                  }}
                >
                  <View style={styles.stationIcon}>
                    {suggestion.type === 'train' ? (
                      <TrainIcon name={suggestion.label} size={20} />
                    ) : suggestion.type === 'route' || (suggestion.stop && suggestion.toStop) ? (
                      <Ionicons name="git-branch-outline" size={20} color={colors.primary} />
                    ) : (
                      <Ionicons name="location" size={20} color={colors.primary} />
                    )}
                  </View>
                  <View style={styles.stationInfo}>
                    <Text style={styles.stationName}>{suggestion.label}</Text>
                    <Text style={styles.stationCode}>{suggestion.subtitle}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ============================================================
  // PATH 2b: Train-number / route flow
  // ============================================================
  if (selectedTrainNumber || expandedRouteTrains) {
    const isRouteMode = !!expandedRouteTrains && !selectedTrainNumber;
    const showingTrainDatePicker = !isRouteMode && !selectedDate;
    const showingStopList = !isRouteMode && resolvedTripId && trainStops.length > 0;

    return (
      <View style={styles.container}>
        {/* Segment row */}
        <View style={styles.segmentRow}>
          {/* Left segment: Route or Train */}
          <TouchableOpacity
            style={[styles.segment, { flexShrink: 1 }]}
            onPress={handleClearTrain}
          >
            <TrainIcon name={isRouteMode ? expandedRouteName : selectedTrainName} size={14} />
            <Text style={styles.segmentText} numberOfLines={1}>
              {isRouteMode ? expandedRouteName : (selectedTrainName || `Train ${selectedTrainNumber}`)}
            </Text>
          </TouchableOpacity>

          {/* Right segment: Input (route mode) or Date (train mode) */}
          {isRouteMode ? (
            <View style={[styles.segment, styles.segmentInput]}>
              <TextInput
                ref={searchInputRef}
                style={styles.segmentTextInput}
                placeholder="Enter number"
                placeholderTextColor={colors.secondary}
                value={routeFilterQuery}
                onChangeText={setRouteFilterQuery}
                autoFocus
                keyboardType="number-pad"
              />
            </View>
          ) : !selectedDate ? (
            <View style={[styles.segment, styles.segmentDatePlaceholder]}>
              <Ionicons name="calendar-outline" size={14} color={colors.secondary} />
              <Text style={[styles.segmentText, { color: colors.secondary }]}>Select date</Text>
            </View>
          ) : (
            <TouchableOpacity style={[styles.segment, styles.segmentDate]} onPress={handleClearDate}>
              <Ionicons name="calendar-outline" size={14} color={colors.primary} />
              <Text style={styles.segmentText}>{formatDateForPill(selectedDate)}</Text>
            </TouchableOpacity>
          )}

        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: (isFullscreen ? 100 : SCREEN_HEIGHT * 0.5) + keyboardHeight }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} scrollEnabled={isFullscreen} waitFor={panRef} bounces={false} onScroll={e => { if (scrollOffset) scrollOffset.value = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
          {/* Route mode: filtered train list */}
          {isRouteMode && expandedRouteTrains && (
            <View>
              <View style={[styles.sectionHeaderRow, { marginBottom: Spacing.xl }]}>
                <Text style={[styles.sectionLabel, { marginBottom: 0, flex: 1 }]}>{expandedRouteName.toUpperCase()} TRAINS</Text>
                <TouchableOpacity
                  style={[styles.liveFilterBadge, filterLiveOnly && styles.liveFilterBadgeActive]}
                  onPress={() => {
                    hapticSelection();
                    setFilterLiveOnly(prev => !prev);
                  }}
                >
                  <View style={[styles.liveFilterDot, filterLiveOnly && styles.liveFilterDotActive]} />
                  <Text style={[styles.liveFilterText, filterLiveOnly && styles.liveFilterTextActive]}>En Route</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.resultsContainer}>
                {expandedRouteTrains.filter(train => {
                  if (filterLiveOnly && !liveTrainNumbers.has(train.trainNumber)) return false;
                  if (routeFilterQuery.length > 0) {
                    const q = routeFilterQuery.toLowerCase();
                    return train.trainNumber.toLowerCase().includes(q)
                      || train.displayName.toLowerCase().includes(q)
                      || (train.headsign && train.headsign.toLowerCase().includes(q))
                      || (train.endpointLabel && train.endpointLabel.toLowerCase().includes(q));
                  }
                  return true;
                }).map(train => {
                  const isLive = liveTrainNumbers.has(train.trainNumber);
                  const subtitle = train.endpointLabel || train.headsign;
                  return (
                    <TouchableOpacity
                      key={train.trainNumber}
                      style={styles.stationItem}
                      onPress={() => handleSelectTrain(train.trainNumber, train.displayName)}
                    >
                      <View style={styles.stationIcon}>
                        <TrainIcon name={train.displayName} size={20} />
                      </View>
                      <View style={styles.stationInfo}>
                        <Text style={styles.stationName}>{train.displayName}</Text>
                        {subtitle ? (
                          <Text style={styles.stationCode}>
                            {subtitle}
                            {isLive ? <Text style={styles.liveIndicator}> · En Route</Text> : null}
                          </Text>
                        ) : isLive ? (
                          <Text style={styles.liveIndicator}>En Route</Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Date picker (train mode) */}
          {!isRouteMode && showingTrainDatePicker && (
            <View style={styles.datePickerContainer}>
              <Text style={styles.sectionLabel}>SELECT TRAVEL DATE</Text>
              {[
                { label: 'Today', offset: 0 },
                { label: 'Tomorrow', offset: 1 },
              ].map(({ label, offset }) => {
                const d = new Date();
                d.setDate(d.getDate() + offset);
                return (
                  <TouchableOpacity key={label} style={styles.stationItem} onPress={() => handleDayPress({ dateString: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, day: d.getDate(), month: d.getMonth()+1, year: d.getFullYear(), timestamp: d.getTime() })}>
                    <View style={styles.stationIcon}>
                      <Ionicons name="calendar-outline" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.stationInfo}>
                      <Text style={styles.stationName}>{label}</Text>
                      <Text style={styles.stationCode}>{formatDateForPill(d)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.secondary} />
                  </TouchableOpacity>
                );
              })}
              <View style={styles.datePickerWrapper}>
                <Calendar
                  theme={calendarTheme}
                  markedDates={calendarMarkedDates}
                  minDate={calendarMinDate}
                  maxDate={calendarMaxDate}
                  onDayPress={handleDayPress}
                  hideExtraDays
                  enableSwipeMonths
                />
              </View>
            </View>
          )}

          {/* Train doesn't run message */}
          {!isRouteMode && trainNotRunning && selectedDate && (
            <View style={styles.hintContainer}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
              <Text style={[styles.hintText, { color: colors.error }]}>
                This train does not run on {formatDateForPill(selectedDate)}
              </Text>
            </View>
          )}

          {/* Stop list — pick boarding and destination */}
          {showingStopList && (
            <View style={styles.resultsContainer}>
              <Text style={styles.sectionLabel}>
                {!selectedFromStop ? 'SELECT BOARDING STOP' : 'SELECT DESTINATION STOP'}
              </Text>
              {trainStops.map((stop, index) => {
                const isBeforeFrom = selectedFromStop && stop.stop_sequence < selectedFromStop.stop_sequence;
                const isFrom =
                  selectedFromStop?.stop_id === stop.stop_id && selectedFromStop?.stop_sequence === stop.stop_sequence;
                const isDimmed = selectedFromStop && !isFrom && isBeforeFrom;
                const isOrigin = index === 0;
                const isDest = index === trainStops.length - 1;

                return (
                  <TouchableOpacity
                    key={`${stop.stop_id}-${stop.stop_sequence}`}
                    style={[styles.stopItem, isDimmed && styles.stopItemDimmed]}
                    onPress={() => handleSelectTrainStop(stop)}
                  >
                    {/* Absolute-positioned connector lines */}
                    {!isOrigin && <View style={styles.stopConnectorTop} />}
                    {!isDest && <View style={styles.stopConnectorBottom} />}

                    {/* Stop row content */}
                    <View style={styles.stopRow}>
                      <View style={styles.stopMarker}>
                        <View style={[styles.stopDot, isFrom && styles.stopDotSelected]} />
                      </View>

                      <View style={styles.stopInfo}>
                        <Text style={[styles.stopName, isDimmed && styles.stopTextDimmed]}>{stop.stop_name}</Text>
                        <Text style={[styles.stopTime, isDimmed && styles.stopTextDimmed]}>
                          {isOrigin
                            ? `Departs ${formatTime(stop.departure_time)}`
                            : isDest
                              ? `Arrives ${formatTime(stop.arrival_time)}`
                              : `${formatTime(stop.arrival_time)} — ${formatTime(stop.departure_time)}`}
                        </Text>
                      </View>

                      <Text style={[styles.stopCode, isDimmed && styles.stopTextDimmed]}>{stop.stop_code}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

  // ============================================================
  // PATH 2a: Station flow (existing, after fromStation is set)
  // ============================================================
  // fromStation is guaranteed non-null here (we returned early above if !fromStation && !selectedTrainNumber)
  const from = fromStation!;
  const showingResults = from && toStation && selectedDate;
  const showingStationSearch = !showingResults && searchQuery.length > 0 && !showDatePicker;
  const showingDatePicker = from && toStation && !selectedDate;

  return (
    <View style={styles.container}>
      {/* Segment row */}
      <View style={styles.segmentRow}>
        {/* From segment */}
        <TouchableOpacity style={styles.segment} onPress={handleClearFrom}>
          <Text style={styles.segmentText}>{from.stop_id}</Text>
        </TouchableOpacity>

        {/* To segment: input or filled */}
        {toStation ? (
          <TouchableOpacity style={styles.segment} onPress={handleClearTo}>
            <Text style={styles.segmentText}>{toStation.stop_id}</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.segment, styles.segmentInput]}>
            <TextInput
              ref={searchInputRef}
              style={styles.segmentTextInput}
              placeholder="Enter arrival station"
              placeholderTextColor={colors.secondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
          </View>
        )}

        {/* Date segment: placeholder when toStation set but no date */}
        {toStation && !selectedDate && (
          <View style={[styles.segment, styles.segmentDatePlaceholder]}>
            <Ionicons name="calendar-outline" size={14} color={colors.secondary} />
            <Text style={[styles.segmentText, { color: colors.secondary }]}>Select date</Text>
          </View>
        )}

        {/* Date segment: filled when date is selected */}
        {selectedDate && (
          <TouchableOpacity style={[styles.segment, styles.segmentDate]} onPress={handleClearDate}>
            <Ionicons name="calendar-outline" size={14} color={colors.primary} />
            <Text style={styles.segmentText}>{formatDateForPill(selectedDate)}</Text>
          </TouchableOpacity>
        )}

      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: (isFullscreen ? 100 : SCREEN_HEIGHT * 0.5) + keyboardHeight }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} scrollEnabled={isFullscreen} waitFor={panRef} bounces={false} onScroll={e => { if (scrollOffset) scrollOffset.value = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
        {/* Station Search Results (for arrival) */}
        {showingStationSearch && (
          <View style={styles.resultsContainer}>
            <Text style={styles.sectionLabel}>SELECT ARRIVAL STATION</Text>
            {!isDataLoaded ? (
              <Text style={styles.noResults}>Loading...</Text>
            ) : stationResults.length === 0 ? (
              <Text style={styles.noResults}>No stations found</Text>
            ) : (
              stationResults.map(station => (
                <TouchableOpacity
                  key={station.stop_id}
                  style={styles.stationItem}
                  onPress={() => handleSelectStation(station)}
                >
                  <View style={styles.stationIcon}>
                    <Ionicons name="location" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.stationInfo}>
                    <Text style={styles.stationName}>{station.stop_name}</Text>
                    <Text style={styles.stationCode}>{station.stop_id}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* Date Picker Section */}
        {showingDatePicker && (
          <View style={styles.datePickerContainer}>
            <Text style={styles.sectionLabel}>SELECT TRAVEL DATE</Text>
            {[
              { label: 'Today', offset: 0 },
              { label: 'Tomorrow', offset: 1 },
            ].map(({ label, offset }) => {
              const d = new Date();
              d.setDate(d.getDate() + offset);
              return (
                <TouchableOpacity key={label} style={styles.stationItem} onPress={() => handleDayPress({ dateString: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, day: d.getDate(), month: d.getMonth()+1, year: d.getFullYear(), timestamp: d.getTime() })}>
                  <View style={styles.stationIcon}>
                    <Ionicons name="calendar-outline" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.stationInfo}>
                    <Text style={styles.stationName}>{label}</Text>
                    <Text style={styles.stationCode}>{formatDateForPill(d)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.secondary} />
                </TouchableOpacity>
              );
            })}
            <View style={styles.datePickerWrapper}>
              <Calendar
                theme={calendarTheme}
                markedDates={calendarMarkedDates}
                onDayPress={handleDayPress}
                hideExtraDays
                enableSwipeMonths
              />
            </View>
          </View>
        )}

        {/* Trip Results */}
        {showingResults && (
          <View style={styles.resultsContainer}>
            <Text style={styles.sectionLabel}>
              {pluralCount(tripResults.length, 'TRAIN')} FOUND
            </Text>
            {tripResults.length === 0 ? (
              <Text style={styles.noResults}>No direct trains between these stations</Text>
            ) : (
              [...tripResults].sort((a, b) => {
                const now = Date.now();
                const getDepMs = (dep: string) => {
                  const [h, m] = dep.split(':').map(Number);
                  const d = new Date(selectedDate);
                  d.setDate(d.getDate() + Math.floor(h / 24));
                  d.setHours(h % 24, m, 0, 0);
                  return d.getTime();
                };
                const aMs = getDepMs(a.fromStop.departure_time);
                const bMs = getDepMs(b.fromStop.departure_time);
                const aFuture = aMs >= now;
                const bFuture = bMs >= now;
                // Future trains first, sorted by soonest departure
                if (aFuture && bFuture) return aMs - bMs;
                if (aFuture && !bFuture) return -1;
                if (!aFuture && bFuture) return 1;
                // Past trains sorted by most recent first (closest to now)
                return bMs - aMs;
              }).map((trip, index) => {
                const { displayName, routeName } = getTrainDisplayName(trip.tripId);
                const isLast = index === tripResults.length - 1;
                const delays = tripDelays.get(trip.tripId);
                const depDelay = delays?.departDelay;
                const countdown = getCountdownFromDeparture(trip.fromStop.departure_time, selectedDate, depDelay);
                const countdownLabel = countdown.unit;
                const depart = convertGtfsTimeForStop(trip.fromStop.departure_time, trip.fromStop.stop_id);
                const arrive = convertGtfsTimeForStop(trip.toStop.arrival_time, trip.toStop.stop_id);
                const arrDelay = delays?.arriveDelay;
                const depDelayed = depDelay && depDelay > 0 ? addDelayToTime(depart.time, depDelay, depart.dayOffset) : undefined;
                const arrDelayed = arrDelay && arrDelay > 0 ? addDelayToTime(arrive.time, arrDelay, arrive.dayOffset) : undefined;
                return (
                  <TouchableOpacity
                    key={trip.tripId}
                    style={styles.tripCard}
                    onPress={() => {
                      hapticSuccess();
                      onSelectTrip(trip.tripId, from.stop_id, toStation.stop_id, selectedDate);
                    }}
                  >
                    <TrainCardContent
                      countdownValue={countdown.value}
                      countdownLabel={countdownLabel}
                      isPast={countdown.past}
                      routeName={routeName || ''}
                      trainNumber={displayName.replace(routeName || '', '').trim()}
                      fromName={from.stop_name}
                      toName={toStation.stop_name}
                      fromCode={from.stop_id}
                      toCode={toStation.stop_id}
                      departTime={depart.time}
                      arriveTime={arrive.time}
                      departDayOffset={depart.dayOffset}
                      arriveDayOffset={arrive.dayOffset}
                      intermediateStopCount={trip.intermediateStops.length}
                      departDelayMinutes={depDelay}
                      departDelayedTime={depDelayed?.time}
                      departDelayedDayOffset={depDelayed?.dayOffset}
                      arriveDelayMinutes={arrDelay}
                      arriveDelayedTime={arrDelayed?.time}
                      arriveDelayedDayOffset={arrDelayed?.dayOffset}
                    />
                    {!isLast && <View style={styles.tripCardSeparator} />}
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        {/* Hint when from is selected but no to search */}
        {!showingStationSearch && !showingResults && !showingDatePicker && searchQuery.length === 0 && !toStation && (
          <View style={styles.hintContainer}>
            <Ionicons name="information-circle-outline" size={20} color={colors.secondary} />
            <Text style={styles.hintText}>Now enter your arrival station</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create(withTextShadow({
  container: {
    flex: 1,
  },
  // Original search bar style (before first station selected)
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.tertiary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.xl,
  },
  fullSearchInput: {
    flex: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    color: colors.primary,
    fontSize: FontSizes.searchLabel,
  },
  // Segment row (after first selection)
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.tertiary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: 6,
  },
  segmentText: {
    color: colors.primary,
    fontSize: FontSizes.searchLabel,
    fontWeight: '600',
    flexShrink: 1,
  },
  segmentInput: {
    flex: 1,
    paddingVertical: 0,
  },
  segmentTextInput: {
    color: colors.primary,
    fontSize: FontSizes.searchLabel,
    flex: 1,
    paddingVertical: Spacing.md,
  },
  segmentDate: {
    flex: 1,
  },
  segmentDatePlaceholder: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border.secondary,
    borderStyle: 'dashed' as const,
  },
  resultsContainer: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: FontSizes.timeLabel,
    color: colors.secondary,
    letterSpacing: 0.5,
    marginBottom: Spacing.md,
    fontWeight: '600',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  noResults: {
    color: colors.secondary,
    fontSize: FontSizes.trainDate,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  stationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  stationIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  stationInfo: {
    flex: 1,
  },
  stationName: {
    fontSize: FontSizes.searchLabel,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 2,
  },
  stationCode: {
    fontSize: FontSizes.daysLabel,
    color: colors.secondary,
  },
  liveIndicator: {
    fontSize: FontSizes.daysLabel,
    color: '#34C759',
    fontWeight: '600',
  },
  liveFilterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.secondary + '40',
  },
  liveFilterBadgeActive: {
    backgroundColor: '#34C75920',
    borderColor: '#34C759',
  },
  liveFilterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.secondary,
  },
  liveFilterDotActive: {
    backgroundColor: '#34C759',
  },
  liveFilterText: {
    fontSize: FontSizes.daysLabel,
    color: colors.secondary,
    fontWeight: '600',
  },
  liveFilterTextActive: {
    color: '#34C759',
  },
  datePickerContainer: {
    flex: 1,
  },
  datePickerWrapper: {
    backgroundColor: colors.background.tertiary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    overflow: 'hidden' as const,
  },
  tripCard: {
  },
  tripCardSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border.primary,
  },
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  hintText: {
    color: colors.secondary,
    fontSize: FontSizes.trainDate,
  },
  // Train-number flow: stop list styles
  stopItem: {
    position: 'relative' as const,
  },
  stopItemDimmed: {
    opacity: 0.4,
  },
  stopConnectorTop: {
    position: 'absolute' as const,
    left: Spacing.md + 11, // paddingHorizontal + half of marker width
    top: 0,
    width: 2,
    height: 12,
    backgroundColor: colors.border.secondary,
  },
  stopConnectorBottom: {
    position: 'absolute' as const,
    left: Spacing.md + 11,
    top: 12 + 24, // top connector height + marker height area
    bottom: 0,
    width: 2,
    backgroundColor: colors.border.secondary,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  stopMarker: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.secondary,
    backgroundColor: 'transparent',
  },
  stopDotSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  stopInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  stopName: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '500',
    marginBottom: 2,
  },
  stopTime: {
    fontSize: FontSizes.daysLabel,
    color: colors.secondary,
  },
  stopCode: {
    fontSize: FontSizes.daysLabel,
    color: colors.secondary,
    fontWeight: '500',
    marginTop: 4,
  },
  stopTextDimmed: {
    color: colors.secondary,
    opacity: 0.6,
  },
}, colors.textShadow));
