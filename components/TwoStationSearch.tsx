import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { AppColors, BorderRadius, FontSizes, Spacing } from '../constants/theme';
import { getTrainDisplayName } from '../services/api';
import type { EnrichedStopTime, Stop } from '../types/train';
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

// Use imported utilities
const formatDateForPill = formatDateForDisplay;

export function TwoStationSearch({ onSelectTrip, onClose }: TwoStationSearchProps) {
  const [fromStation, setFromStation] = useState<Stop | null>(null);
  const [toStation, setToStation] = useState<Stop | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [tempDate, setTempDate] = useState<Date>(new Date()); // Temp date for picker before confirmation
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stationResults, setStationResults] = useState<Stop[]>([]);
  const [tripResults, setTripResults] = useState<TripResult[]>([]);
  const [activeField, setActiveField] = useState<'from' | 'to'>('from');
  const [isDataLoaded, setIsDataLoaded] = useState(gtfsParser.isLoaded);
  const searchInputRef = useRef<TextInput>(null);

  // Check if GTFS data is loaded
  useEffect(() => {
    const checkLoaded = () => {
      if (gtfsParser.isLoaded && !isDataLoaded) {
        setIsDataLoaded(true);
      }
    };
    // Check immediately and then poll briefly in case data loads async
    checkLoaded();
    const interval = setInterval(checkLoaded, 500);
    return () => clearInterval(interval);
  }, [isDataLoaded]);

  // Search stations when query changes
  useEffect(() => {
    if (searchQuery.length > 0 && isDataLoaded) {
      const results = gtfsParser.searchStations(searchQuery);
      setStationResults(results);
    } else {
      setStationResults([]);
    }
  }, [searchQuery, isDataLoaded]);

  // Find trips when both stations AND date are selected
  useEffect(() => {
    if (fromStation && toStation && selectedDate) {
      const trips = gtfsParser.findTripsWithStops(fromStation.stop_id, toStation.stop_id, selectedDate);
      setTripResults(trips);
    } else {
      setTripResults([]);
    }
  }, [fromStation, toStation, selectedDate]);

  // Show date picker when both stations are selected but no date yet
  useEffect(() => {
    if (fromStation && toStation && !selectedDate) {
      setShowDatePicker(true);
    }
  }, [fromStation, toStation, selectedDate]);

  const handleSelectStation = (station: Stop) => {
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
    setFromStation(null);
    setToStation(null);
    setSelectedDate(null);
    setTripResults([]);
    setActiveField('from');
    setSearchQuery('');
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const handleClearTo = () => {
    setToStation(null);
    setSelectedDate(null);
    setTripResults([]);
    setActiveField('to');
    setSearchQuery('');
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const handleClearDate = () => {
    setSelectedDate(null);
    setTripResults([]);
    setShowDatePicker(true);
  };

  const handleDateChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      // On Android, the picker dismisses automatically on selection
      setShowDatePicker(false);
      if (date) {
        setSelectedDate(date);
      }
    } else {
      // On iOS, just update temp date - user must press confirm button
      if (date) {
        setTempDate(date);
      }
    }
  };

  const showingResults = fromStation && toStation && selectedDate;
  const showingStationSearch = !showingResults && searchQuery.length > 0 && !showDatePicker;
  const showingDatePicker = fromStation && toStation && !selectedDate;

  // Before first station is selected - show original search bar style
  if (!fromStation) {
    return (
      <View style={styles.container}>
        {/* Original style search bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={20} color={AppColors.secondary} />
          <TextInput
            ref={searchInputRef}
            style={styles.fullSearchInput}
            placeholder="Train name, station name/code, or route"
            placeholderTextColor={AppColors.secondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close-circle" size={20} color={AppColors.secondary} />
          </TouchableOpacity>
        </View>

        {/* Station Search Results */}
        {showingStationSearch && (
          <View style={styles.resultsContainer}>
            <Text style={styles.sectionLabel}>SELECT DEPARTURE STATION</Text>
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
      </View>
    );
  }

  // After first station is selected - show split view with pills
  return (
    <View style={styles.container}>
      {/* Split Station Input Row */}
      <View style={styles.inputRow}>
        {/* From Station Pill */}
        <TouchableOpacity style={styles.stationPill} onPress={handleClearFrom}>
          <Text style={styles.stationPillText}>{fromStation.stop_id}</Text>
          <Ionicons name="close" size={14} color={AppColors.primary} />
        </TouchableOpacity>

        {/* Arrow between stations */}
        <Ionicons name="arrow-forward" size={16} color={AppColors.secondary} style={styles.arrow} />

        {/* To Station Pill/Input */}
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

        {/* Close button */}
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close-circle" size={20} color={AppColors.secondary} />
        </TouchableOpacity>
      </View>

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
                  onPress={() => onSelectTrip(trip.tripId, fromStation.stop_id, toStation.stop_id, selectedDate)}
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
});
