import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { AppColors, BorderRadius, FontSizes, Spacing } from '../constants/theme';
import { light as hapticLight, selection as hapticSelection, success as hapticSuccess } from '../utils/haptics';
import { getTrainDisplayName } from '../services/api';
import type { EnrichedStopTime, Route, SearchResult, Stop, Trip } from '../types/train';
import { gtfsParser } from '../utils/gtfs-parser';

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
import { formatTime } from '../utils/time-formatting';

const formatDateForPill = formatDateForDisplay;

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
}

export function TwoStationSearch({ onSelectTrip, onClose }: TwoStationSearchProps) {
  // --- Shared state ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [tempDate, setTempDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(gtfsParser.isLoaded);
  const searchInputRef = useRef<TextInput>(null);

  // --- Station flow state (Path 2a) ---
  const [fromStation, setFromStation] = useState<Stop | null>(null);
  const [toStation, setToStation] = useState<Stop | null>(null);
  const [stationResults, setStationResults] = useState<Stop[]>([]);
  const [tripResults, setTripResults] = useState<TripResult[]>([]);
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
    } else if (!fromStation && !selectedTrainNumber) {
      // Initial view: unified search
      const results = gtfsParser.searchUnified(searchQuery);
      setUnifiedResults(results);
    }
  }, [searchQuery, isDataLoaded, fromStation, toStation, selectedTrainNumber]);

  // Find trips when both stations AND date are selected (station flow)
  useEffect(() => {
    if (fromStation && toStation && selectedDate) {
      const trips = gtfsParser.findTripsWithStops(fromStation.stop_id, toStation.stop_id, selectedDate);
      setTripResults(trips);
    } else {
      setTripResults([]);
    }
  }, [fromStation, toStation, selectedDate]);

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
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const handleDateChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (date) {
        setSelectedDate(date);
      }
    } else {
      if (date) {
        setTempDate(date);
      }
    }
  };

  const handleSelectTrain = (trainNumber: string, displayName: string) => {
    hapticSelection();
    setSelectedTrainNumber(trainNumber);
    setSelectedTrainName(displayName);
    setSearchQuery('');
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
    unifiedResults.trains.length > 0 ||
    unifiedResults.routes.length > 0 ||
    unifiedResults.stations.length > 0;

  // ============================================================
  // PATH 1: Initial unified search (no station, no train selected)
  // ============================================================
  if (!fromStation && !selectedTrainNumber) {
    const showingSearch = searchQuery.length > 0 && !showDatePicker;

    return (
      <View style={styles.container}>
        {/* Search bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={AppColors.secondary} />
          <TextInput
            ref={searchInputRef}
            style={styles.fullSearchInput}
            placeholder="Train number, route, or station"
            placeholderTextColor={AppColors.secondary}
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              setExpandedRouteTrains(null);
              setExpandedRouteName('');
            }}
            autoFocus
          />
          <TouchableOpacity onPress={() => { hapticLight(); onClose(); }}>
            <Ionicons name="close-circle" size={20} color={AppColors.secondary} />
          </TouchableOpacity>
        </View>

        {/* Results */}
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Expanded route train list */}
          {expandedRouteTrains && (
            <View style={styles.resultsContainer}>
              <View style={styles.sectionHeaderRow}>
                <TouchableOpacity onPress={() => { hapticLight(); setExpandedRouteTrains(null); setExpandedRouteName(''); }}>
                  <Ionicons name="arrow-back" size={18} color={AppColors.secondary} />
                </TouchableOpacity>
                <Text style={styles.sectionLabel}>{expandedRouteName.toUpperCase()} TRAINS</Text>
              </View>
              {expandedRouteTrains.map(train => {
                const isAcela = train.displayName.toLowerCase().includes('acela');
                return (
                <TouchableOpacity
                  key={train.trainNumber}
                  style={styles.stationItem}
                  onPress={() => handleSelectTrain(train.trainNumber, train.displayName)}
                >
                  <View style={styles.stationIcon}>
                    {isAcela ? (
                      <Ionicons name="train" size={20} color={AppColors.primary} />
                    ) : (
                      <FontAwesome6 name="train" size={16} color={AppColors.primary} />
                    )}
                  </View>
                  <View style={styles.stationInfo}>
                    <Text style={styles.stationName}>{train.displayName}</Text>
                    {train.headsign ? <Text style={styles.stationCode}>{train.headsign}</Text> : null}
                  </View>
                </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Unified search results */}
          {showingSearch && !expandedRouteTrains && (
            <View style={styles.resultsContainer}>
              {!isDataLoaded ? (
                <Text style={styles.noResults}>Loading station data...</Text>
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
                              <Ionicons name="location" size={20} color={AppColors.primary} />
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
                      <Text style={[styles.sectionLabel, unifiedResults.stations.length > 0 && { marginTop: Spacing.lg }]}>ROUTES</Text>
                      {unifiedResults.routes.map(result => {
                        const route = result.data as Route;
                        return (
                          <TouchableOpacity
                            key={result.id}
                            style={styles.stationItem}
                            onPress={() => handleSelectRoute(route)}
                          >
                            <View style={styles.stationIcon}>
                              <Ionicons name="git-branch-outline" size={20} color={AppColors.primary} />
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
                      <Text style={[styles.sectionLabel, (unifiedResults.stations.length > 0 || unifiedResults.routes.length > 0) && { marginTop: Spacing.lg }]}>TRAINS</Text>
                      {unifiedResults.trains.map(result => {
                        const trip = result.data as Trip;
                        const isAcela = result.name.toLowerCase().includes('acela');
                        return (
                          <TouchableOpacity
                            key={result.id}
                            style={styles.stationItem}
                            onPress={() => handleSelectTrain(trip.trip_short_name || '', result.name)}
                          >
                            <View style={styles.stationIcon}>
                              {isAcela ? (
                                <Ionicons name="train" size={20} color={AppColors.primary} />
                              ) : (
                                <FontAwesome6 name="train" size={16} color={AppColors.primary} />
                              )}
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
        </ScrollView>
      </View>
    );
  }

  // ============================================================
  // PATH 2b: Train-number flow
  // ============================================================
  if (selectedTrainNumber) {
    const showingTrainDatePicker = !selectedDate;
    const showingStopList = resolvedTripId && trainStops.length > 0;

    return (
      <View style={styles.container}>
        {/* Train pill bar */}
        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.stationPill} onPress={handleClearTrain}>
            <FontAwesome6 name="train" size={12} color={AppColors.primary} />
            <Text style={styles.stationPillText}>{selectedTrainName || `Train ${selectedTrainNumber}`}</Text>
            <Ionicons name="close" size={14} color={AppColors.primary} />
          </TouchableOpacity>

          {/* Date Pill (after date is selected) */}
          {selectedDate && (
            <>
              <View style={styles.dateSeparator} />
              <TouchableOpacity style={styles.datePill} onPress={handleClearDate}>
                <Ionicons name="calendar-outline" size={14} color={AppColors.primary} />
                <Text style={styles.datePillText}>{formatDateForPill(selectedDate)}</Text>
                <Ionicons name="close" size={14} color={AppColors.primary} />
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close-circle" size={20} color={AppColors.secondary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Date picker */}
          {showingTrainDatePicker && (
            <View style={styles.datePickerContainer}>
              <Text style={styles.sectionLabel}>SELECT TRAVEL DATE</Text>
              <View style={styles.datePickerWrapper}>
                <DateTimePicker
                  value={tempDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={handleDateChange}
                  minimumDate={new Date()}
                  themeVariant="dark"
                  accentColor="#FFFFFF"
                  style={styles.datePicker}
                />
              </View>
              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  style={styles.confirmDateButton}
                  onPress={() => {
                    hapticSuccess();
                    setSelectedDate(tempDate);
                    setShowDatePicker(false);
                  }}
                >
                  <Text style={styles.confirmDateText}>Confirm Date</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Train doesn't run message */}
          {trainNotRunning && selectedDate && (
            <View style={styles.hintContainer}>
              <Ionicons name="alert-circle-outline" size={20} color={AppColors.error} />
              <Text style={[styles.hintText, { color: AppColors.error }]}>
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
                const isFrom = selectedFromStop?.stop_id === stop.stop_id && selectedFromStop?.stop_sequence === stop.stop_sequence;
                const isDimmed = selectedFromStop && !isFrom && isBeforeFrom;
                const isOrigin = index === 0;
                const isDest = index === trainStops.length - 1;

                return (
                  <TouchableOpacity
                    key={`${stop.stop_id}-${stop.stop_sequence}`}
                    style={[
                      styles.stopItem,
                      isDimmed && styles.stopItemDimmed,
                    ]}
                    onPress={() => handleSelectTrainStop(stop)}
                  >
                    {/* Absolute-positioned connector lines */}
                    {!isOrigin && (
                      <View style={styles.stopConnectorTop} />
                    )}
                    {!isDest && (
                      <View style={styles.stopConnectorBottom} />
                    )}

                    {/* Stop row content */}
                    <View style={styles.stopRow}>
                      <View style={styles.stopMarker}>
                        <View style={[
                          styles.stopDot,
                          isFrom && styles.stopDotSelected,
                        ]} />
                      </View>

                      <View style={styles.stopInfo}>
                        <Text style={[
                          styles.stopName,
                          isDimmed && styles.stopTextDimmed,
                        ]}>
                          {stop.stop_name}
                        </Text>
                        <Text style={[
                          styles.stopTime,
                          isDimmed && styles.stopTextDimmed,
                        ]}>
                          {isOrigin
                            ? `Departs ${formatTime(stop.departure_time)}`
                            : isDest
                              ? `Arrives ${formatTime(stop.arrival_time)}`
                              : `${formatTime(stop.arrival_time)} — ${formatTime(stop.departure_time)}`
                          }
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
      {/* Split Station Input Row */}
      <View style={styles.inputRow}>
        <TouchableOpacity style={styles.stationPill} onPress={handleClearFrom}>
          <Text style={styles.stationPillText}>{from.stop_id}</Text>
          <Ionicons name="close" size={14} color={AppColors.primary} />
        </TouchableOpacity>

        <Ionicons name="arrow-forward" size={16} color={AppColors.secondary} style={styles.arrow} />

        {toStation ? (
          <TouchableOpacity style={styles.stationPill} onPress={handleClearTo}>
            <Text style={styles.stationPillText}>{toStation.stop_id}</Text>
            <Ionicons name="close" size={14} color={AppColors.primary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.activeInputContainer}>
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder="Arrival station"
              placeholderTextColor={AppColors.secondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
          </View>
        )}

        {selectedDate && (
          <>
            <View style={styles.dateSeparator} />
            <TouchableOpacity style={styles.datePill} onPress={handleClearDate}>
              <Ionicons name="calendar-outline" size={14} color={AppColors.primary} />
              <Text style={styles.datePillText}>{formatDateForPill(selectedDate)}</Text>
              <Ionicons name="close" size={14} color={AppColors.primary} />
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close-circle" size={20} color={AppColors.secondary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Station Search Results (for arrival) */}
        {showingStationSearch && (
          <View style={styles.resultsContainer}>
            <Text style={styles.sectionLabel}>SELECT ARRIVAL STATION</Text>
            {!isDataLoaded ? (
              <Text style={styles.noResults}>Loading station data...</Text>
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
                    <Ionicons name="location" size={20} color={AppColors.primary} />
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
            <View style={styles.datePickerWrapper}>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={handleDateChange}
                minimumDate={new Date()}
                themeVariant="dark"
                accentColor="#FFFFFF"
                style={styles.datePicker}
              />
            </View>
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={styles.confirmDateButton}
                onPress={() => {
                  hapticSuccess();
                  setSelectedDate(tempDate);
                  setShowDatePicker(false);
                }}
              >
                <Text style={styles.confirmDateText}>Confirm Date</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Trip Results */}
        {showingResults && (
          <View style={styles.resultsContainer}>
            <Text style={styles.sectionLabel}>
              {tripResults.length} TRAIN{tripResults.length !== 1 ? 'S' : ''} FOUND
            </Text>
            {tripResults.length === 0 ? (
              <Text style={styles.noResults}>No direct trains between these stations</Text>
            ) : (
              tripResults.map(trip => {
                const { displayName, routeName } = getTrainDisplayName(trip.tripId);
                const isAcela = routeName?.toLowerCase().includes('acela');
                return (
                  <TouchableOpacity
                    key={trip.tripId}
                    style={styles.tripItem}
                    onPress={() => { hapticSuccess(); onSelectTrip(trip.tripId, from.stop_id, toStation.stop_id, selectedDate); }}
                  >
                    <View style={styles.tripIcon}>
                      {isAcela ? (
                        <Ionicons name="train" size={20} color={AppColors.primary} />
                      ) : (
                        <FontAwesome6 name="train" size={16} color={AppColors.primary} />
                      )}
                    </View>
                    <View style={styles.tripInfo}>
                      <Text style={styles.tripName}>{displayName}</Text>
                      <View style={styles.tripTimes}>
                        <Text style={styles.tripTime}>{formatTime(trip.fromStop.departure_time)}</Text>
                        <Ionicons name="arrow-forward" size={12} color={AppColors.secondary} />
                        <Text style={styles.tripTime}>{formatTime(trip.toStop.arrival_time)}</Text>
                      </View>
                      {trip.intermediateStops.length > 0 && (
                        <Text style={styles.tripStops}>
                          {trip.intermediateStops.length} stop{trip.intermediateStops.length !== 1 ? 's' : ''}
                        </Text>
                      )}
                    </View>
                    <Ionicons name="add" size={24} color={AppColors.primary} />
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        {/* Hint when from is selected but no to search */}
        {!showingStationSearch && !showingResults && !showingDatePicker && searchQuery.length === 0 && !toStation && (
          <View style={styles.hintContainer}>
            <Ionicons name="information-circle-outline" size={20} color={AppColors.secondary} />
            <Text style={styles.hintText}>Now enter your arrival station</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Original search bar style (before first station selected)
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AppColors.background.tertiary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.xl,
  },
  fullSearchInput: {
    flex: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    color: AppColors.primary,
    fontSize: FontSizes.searchLabel,
  },
  // Split input row (after first station selected)
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AppColors.background.tertiary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  stationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AppColors.background.primary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: AppColors.border.primary,
    gap: 4,
  },
  stationPillText: {
    color: AppColors.primary,
    fontSize: FontSizes.searchLabel,
    fontWeight: '600',
  },
  dateSeparator: {
    width: 1,
    height: 20,
    backgroundColor: AppColors.border.secondary,
    marginHorizontal: 4,
  },
  datePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AppColors.background.tertiary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: 1,
    borderColor: AppColors.primary,
    gap: 4,
  },
  datePillText: {
    color: AppColors.primary,
    fontSize: FontSizes.searchLabel,
    fontWeight: '600',
  },
  activeInputContainer: {
    flex: 1,
  },
  searchInput: {
    color: AppColors.primary,
    fontSize: FontSizes.searchLabel,
    paddingVertical: Spacing.xs,
  },
  arrow: {
    marginHorizontal: 2,
  },
  closeButton: {
    marginLeft: 'auto',
    padding: 4,
  },
  resultsContainer: {
    flex: 1,
  },
  sectionLabel: {
    fontSize: FontSizes.timeLabel,
    color: AppColors.secondary,
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
    color: AppColors.secondary,
    fontSize: FontSizes.flightDate,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  stationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AppColors.background.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: AppColors.border.primary,
  },
  stationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: AppColors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  stationInfo: {
    flex: 1,
  },
  stationName: {
    fontSize: FontSizes.searchLabel,
    color: AppColors.primary,
    fontWeight: '600',
    marginBottom: 2,
  },
  stationCode: {
    fontSize: FontSizes.daysLabel,
    color: AppColors.secondary,
  },
  datePickerContainer: {
    flex: 1,
  },
  datePickerWrapper: {
    backgroundColor: AppColors.background.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: AppColors.border.primary,
    alignItems: 'center',
  },
  datePicker: {
    width: '100%',
  },
  confirmDateButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    marginTop: Spacing.md,
    alignItems: 'center',
  },
  confirmDateText: {
    color: '#000000',
    fontSize: FontSizes.searchLabel,
    fontWeight: '600',
  },
  tripItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AppColors.background.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: AppColors.border.primary,
  },
  tripIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: AppColors.background.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  tripInfo: {
    flex: 1,
  },
  tripName: {
    fontSize: FontSizes.searchLabel,
    color: AppColors.primary,
    fontWeight: '600',
    marginBottom: 4,
  },
  tripTimes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tripTime: {
    fontSize: FontSizes.daysLabel,
    color: AppColors.secondary,
    fontWeight: '500',
  },
  tripStops: {
    fontSize: FontSizes.daysLabel,
    color: AppColors.secondary,
    marginTop: 2,
  },
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  hintText: {
    color: AppColors.secondary,
    fontSize: FontSizes.flightDate,
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
    backgroundColor: AppColors.border.secondary,
  },
  stopConnectorBottom: {
    position: 'absolute' as const,
    left: Spacing.md + 11,
    top: 12 + 24, // top connector height + marker height area
    bottom: 0,
    width: 2,
    backgroundColor: AppColors.border.secondary,
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
    borderColor: AppColors.secondary,
    backgroundColor: 'transparent',
  },
  stopDotSelected: {
    backgroundColor: AppColors.primary,
    borderColor: AppColors.primary,
  },
  stopInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  stopName: {
    fontSize: 15,
    color: AppColors.primary,
    fontWeight: '500',
    marginBottom: 2,
  },
  stopTime: {
    fontSize: FontSizes.daysLabel,
    color: AppColors.secondary,
  },
  stopCode: {
    fontSize: FontSizes.daysLabel,
    color: AppColors.secondary,
    fontWeight: '500',
    marginTop: 4,
  },
  stopTextDimmed: {
    color: AppColors.secondary,
    opacity: 0.6,
  },
});
