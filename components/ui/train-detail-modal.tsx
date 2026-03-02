import React from 'react';
import { ActivityIndicator, Dimensions, Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppColors, Spacing } from '../../constants/theme';
import { formatTimeWithDayOffset, timeToMinutes } from '../../utils/time-formatting';

import { useTrainContext } from '../../context/TrainContext';
import { useUnits } from '../../context/UnitsContext';
import { TrainStorageService } from '../../services/storage';
import type { Train } from '../../types/train';
import { haversineDistance } from '../../utils/distance';
import { gtfsParser } from '../../utils/gtfs-parser';
import { logger } from '../../utils/logger';
import { calculateDuration, getCountdownForTrain, pluralize } from '../../utils/train-display';
import { convertDistance, distanceSuffix, formatTemp, weatherApiTempUnit } from '../../utils/units';
import { getWeatherCondition } from '../../utils/weather';
import { SlideUpModalContext } from './slide-up-modal';
import TimeDisplay from './TimeDisplay';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const COLORS = AppColors;
const FONTS = {
  family: 'System',
};

interface TrainDetailModalProps {
  train?: Train;
  onClose: () => void;
  onStationSelect?: (stationCode: string, lat: number, lon: number) => void;
  onTrainSelect?: (train: Train) => void;
}

const formatTime24to12 = formatTimeWithDayOffset;

interface WeatherData {
  temperature: number;
  condition: string;
  icon: string;
}

interface StopInfo {
  time: string;
  dayOffset: number;
  name: string;
  code: string;
}

export default function TrainDetailModal({ train, onClose, onStationSelect, onTrainSelect }: TrainDetailModalProps) {
  const { selectedTrain } = useTrainContext();
  const { tempUnit, distanceUnit } = useUnits();
  const trainData = train || selectedTrain;
  
  const [allStops, setAllStops] = React.useState<StopInfo[]>([]);
  const [isWhereIsMyTrainExpanded, setIsWhereIsMyTrainExpanded] = React.useState(false);
  const [isHeaderExpanded, setIsHeaderExpanded] = React.useState(false);
  const [weatherData, setWeatherData] = React.useState<WeatherData | null>(null);
  const [isLoadingWeather, setIsLoadingWeather] = React.useState(false);
  const [routeHistory, setRouteHistory] = React.useState<{ trips: number; distance: number; duration: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [stopWeather, setStopWeather] = React.useState<Record<string, { temp: number; icon: string }>>({});
  const stopWeatherKeyRef = React.useRef<string | null>(null);

  const isLiveTrain = trainData?.realtime?.position !== undefined;

  // Load stops from GTFS
  React.useEffect(() => {
    if (!trainData?.tripId) return;
    
    try {
      const stops = gtfsParser.getStopTimesForTrip(trainData.tripId);
      if (stops && stops.length > 0) {
        const formattedStops = stops.map(stop => {
          const formatted = stop.departure_time ? formatTime24to12(stop.departure_time) : { time: '', dayOffset: 0 };
          return {
            time: formatted.time,
            dayOffset: formatted.dayOffset,
            name: stop.stop_name,
            code: stop.stop_id,
          };
        });
        setAllStops(formattedStops);
      }
    } catch (e) {
      logger.error('Failed to load stops:', e);
    }
  }, [trainData]);

  // Fetch weather data for destination
  React.useEffect(() => {
    const fetchWeather = async () => {
      if (!trainData) return;
      
      try {
        setIsLoadingWeather(true);
        const destStop = gtfsParser.getStop(trainData.toCode);
        if (!destStop) return;

        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${destStop.stop_lat}&longitude=${destStop.stop_lon}&current=temperature_2m,weather_code&temperature_unit=${weatherApiTempUnit(tempUnit)}&timezone=auto`;
        const response = await fetch(weatherUrl);

        if (response.ok) {
          const data = await response.json();
          const weatherCode = data.current?.weather_code || 0;
          const weatherInfo = getWeatherCondition(weatherCode);
          setWeatherData({
            temperature: Math.round(data.current?.temperature_2m || 0),
            condition: weatherInfo.condition,
            icon: weatherInfo.icon,
          });
        }
      } catch (e) {
        logger.error('Failed to fetch weather:', e);
      } finally {
        setIsLoadingWeather(false);
      }
    };

    fetchWeather();
  }, [trainData, tempUnit]);

  // Fetch hourly weather for each stop when "Where's My Train?" is expanded
  React.useEffect(() => {
    if (!isWhereIsMyTrainExpanded || allStops.length === 0 || !trainData) return;

    const key = `${trainData.tripId}-${allStops.length}-${tempUnit}`;
    if (stopWeatherKeyRef.current === key) return;
    stopWeatherKeyRef.current = key;

    let cancelled = false;

    const fetchAllStopWeather = async () => {
      const unit = weatherApiTempUnit(tempUnit);
      const today = new Date();
      const baseDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const results: Record<string, { temp: number; icon: string }> = {};

      const promises = allStops.map(async (stop) => {
        try {
          const stopData = gtfsParser.getStop(stop.code);
          if (!stopData) return;

          const targetDate = new Date(baseDate);
          targetDate.setDate(targetDate.getDate() + stop.dayOffset);
          const dateStr = targetDate.toISOString().slice(0, 10);
          const hour = Math.min(Math.floor(timeToMinutes(stop.time) / 60), 23);

          const url = `https://api.open-meteo.com/v1/forecast?latitude=${stopData.stop_lat}&longitude=${stopData.stop_lon}&hourly=temperature_2m,weather_code&temperature_unit=${unit}&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`;
          const res = await fetch(url);
          if (!res.ok || cancelled) return;
          const data = await res.json();

          const temp = data.hourly?.temperature_2m?.[hour];
          const code = data.hourly?.weather_code?.[hour];
          if (temp != null && code != null) {
            const info = getWeatherCondition(code);
            results[stop.code] = { temp: Math.round(temp), icon: info.icon };
          }
        } catch {
          // silently fail per stop
        }
      });

      await Promise.all(promises);
      if (!cancelled) setStopWeather(results);
    };

    fetchAllStopWeather();
    return () => { cancelled = true; };
  }, [isWhereIsMyTrainExpanded, allStops, trainData, tempUnit]);

  // Fetch route history stats
  React.useEffect(() => {
    const fetchRouteHistory = async () => {
      if (!trainData) return;
      
      try {
        const history = await TrainStorageService.getTripHistory();
        const matchingTrips = history.filter(
          trip => trip.fromCode === trainData.fromCode && trip.toCode === trainData.toCode
        );
        
        const totalDistance = matchingTrips.reduce((sum, trip) => sum + (trip.distance || 0), 0);
        const totalDuration = matchingTrips.reduce((sum, trip) => sum + (trip.duration || 0), 0);
        
        setRouteHistory({
          trips: matchingTrips.length,
          distance: Math.round(totalDistance),
          duration: Math.round(totalDuration),
        });
      } catch (e) {
        logger.error('Failed to fetch route history:', e);
        setRouteHistory(null);
      }
    };

    fetchRouteHistory();
  }, [trainData]);

  // Fetch weather for each stop when "Where's My Train?" is expanded
  React.useEffect(() => {
    if (!isWhereIsMyTrainExpanded || !trainData?.tripId) return;

    const cacheKey = `${trainData.tripId}-${tempUnit}`;
    if (stopWeatherKeyRef.current === cacheKey) return;
    stopWeatherKeyRef.current = cacheKey;

    let cancelled = false;

    const fetchStopWeather = async () => {
      try {
        const stops = gtfsParser.getStopTimesForTrip(trainData.tripId);
        if (!stops || stops.length === 0) return;

        const unit = weatherApiTempUnit(tempUnit);
        const baseDate = new Date();
        const results: Record<string, { temp: number; icon: string }> = {};

        await Promise.all(
          stops.map(async (stop) => {
            try {
              const stopData = gtfsParser.getStop(stop.stop_id);
              if (!stopData) return;

              const time = stop.departure_time || stop.arrival_time;
              const timeParts = time?.split(':');
              if (!timeParts) return;
              let hour = parseInt(timeParts[0]);
              const dayOff = Math.floor(hour / 24);
              hour = hour % 24;

              const stopDate = new Date(baseDate);
              stopDate.setDate(stopDate.getDate() + dayOff);
              const dateStr = stopDate.toISOString().slice(0, 10);

              const url = `https://api.open-meteo.com/v1/forecast?latitude=${stopData.stop_lat}&longitude=${stopData.stop_lon}&hourly=temperature_2m,weather_code&start_date=${dateStr}&end_date=${dateStr}&temperature_unit=${unit}&timezone=auto`;

              const res = await fetch(url);
              if (!res.ok || cancelled) return;
              const data = await res.json();

              const hourIndex = Math.min(hour, (data.hourly?.temperature_2m?.length || 1) - 1);
              const temp = data.hourly?.temperature_2m?.[hourIndex];
              const code = data.hourly?.weather_code?.[hourIndex] ?? 0;

              if (temp != null) {
                const info = getWeatherCondition(code);
                results[stop.stop_id] = {
                  temp: Math.round(temp),
                  icon: info.icon,
                };
              }
            } catch {
              // skip individual stop
            }
          })
        );

        if (!cancelled) {
          setStopWeather(results);
        }
      } catch {
        // silently fail — weather is non-critical
      }
    };

    fetchStopWeather();
    return () => { cancelled = true; };
  }, [isWhereIsMyTrainExpanded, trainData?.tripId, tempUnit]);

  // Get timezone info for origin and destination
  const timezoneInfo = React.useMemo(() => {
    if (!trainData || allStops.length === 0) return null;
    
    try {
      const originStop = gtfsParser.getStop(trainData.fromCode);
      const destStop = gtfsParser.getStop(trainData.toCode);
      
      const originTz = originStop?.stop_timezone;
      const destTz = destStop?.stop_timezone;
      
      if (originTz && destTz && originTz !== destTz) {
        // Calculate timezone offset difference
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', { 
          timeZone: originTz, 
          timeZoneName: 'shortOffset' 
        });
        const originOffset = formatter.formatToParts(now).find(p => p.type === 'timeZoneName')?.value;
        
        const formatter2 = new Intl.DateTimeFormat('en-US', { 
          timeZone: destTz, 
          timeZoneName: 'shortOffset' 
        });
        const destOffset = formatter2.formatToParts(now).find(p => p.type === 'timeZoneName')?.value;
        
        // Parse offsets like "GMT-5" to get the hour difference
        let hourDiff = 0;
        if (originOffset && destOffset) {
          const parseOffset = (offset: string) => {
            const match = offset.match(/GMT([+-]\d+)/);
            return match ? parseInt(match[1]) : 0;
          };
          const originHours = parseOffset(originOffset);
          const destHours = parseOffset(destOffset);
          hourDiff = destHours - originHours;
        }
        
        const sign = hourDiff > 0 ? '+' : '';
        return {
          hasChange: true,
          message: `${sign}${hourDiff} hour${Math.abs(hourDiff) !== 1 ? 's' : ''} between stations`,
        };
      }
      
      return {
        hasChange: false,
        message: 'Both stations are in the same timezone',
      };
    } catch (e) {
      return null;
    }
  }, [trainData, allStops]);

  const { isCollapsed, isFullscreen, scrollOffset, contentOpacity, panRef } = React.useContext(SlideUpModalContext);
  const [isScrolled, setIsScrolled] = React.useState(false);

  const fadeAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: contentOpacity.value,
    };
  });

  const isHalfHeight = !isCollapsed && !isFullscreen;
  const duration = trainData ? calculateDuration(trainData.departTime, trainData.arriveTime) : '';

  let distanceMiles: number | null = null;
  if (trainData) {
    try {
      const fromStop = gtfsParser.getStop(trainData.fromCode);
      const toStop = gtfsParser.getStop(trainData.toCode);
      if (fromStop && toStop) {
        distanceMiles = haversineDistance(fromStop.stop_lat, fromStop.stop_lon, toStop.stop_lat, toStop.stop_lon);
      }
    } catch {}
  }

  const countdown = trainData ? getCountdownForTrain(trainData) : null;
  const unitLabel = countdown ? `${countdown.unit}${countdown.past ? ' AGO' : ''}` : '';

  const handleStationPress = (stationCode: string) => {
    if (!onStationSelect) return;
    try {
      const stop = gtfsParser.getStop(stationCode);
      if (stop) {
        onStationSelect(stationCode, stop.stop_lat, stop.stop_lon);
      }
    } catch (e) {
      logger.error('Failed to get station coordinates:', e);
    }
  };

  // Find next stop for live trains
  const nextStopIndex = React.useMemo(() => {
    if (!isLiveTrain || allStops.length === 0) return -1;
    
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (let i = 0; i < allStops.length; i++) {
      const stopMinutes = timeToMinutes(allStops[i].time);
      const adjustedStopMinutes = stopMinutes + allStops[i].dayOffset * 24 * 60;
      if (adjustedStopMinutes > currentMinutes) {
        return i;
      }
    }
    return -1;
  }, [isLiveTrain, allStops]);

  if (!trainData) {
    return (
      <View style={styles.modalContent}>
        <View style={[styles.header]}>
          <View style={styles.headerContent} />
          <TouchableOpacity onPress={onClose} style={styles.absoluteCloseButton} activeOpacity={0.6}>
            <Ionicons name="close" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.modalContent}>
      {/* Header */}
      <View style={[styles.header, isScrolled && styles.headerScrolled]}>
        <View style={styles.headerContent}>
          <Image source={require('../../assets/images/amtrak.png')} style={styles.headerLogo} fadeDuration={0} />
          <View style={styles.headerTextContainer}>
            <View style={styles.headerTop}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {trainData.routeName || trainData.operator} {trainData.trainNumber} • {trainData.date}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => !isCollapsed && setIsHeaderExpanded(!isHeaderExpanded)}
              activeOpacity={isCollapsed ? 1 : 0.7}
            >
              {isHeaderExpanded ? (
                <>
                  <Text style={styles.routeTitle}>{trainData.from}</Text>
                  <Text style={styles.routeTitle}>to {trainData.to}</Text>
                </>
              ) : (
                <Text style={styles.routeTitle} numberOfLines={1}>
                  {trainData.fromCode} to {trainData.toCode}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.absoluteCloseButton} activeOpacity={0.6}>
          <Ionicons name="close" size={24} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <Animated.View style={[{ flex: 1 }, fadeAnimatedStyle]} pointerEvents={isCollapsed ? 'none' : 'auto'}>
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: isHalfHeight ? SCREEN_HEIGHT * 0.5 : 100 }}
          showsVerticalScrollIndicator={true}
          scrollEnabled={isFullscreen}
          waitFor={panRef}
          onScroll={e => {
            const offsetY = e.nativeEvent.contentOffset.y;
            if (scrollOffset) scrollOffset.value = offsetY;
            setIsScrolled(offsetY > 0);
          }}
          scrollEventThrottle={16}
          bounces={false}
          nestedScrollEnabled={true}
        >
          {/* Countdown Section */}
          {countdown && (
            <>
              <View style={styles.fullWidthLine} />
              <View style={styles.statusSection}>
                {isLiveTrain ? (
                  trainData?.routeName?.toLowerCase().includes('acela') ? (
                    <Ionicons name="train" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
                  ) : (
                    <FontAwesome6 name="train" size={18} color={COLORS.primary} style={{ marginRight: 8 }} />
                  )
                ) : (
                  <Ionicons name="time-outline" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
                )}
                <Text style={styles.statusText}>
                  {isLiveTrain ? 'Train is en route and ' : ''}
                  {countdown.past ? 'Departed ' : 'Departs in '}
                  <Text style={{ fontWeight: 'bold' }}>{countdown.value}</Text>{' '}
                  {unitLabel.toLowerCase()}
                </Text>
              </View>
            </>
          )}
          
          <View style={styles.fullWidthLine} />

          {/* Departure Info */}
          <View style={styles.infoSection}>
            <View style={styles.infoHeader}>
              <MaterialCommunityIcons name="arrow-top-right" size={16} color={COLORS.primary} />
              <TouchableOpacity
                style={styles.stationTouchable}
                onPress={() => handleStationPress(trainData.fromCode)}
                activeOpacity={0.7}
              >
                <Text style={styles.locationCode}>{trainData.fromCode}</Text>
                <Text style={styles.locationName}> • {trainData.from}</Text>
              </TouchableOpacity>
            </View>
            <TimeDisplay
              time={trainData.departTime}
              dayOffset={0}
              style={styles.timeText}
              superscriptStyle={styles.timeSuperscript}
            />
            <View style={styles.durationLineRow}>
              <View style={styles.durationContentRow}>
                <MaterialCommunityIcons
                  name="clock-outline"
                  size={14}
                  color={COLORS.secondary}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.durationText}>{duration}</Text>
                {distanceMiles !== null && (
                  <Text style={[styles.durationText, { marginLeft: 0 }]}>
                    {' '}
                    • {Math.round(convertDistance(distanceMiles, distanceUnit)).toLocaleString()} {distanceSuffix(distanceUnit)}
                  </Text>
                )}
                {allStops.length > 0 && (
                  <Text style={[styles.durationText, { marginLeft: 0 }]}>
                    {' '}
                    • {allStops.length - 1} {pluralize(allStops.length - 1, 'stop')}
                  </Text>
                )}
              </View>
              <View style={styles.horizontalLine} />
            </View>
          </View>

          {/* Arrival Info */}
          <View style={styles.infoSection}>
            <View style={styles.infoHeader}>
              <MaterialCommunityIcons name="arrow-bottom-left" size={16} color={COLORS.primary} />
              <TouchableOpacity
                style={styles.stationTouchable}
                onPress={() => handleStationPress(trainData.toCode)}
                activeOpacity={0.7}
              >
                <Text style={styles.locationCode}>{trainData.toCode}</Text>
                <Text style={styles.locationName}> • {trainData.to}</Text>
              </TouchableOpacity>
            </View>
            <TimeDisplay
              time={trainData.arriveTime}
              dayOffset={trainData.arriveDayOffset || 0}
              style={styles.timeText}
              superscriptStyle={styles.timeSuperscript}
            />
          </View>

          <View style={styles.fullWidthLine} />

          {/* Where's My Train? Section */}
          <TouchableOpacity
            style={styles.expandableSection}
            onPress={() => setIsWhereIsMyTrainExpanded(!isWhereIsMyTrainExpanded)}
            activeOpacity={0.7}
          >
            <View style={styles.expandableHeader}>
              {trainData?.routeName?.toLowerCase().includes('acela') ? (
                <Ionicons name="train" size={20} color={COLORS.primary} />
              ) : (
                <FontAwesome6 name="train" size={18} color={COLORS.primary} />
              )}
              <Text style={styles.expandableTitle}>Where's My Train?</Text>
              <Ionicons 
                name={isWhereIsMyTrainExpanded ? "chevron-up" : "chevron-down"} 
                size={20} 
                color={COLORS.secondary} 
              />
            </View>
          </TouchableOpacity>

          {/* Expanded Route Details */}
          {isWhereIsMyTrainExpanded && allStops.length > 0 && (
            <View style={styles.expandedContent}>
              {/* All Stops Timeline */}
              <View style={styles.fullRouteTimeline}>
                {allStops.map((stop, index) => {
                  const isPast = isLiveTrain && index < nextStopIndex;
                  const isCurrent = isLiveTrain && index === nextStopIndex;
                  const isOrigin = index === 0;
                  const isDest = index === allStops.length - 1;

                  return (
                    <View key={index} style={styles.timelineStop}>
                      {!isOrigin && (isPast || isCurrent) && <View style={[styles.timelineConnector, styles.timelineConnectorPast]} />}
                      {!isOrigin && !(isPast || isCurrent) && <View style={styles.timelineConnectorGap} />}
                      {isCurrent && !isOrigin && (
                        <View style={styles.timelineTrainPosition}>
                          {trainData?.routeName?.toLowerCase().includes('acela') ? (
                            <Ionicons name="train" size={14} color={COLORS.primary} />
                          ) : (
                            <FontAwesome6 name="train" size={12} color={COLORS.primary} />
                          )}
                        </View>
                      )}
                      {!isDest && isPast && <View style={[styles.timelineConnectorBottom, styles.timelineConnectorPast]} />}
                      {!isDest && !isPast && <View style={styles.timelineConnectorBottomGap} />}
                      <View style={styles.timelineStopRow}>
                        <View style={styles.timelineMarker}>
                          <View style={[styles.timelineDot, isPast && styles.timelineDotPast]} />
                        </View>
                        <TouchableOpacity
                          style={styles.timelineStopInfo}
                          onPress={() => handleStationPress(stop.code)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.timelineStopName, isPast && styles.timelineTextPast, isCurrent && styles.timelineTextCurrent]}>
                            {stop.name}
                          </Text>
                          {isCurrent && (() => {
                            const now = new Date();
                            const currentMinutes = now.getHours() * 60 + now.getMinutes();
                            const stopMinutes = timeToMinutes(stop.time) + stop.dayOffset * 24 * 60;
                            const diffMin = Math.max(0, Math.round(stopMinutes - currentMinutes));
                            const arrivalText = diffMin >= 60
                              ? `Arrival in ${Math.floor(diffMin / 60)}h${diffMin % 60 > 0 ? `${diffMin % 60}m` : ''}`
                              : `Arrival in ${diffMin} min`;
                            return <Text style={styles.arrivalCountdown}>{arrivalText}</Text>;
                          })()}
                          <View style={styles.timelineStopCodeRow}>
                            <Text style={[styles.timelineStopCode, isPast && styles.timelineTextPast, isCurrent && styles.timelineTextCurrent]}>
                              {stop.code}
                            </Text>
                            {stopWeather[stop.code] && (
                              <>
                                <Text style={[styles.timelineStopCode, isPast && styles.timelineTextPast, isCurrent && styles.timelineTextCurrent]}> • </Text>
                                <Ionicons name={stopWeather[stop.code].icon as any} size={11} color={isCurrent ? '#FFFFFF' : COLORS.secondary} style={isPast ? { opacity: 0.6 } : undefined} />
                                <Text style={[styles.timelineStopCode, isPast && styles.timelineTextPast, isCurrent && styles.timelineTextCurrent]}> {stopWeather[stop.code].temp}°{tempUnit}</Text>
                              </>
                            )}
                          </View>
                        </TouchableOpacity>
                        <TimeDisplay
                          time={stop.time}
                          dayOffset={stop.dayOffset}
                          style={{
                            ...styles.timelineStopTime,
                            ...(isPast ? styles.timelineTextPast : {}),
                            ...(isCurrent ? { color: '#FFFFFF', fontWeight: 'bold' as const } : {}),
                          }}
                          superscriptStyle={{
                            ...styles.timelineStopTimeSuperscript,
                            ...(isPast ? styles.timelineTextPast : {}),
                            ...(isCurrent ? { color: '#FFFFFF', fontWeight: 'bold' as const } : {}),
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
              <Text style={styles.weatherNote}>Weather is calculated at each stop's scheduled arrival time.</Text>
            </View>
          )}

          <View style={styles.fullWidthLine} />

          {/* Good to Know Section */}
          <View style={styles.goodToKnowSection}>
            <Text style={styles.sectionTitle}>Good to Know</Text>
            
            {/* Timezone Widget */}
            {timezoneInfo && (
              <View style={styles.infoCard}>
                <View style={styles.infoCardIcon}>
                  <Ionicons name="time-outline" size={24} color={COLORS.primary} />
                </View>
                <View style={styles.infoCardContent}>
                  <Text style={styles.infoCardTitle}>
                    {timezoneInfo.hasChange ? 'Timezone Change' : 'No Timezone Change'}
                  </Text>
                  <Text style={styles.infoCardSubtext}>{timezoneInfo.message}</Text>
                </View>
              </View>
            )}

            {/* Arrival Weather Widget */}
            <View style={styles.infoCard}>
              <View style={styles.infoCardIcon}>
                {isLoadingWeather ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : weatherData ? (
                  <Ionicons name={weatherData.icon as any} size={24} color={COLORS.primary} />
                ) : (
                  <Ionicons name="partly-sunny-outline" size={24} color={COLORS.primary} />
                )}
              </View>
              <View style={styles.infoCardContent}>
                <Text style={styles.infoCardTitle}>Arrival Weather</Text>
                {isLoadingWeather ? (
                  <Text style={styles.infoCardSubtext}>Loading...</Text>
                ) : weatherData ? (
                  <Text style={styles.infoCardSubtext}>
                    {weatherData.temperature}°{tempUnit} and {weatherData.condition.toLowerCase()}
                  </Text>
                ) : (
                  <Text style={styles.infoCardSubtext}>Weather data unavailable</Text>
                )}
              </View>
            </View>
          </View>

          <View style={styles.fullWidthLine} />

          {/* My History on This Route Section */}
          <View style={styles.historySection}>
            <Text style={styles.sectionTitle}>My History on This Route</Text>
            {trainData && (
              <Text style={styles.historyRouteSubtitle}>
                {trainData.fromCode} → {trainData.toCode}
              </Text>
            )}
            
            <View style={styles.historyCard}>
              <View style={styles.historyStats}>
                <View style={styles.historyStat}>
                  <Text style={styles.historyStatLabel}>Trips</Text>
                  <View style={styles.historyStatValueRow}>
                    <MaterialCommunityIcons name="train-car" size={20} color={COLORS.secondary} style={styles.historyStatIcon} />
                    <Text style={styles.historyStatValue}>
                      {routeHistory && routeHistory.trips > 0 ? routeHistory.trips : 0}
                    </Text>
                  </View>
                </View>
                <View style={styles.historyStat}>
                  <Text style={styles.historyStatLabel}>Distance</Text>
                  <View style={styles.historyStatValueRow}>
                    <Ionicons name="navigate" size={20} color={COLORS.secondary} style={styles.historyStatIcon} />
                    <Text style={styles.historyStatValue}>
                      {routeHistory && routeHistory.trips > 0
                        ? `${Math.round(convertDistance(routeHistory.distance, distanceUnit)).toLocaleString()} ${distanceSuffix(distanceUnit)}`
                        : `0 ${distanceSuffix(distanceUnit)}`}
                    </Text>
                  </View>
                </View>
                <View style={styles.historyStat}>
                  <Text style={styles.historyStatLabel}>Travel Time</Text>
                  <View style={styles.historyStatValueRow}>
                    <Ionicons name="time" size={20} color={COLORS.secondary} style={styles.historyStatIcon} />
                    <Text style={styles.historyStatValue}>
                      {routeHistory && routeHistory.trips > 0 
                        ? `${Math.floor(routeHistory.duration / 60)}h ${routeHistory.duration % 60}m`
                        : '0m'
                      }
                    </Text>
                  </View>
                </View>
              </View>
              {(!routeHistory || routeHistory.trips === 0) && (
                <Text style={styles.historyEmptyText}>No past rides on this route</Text>
              )}
            </View>
          </View>

          <View style={styles.fullWidthLine} />

          {/* Help Section */}
          <View style={styles.helpSection}>
            <Text style={styles.sectionTitle}>Help</Text>
            <TouchableOpacity
              style={styles.infoCard}
              activeOpacity={0.7}
              onPress={() => Linking.openURL('mailto:him@jasonxu.me?subject=Incorrect%20Tracky%20Data')}
            >
              <View style={styles.infoCardIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={24} color={COLORS.primary} />
              </View>
              <View style={styles.infoCardContent}>
                <Text style={styles.infoCardTitle}>Report a Bug/Bad Data</Text>
                <Text style={styles.infoCardSubtext}>Something not right? Let us know.</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.secondary} style={{ alignSelf: 'center' }} />
            </TouchableOpacity>
          </View>
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
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.md,
    borderBottomWidth: 0,
    borderBottomColor: 'transparent',
    backgroundColor: 'transparent',
    zIndex: 10,
  },
  headerScrolled: {
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border.primary,
  },
  scrollContent: {
    flex: 1,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  headerLogo: {
    width: 40,
    height: 50,
    resizeMode: 'contain',
  },
  headerTextContainer: {
    flex: 1,
    marginRight: 48 + Spacing.md,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 0,
  },
  headerTitle: {
    fontSize: 14,
    fontFamily: FONTS.family,
    color: COLORS.secondary,
  },
  absoluteCloseButton: {
    position: 'absolute',
    top: 0,
    right: Spacing.xl,
    zIndex: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: COLORS.border.primary,
  },
  routeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    fontFamily: FONTS.family,
    color: COLORS.primary,
  },
  statusSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  statusText: {
    fontSize: 16,
    fontFamily: FONTS.family,
    color: COLORS.primary,
  },
  fullWidthLine: {
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.tertiary,
    backgroundColor: 'transparent',
  },
  journeySection: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  stationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  stationLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconCircle: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  stationInfo: {
    flex: 1,
  },
  stationCode: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.family,
    color: COLORS.primary,
  },
  bigTimeText: {
    fontSize: 32,
    fontWeight: 'bold',
    fontFamily: FONTS.family,
    color: COLORS.primary,
  },
  bigTimeSuperscript: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.secondary,
    marginLeft: 2,
  },
  journeyInfoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    marginLeft: Spacing.md,
  },
  verticalLine: {
    width: 2,
    height: '100%',
    backgroundColor: COLORS.tertiary,
    marginRight: Spacing.xl,
  },
  journeyDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  journeyDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  journeyDetailText: {
    fontSize: 14,
    fontFamily: FONTS.family,
    color: COLORS.secondary,
  },
  expandableSection: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    backgroundColor: COLORS.background.secondary,
  },
  expandableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  expandableTitle: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: FONTS.family,
    color: COLORS.primary,
    flex: 1,
  },
  expandedContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    backgroundColor: COLORS.background.secondary,
  },
  fullRouteTimeline: {
  },
  timelineStop: {
    position: 'relative',
  },
  timelineConnector: {
    position: 'absolute',
    left: 11,
    top: 0,
    width: 2,
    height: 24,
    backgroundColor: COLORS.tertiary,
  },
  timelineConnectorGap: {
    position: 'absolute',
    left: 11,
    top: 0,
    width: 2,
    height: 19,
    backgroundColor: COLORS.tertiary,
  },
  timelineConnectorBottom: {
    position: 'absolute',
    left: 11,
    top: 24,
    bottom: 0,
    width: 2,
    backgroundColor: COLORS.tertiary,
  },
  timelineConnectorBottomGap: {
    position: 'absolute',
    left: 11,
    top: 29,
    bottom: 0,
    width: 2,
    backgroundColor: COLORS.tertiary,
  },
  timelineConnectorPast: {
    backgroundColor: COLORS.primary,
  },
  timelineStopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Spacing.md,
  },
  timelineMarker: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.tertiary,
    backgroundColor: 'transparent',
  },
  timelineDotPast: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  timelineTrainPosition: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  timelineStopInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  timelineStopName: {
    fontSize: 15,
    fontWeight: '500',
    fontFamily: FONTS.family,
    color: COLORS.primary,
  },
  arrivalCountdown: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginTop: 1,
  },
  timelineTextCurrent: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  timelineStopCode: {
    fontSize: 12,
    fontFamily: FONTS.family,
    color: COLORS.secondary,
  },
  timelineStopCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timelineStopTime: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.family,
    color: COLORS.primary,
  },
  timelineStopTimeSuperscript: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.secondary,
    marginLeft: 2,
  },
  timelineTextPast: {
    color: COLORS.secondary,
    opacity: 0.6,
  },
  weatherNote: {
    fontSize: 11,
    color: COLORS.secondary,
    opacity: 0.6,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  goodToKnowSection: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: FONTS.family,
    color: COLORS.primary,
    marginBottom: Spacing.lg,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.background.secondary,
    borderRadius: 12,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: COLORS.border.primary,
  },
  infoCardIcon: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.tertiary,
    borderRadius: 20,
    marginRight: Spacing.md,
  },
  infoCardContent: {
    flex: 1,
  },
  infoCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.family,
    color: COLORS.primary,
    marginBottom: Spacing.xs,
  },
  infoCardSubtext: {
    fontSize: 14,
    fontFamily: FONTS.family,
    color: COLORS.secondary,
  },
  historySection: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  historyRouteSubtitle: {
    fontSize: 16,
    fontFamily: FONTS.family,
    color: COLORS.secondary,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.lg,
    fontWeight: '400',
  },
  historyCard: {
    backgroundColor: COLORS.background.secondary,
    borderRadius: 16,
    padding: Spacing.xxl,
    borderWidth: 1,
    borderColor: COLORS.border.primary,
  },
  historyStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  historyStat: {
    alignItems: 'flex-start',
    flex: 1,
  },
  historyStatLabel: {
    fontSize: 14,
    fontFamily: FONTS.family,
    color: COLORS.secondary,
    marginBottom: Spacing.sm,
    fontWeight: '400',
  },
  historyStatValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyStatIcon: {
    marginRight: 6,
  },
  historyStatValue: {
    fontSize: 24,
    fontWeight: '400',
    fontFamily: FONTS.family,
    color: COLORS.primary,
  },
  helpSection: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  historyEmptyText: {
    fontSize: 14,
    fontFamily: FONTS.family,
    color: COLORS.secondary,
    textAlign: 'left',
    paddingTop: Spacing.sm,
    fontWeight: '400',
  },
  infoSection: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  stationTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: Spacing.xs,
  },
  locationCode: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.family,
    color: COLORS.primary,
  },
  locationName: {
    fontSize: 16,
    fontFamily: FONTS.family,
    color: COLORS.primary,
  },
  timeText: {
    fontSize: 36,
    fontWeight: 'bold',
    fontFamily: FONTS.family,
    color: COLORS.primary,
    marginBottom: Spacing.xs,
  },
  timeSuperscript: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.secondary,
    marginLeft: Spacing.xs,
    marginTop: 0,
  },
  durationLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
    gap: Spacing.sm,
  },
  durationContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  durationText: {
    fontSize: 14,
    fontFamily: FONTS.family,
    color: COLORS.secondary,
  },
  horizontalLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.tertiary,
    marginLeft: Spacing.md,
  },
});
