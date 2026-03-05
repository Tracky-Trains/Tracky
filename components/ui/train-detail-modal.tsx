import React, { useMemo } from 'react';
import { ActivityIndicator, Dimensions, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated, { Easing, FadeInDown, useAnimatedStyle } from 'react-native-reanimated';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { type ColorPalette, Spacing, getCloseButtonStyle } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { light as hapticLight } from '../../utils/haptics';
import { isThruwayName, TrainIcon } from '../TrainIcon';
import { addDelayToTime, formatDelayStatus, formatTimeWithDayOffset, getDelayColorKey, parseTimeToDate, timeToMinutes } from '../../utils/time-formatting';
import { RealtimeService } from '../../services/realtime';
import { fetchWithTimeout } from '../../utils/fetch-with-timeout';

import { useTrainContext } from '../../context/TrainContext';
import { useUnits } from '../../context/UnitsContext';
import { TrainStorageService } from '../../services/storage';
import type { Train } from '../../types/train';
import { haversineDistance } from '../../utils/distance';
import { gtfsParser } from '../../utils/gtfs-parser';
import { logger, openReportBadDataEmail } from '../../utils/logger';
import { getCurrentMinutesInTimezone, getTimezoneForStop } from '../../utils/timezone';
import { calculateDuration, getCountdownForTrain, pluralize } from '../../utils/train-display';
import { convertDistance, distanceSuffix, formatTemp, weatherApiTempUnit } from '../../utils/units';
import { getWeatherCondition } from '../../utils/weather';
import AnimatedRollingText from './AnimatedRollingText';
import MarqueeText from './MarqueeText';
import { SlideUpModalContext } from './slide-up-modal';
import TimeDisplay from './TimeDisplay';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { selectedTrain } = useTrainContext();
  const { tempUnit, distanceUnit } = useUnits();
  const trainData = train || selectedTrain;
  
  const [allStops, setAllStops] = React.useState<StopInfo[]>([]);
  const [isWhereIsMyTrainExpanded, setIsWhereIsMyTrainExpanded] = React.useState(false);

  const [weatherData, setWeatherData] = React.useState<WeatherData | null>(null);
  const [isLoadingWeather, setIsLoadingWeather] = React.useState(false);
  const [routeHistory, setRouteHistory] = React.useState<{ trips: number; distance: number; duration: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [stopWeather, setStopWeather] = React.useState<Record<string, { temp: number; icon: string }>>({});
  const stopWeatherKeyRef = React.useRef<string | null>(null);
  const [stopDelays, setStopDelays] = React.useState<Map<string, { departureDelay?: number; arrivalDelay?: number }>>(new Map());

  const isLiveTrain = trainData?.realtime?.position !== undefined;

  // Load stops from GTFS — only re-run when the trip actually changes
  const tripId = trainData?.tripId;
  React.useEffect(() => {
    if (!tripId) return;

    try {
      const stops = gtfsParser.getStopTimesForTrip(tripId);
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
  }, [tripId]);

  // Fetch per-stop delays for the timeline — re-run when realtime delay changes
  const daysAway = trainData?.daysAway;
  const currentDelay = trainData?.realtime?.delay;
  React.useEffect(() => {
    if (!tripId || (daysAway != null && daysAway > 0)) {
      setStopDelays(new Map());
      return;
    }
    let cancelled = false;
    const fetchDelays = async () => {
      const delays = await RealtimeService.getDelaysForAllStops(tripId);
      if (!cancelled) setStopDelays(delays);
    };
    fetchDelays();
    return () => { cancelled = true; };
  }, [tripId, daysAway, currentDelay]);

  // Fetch weather data for destination — only when destination or unit changes
  const toCode = trainData?.toCode;
  React.useEffect(() => {
    if (!toCode) return;

    let cancelled = false;
    const fetchWeather = async () => {
      try {
        setIsLoadingWeather(true);
        const destStop = gtfsParser.getStop(toCode);
        if (!destStop) return;

        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${destStop.stop_lat}&longitude=${destStop.stop_lon}&current=temperature_2m,weather_code&temperature_unit=${weatherApiTempUnit(tempUnit)}&timezone=auto`;
        const response = await fetchWithTimeout(weatherUrl, { timeoutMs: 10000 });

        if (!cancelled && response.ok) {
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
        if (!cancelled) setIsLoadingWeather(false);
      }
    };

    fetchWeather();
    return () => { cancelled = true; };
  }, [toCode, tempUnit]);

  // Fetch hourly weather for each stop (starts immediately so data is ready)
  React.useEffect(() => {
    if (allStops.length === 0 || !tripId) return;

    const key = `${tripId}-${allStops.length}-${tempUnit}`;
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
          const res = await fetchWithTimeout(url, { timeoutMs: 10000 });
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
  }, [allStops, tripId, tempUnit]);

  // Fetch route history stats — only when route name changes
  const routeName = trainData?.routeName;
  React.useEffect(() => {
    if (!routeName) return;

    let cancelled = false;
    const fetchRouteHistory = async () => {
      try {
        const history = await TrainStorageService.getTripHistory();
        const matchingTrips = history.filter(
          trip => trip.routeName === routeName
        );

        const totalDistance = matchingTrips.reduce((sum, trip) => sum + (trip.distance || 0), 0);
        const totalDuration = matchingTrips.reduce((sum, trip) => sum + (trip.duration || 0), 0);

        if (!cancelled) {
          setRouteHistory({
            trips: matchingTrips.length,
            distance: Math.round(totalDistance),
            duration: Math.round(totalDuration),
          });
        }
      } catch (e) {
        logger.error('Failed to fetch route history:', e);
        if (!cancelled) setRouteHistory(null);
      }
    };

    fetchRouteHistory();
    return () => { cancelled = true; };
  }, [routeName]);

  // Get timezone info for origin and destination
  const timezoneInfo = React.useMemo(() => {
    if (!trainData || allStops.length === 0) return null;
    
    try {
      const originStop = gtfsParser.getStop(trainData.fromCode);
      const destStop = gtfsParser.getStop(trainData.toCode);

      logger.debug('Timezone: origin stop lookup', {
        fromCode: trainData.fromCode,
        found: !!originStop,
        lat: originStop?.stop_lat,
        lon: originStop?.stop_lon,
        stop_timezone: originStop?.stop_timezone,
      });
      logger.debug('Timezone: dest stop lookup', {
        toCode: trainData.toCode,
        found: !!destStop,
        lat: destStop?.stop_lat,
        lon: destStop?.stop_lon,
        stop_timezone: destStop?.stop_timezone,
      });

      const originTz = originStop ? getTimezoneForStop(originStop) : null;
      const destTz = destStop ? getTimezoneForStop(destStop) : null;

      logger.debug('Timezone: resolved timezones', { originTz, destTz });

      if (!originTz || !destTz) return null;

      if (originTz !== destTz) {
        // Calculate timezone offset difference using formatToParts with basic
        // options (Hermes supports these; shortOffset and Date(string) do not
        // work reliably on Hermes).
        const now = new Date();
        const toMs = (tz: string) => {
          const p = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
          }).formatToParts(now);
          const g = (t: string) => parseInt(p.find(x => x.type === t)?.value || '0', 10);
          const h = g('hour');
          return Date.UTC(g('year'), g('month') - 1, g('day'), h === 24 ? 0 : h, g('minute'), g('second'));
        };
        const originMs = toMs(originTz);
        const destMs = toMs(destTz);
        const hourDiff = Math.round((destMs - originMs) / (1000 * 60 * 60));

        logger.debug('Timezone: offset calculation', {
          originTz,
          destTz,
          originMs,
          destMs,
          hourDiff,
        });

        const sign = hourDiff > 0 ? '+' : '';
        const absHour = Math.abs(hourDiff);

        // Get timezone abbreviations
        const getAbbrev = (tz: string) => {
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            timeZoneName: 'short',
          }).formatToParts(now);
          return parts.find(x => x.type === 'timeZoneName')?.value || tz;
        };
        const destAbbrev = getAbbrev(destTz);
        const originAbbrev = getAbbrev(originTz);

        // Calculate arrival time in departure timezone
        const arrivalInOriginTz = addDelayToTime(trainData.arriveTime, -hourDiff * 60, trainData.arriveDayOffset || 0);

        return {
          hasChange: true,
          title: `${sign}${hourDiff}h Timezone Change`,
          message: `${trainData.arriveTime} ${destAbbrev} is ${arrivalInOriginTz.time} ${originAbbrev}`,
        };
      }

      return {
        hasChange: false,
        title: 'No Timezone Change',
        message: 'Both stations are in the same timezone',
      };
    } catch (e) {
      logger.error('Timezone: calculation failed', e);
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
    hapticLight();
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
  // GTFS stop times are in the agency timezone, so compare "now" in that timezone
  const agencyTz = gtfsParser.agencyTimezone;
  const nextStopIndex = React.useMemo(() => {
    if (!isLiveTrain || allStops.length === 0) return -1;

    const currentMinutes = getCurrentMinutesInTimezone(agencyTz);
    for (let i = 0; i < allStops.length; i++) {
      const stop = allStops[i];
      const stopMinutes = timeToMinutes(stop.time);
      const adjustedStopMinutes = stopMinutes + stop.dayOffset * 24 * 60;
      if (adjustedStopMinutes > currentMinutes) {
        return i;
      }
    }
    return -1;
  }, [isLiveTrain, allStops, agencyTz]);

  // Local time at the train's next stop (only for live trains)
  const [trainLocalTime, setTrainLocalTime] = React.useState<string | null>(null);
  const nextStopTz = React.useMemo(() => {
    if (!isLiveTrain || nextStopIndex < 0 || nextStopIndex >= allStops.length) return null;
    const stop = allStops[nextStopIndex];
    if (!stop) return null;
    const stopData = gtfsParser.getStop(stop.code);
    return stopData ? getTimezoneForStop(stopData) : null;
  }, [isLiveTrain, nextStopIndex, allStops]);
  React.useEffect(() => {
    const update = () => {
      if (!nextStopTz) { setTrainLocalTime(null); return; }
      try {
        const formatted = new Date().toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: nextStopTz,
          timeZoneName: 'short',
        });
        setTrainLocalTime(formatted);
      } catch { setTrainLocalTime(null); }
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [nextStopTz]);

  const whereIsMyTrainSubtext = React.useMemo(() => {
    if (!isLiveTrain || nextStopIndex < 0 || allStops.length === 0) {
      return `${allStops.length} stops`;
    }
    const stop = allStops[nextStopIndex];
    const currentMinutes = getCurrentMinutesInTimezone(agencyTz);
    const stopMinutes = timeToMinutes(stop.time) + stop.dayOffset * 24 * 60;
    const delayData = stopDelays.get(stop.code);
    const delayMin = delayData?.arrivalDelay ?? delayData?.departureDelay ?? 0;
    const delayOffset = delayMin > 0 ? delayMin : 0;
    const diffMin = Math.max(0, Math.round(stopMinutes + delayOffset - currentMinutes));
    const timeStr = diffMin >= 60
      ? `${Math.floor(diffMin / 60)}h${diffMin % 60 > 0 ? ` ${diffMin % 60}m` : ''}`
      : `${diffMin} min`;
    const delayLabel = delayOffset > 0 ? ` (${delayOffset}m late)` : '';
    return nextStopIndex === 0 ? `Departs ${stop.name} in ${timeStr}${delayLabel}` : `${stop.name} in ${timeStr}${delayLabel}`;
  }, [isLiveTrain, nextStopIndex, allStops, stopDelays, agencyTz]);

  if (!trainData) {
    return (
      <View style={styles.modalContent}>
        <View style={[styles.header]}>
          <View style={styles.headerContent} />
          <TouchableOpacity onPress={() => { hapticLight(); onClose(); }} style={styles.absoluteCloseButton} activeOpacity={0.6}>
            <Ionicons name="close" size={24} color={colors.primary} />
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
                {trainData.routeName || trainData.operator} {trainData.trainNumber} · {isLiveTrain && trainLocalTime ? trainLocalTime : trainData.date}
              </Text>
            </View>
            <MarqueeText
              text={`${trainData.from} to ${trainData.to}`}
              style={styles.routeTitle}
            />
          </View>
        </View>
        <TouchableOpacity onPress={() => { hapticLight(); onClose(); }} style={styles.absoluteCloseButton} activeOpacity={0.6}>
          <Ionicons name="close" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <Animated.View style={[{ flex: 1 }, fadeAnimatedStyle]}>
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
          {countdown && (() => {
            const liveDelay = isLiveTrain ? trainData.realtime?.delay : undefined;
            const liveDelayKey = isLiveTrain ? getDelayColorKey(liveDelay) : null;
            const bannerBg = liveDelayKey === 'delayed' ? 'rgba(239, 68, 68, 0.15)'
              : liveDelayKey === 'onTime' ? 'rgba(16, 185, 129, 0.15)'
              : undefined;
            const bannerColor = liveDelayKey === 'delayed' ? colors.delayed
              : liveDelayKey === 'onTime' ? colors.success
              : colors.primary;
            return (
            <View style={[styles.expandableSection, bannerBg != null && { backgroundColor: bannerBg }]}>
              <View style={styles.statusRow}>
                {isLiveTrain ? (
                  <TrainIcon name={trainData?.routeName} size={20} color={bannerColor} style={{ marginRight: Spacing.sm }} />
                ) : (
                  <Ionicons name="time-outline" size={20} color={colors.primary} style={{ marginRight: Spacing.sm }} />
                )}
                <Text style={[styles.statusText, { color: bannerColor }]}>
                  {isLiveTrain ? 'En route, ' : ''}
                  {countdown.past ? (isLiveTrain ? 'departed ' : 'Departed ') : (isLiveTrain ? 'departs in ' : 'Departs in ')}
                </Text>
                <AnimatedRollingText value={String(countdown.value)} style={[styles.statusText, { fontWeight: 'bold', color: bannerColor }]} />
                <Text style={[styles.statusText, { color: bannerColor }]}>{' '}{unitLabel.toLowerCase()}</Text>
              </View>
            </View>
            );
          })()}

          {/* Departure / Arrival Board */}
          <View style={styles.departArriveBoard}>
            {/* Departure Info */}
            <View style={[styles.infoSection, { paddingBottom: 0 }]}>
              <View style={styles.infoHeader}>
                <MaterialCommunityIcons name="arrow-top-right" size={16} color={colors.primary} />
                <TouchableOpacity
                  style={styles.stationTouchable}
                  onPress={() => handleStationPress(trainData.fromCode)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.locationCode}>{trainData.fromCode}</Text>
                  <Text style={styles.locationName}> · {trainData.from}</Text>
                </TouchableOpacity>
              </View>
              {(() => {
                const dDelay = trainData.daysAway <= 0 ? trainData.realtime?.delay : undefined;
                const dDelayed = dDelay && dDelay > 0 ? addDelayToTime(trainData.departTime, dDelay, 0) : undefined;
                const colorKey = getDelayColorKey(dDelay);
                const timeColor = colorKey === 'onTime' ? colors.success : undefined;
                return (
                  <>
                    <TimeDisplay
                      time={trainData.departTime}
                      dayOffset={0}
                      style={[styles.timeText, timeColor && { color: timeColor }]}
                      superscriptStyle={[styles.timeSuperscript, timeColor && { color: timeColor }]}
                      delayMinutes={dDelay}
                      delayedTime={dDelayed?.time}
                      delayedDayOffset={dDelayed?.dayOffset}
                      hideDelayLabel
                    />
                    {trainData.daysAway <= 0 && dDelay != null && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                        <AnimatedRollingText
                          value={formatDelayStatus(dDelay)}
                          style={[styles.delayStatusText, colorKey === 'delayed' ? styles.delayStatusLate : styles.delayStatusEarly]}
                        />
                        {countdown && (
                          <AnimatedRollingText
                            value={` · ${countdown.past ? `Departed ${countdown.value} ${countdown.unit.toLowerCase()} ago` : `Departs in ${countdown.value} ${countdown.unit.toLowerCase()}`}`}
                            style={[styles.delayStatusText, styles.countdownInline]}
                          />
                        )}
                      </View>
                    )}
                  </>
                );
              })()}
              <View style={styles.durationLineRow}>
                <View style={styles.durationContentRow}>
                  <MaterialCommunityIcons
                    name="clock-outline"
                    size={14}
                    color={colors.secondary}
                    style={{ marginRight: Spacing.sm }}
                  />
                  <AnimatedRollingText value={duration} style={styles.durationText} />
                  {distanceMiles !== null && (
                    <AnimatedRollingText
                      value={` · ${Math.round(convertDistance(distanceMiles, distanceUnit)).toLocaleString()} ${distanceSuffix(distanceUnit)}`}
                      style={[styles.durationText, { marginLeft: 0 }]}
                    />
                  )}
                  {allStops.length > 0 && (
                    <AnimatedRollingText
                      value={` · ${allStops.length - 1} ${pluralize(allStops.length - 1, 'stop')}`}
                      style={[styles.durationText, { marginLeft: 0 }]}
                    />
                  )}
                </View>
                <View style={styles.horizontalLine} />
              </View>
            </View>

            {/* Arrival Info */}
            <View style={[styles.infoSection, { paddingTop: 0 }]}>
              <View style={styles.infoHeader}>
                <MaterialCommunityIcons name="arrow-bottom-left" size={16} color={colors.primary} />
                <TouchableOpacity
                  style={styles.stationTouchable}
                  onPress={() => handleStationPress(trainData.toCode)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.locationCode}>{trainData.toCode}</Text>
                  <Text style={styles.locationName}> · {trainData.to}</Text>
                </TouchableOpacity>
              </View>
              {(() => {
                const aDelay = trainData.daysAway <= 0 ? trainData.realtime?.arrivalDelay : undefined;
                const aDelayed = aDelay && aDelay > 0 ? addDelayToTime(trainData.arriveTime, aDelay, trainData.arriveDayOffset || 0) : undefined;
                const colorKey = getDelayColorKey(aDelay);
                const timeColor = colorKey === 'onTime' ? colors.success : undefined;
                // Compute arrival countdown
                const arriveTime = aDelayed?.time || trainData.arriveTime;
                const arriveDayOffset = aDelayed?.dayOffset ?? (trainData.arriveDayOffset || 0);
                const now = new Date();
                const arriveDate = parseTimeToDate(arriveTime, now);
                arriveDate.setDate(arriveDate.getDate() + arriveDayOffset);
                const arrDeltaSec = (arriveDate.getTime() - now.getTime()) / 1000;
                const arrPast = arrDeltaSec < 0;
                const arrAbsSec = Math.abs(arrDeltaSec);
                let arrCountdownText = '';
                if (arrAbsSec >= 3600) {
                  const h = Math.round(arrAbsSec / 3600);
                  arrCountdownText = `${h} ${h === 1 ? 'hour' : 'hours'}`;
                } else if (arrAbsSec >= 60) {
                  const m = Math.round(arrAbsSec / 60);
                  arrCountdownText = `${m} ${m === 1 ? 'minute' : 'minutes'}`;
                } else {
                  const s = Math.round(arrAbsSec);
                  arrCountdownText = `${s} ${s === 1 ? 'second' : 'seconds'}`;
                }
                return (
                  <>
                    <TimeDisplay
                      time={trainData.arriveTime}
                      dayOffset={trainData.arriveDayOffset || 0}
                      style={[styles.timeText, timeColor && { color: timeColor }]}
                      superscriptStyle={[styles.timeSuperscript, timeColor && { color: timeColor }]}
                      delayMinutes={aDelay}
                      delayedTime={aDelayed?.time}
                      delayedDayOffset={aDelayed?.dayOffset}
                      hideDelayLabel
                    />
                    {trainData.daysAway <= 0 && aDelay != null && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                        <AnimatedRollingText
                          value={formatDelayStatus(aDelay)}
                          style={[styles.delayStatusText, colorKey === 'delayed' ? styles.delayStatusLate : styles.delayStatusEarly]}
                        />
                        <AnimatedRollingText
                          value={` · ${arrPast ? `Arrived ${arrCountdownText} ago` : `Arrives in ${arrCountdownText}`}`}
                          style={[styles.delayStatusText, styles.countdownInline]}
                        />
                      </View>
                    )}
                  </>
                );
              })()}
            </View>
          </View>

          {/* Good to Know Section */}
          <View style={styles.goodToKnowSection}>
            <Text style={styles.sectionTitle}>Good to Know</Text>

            {/* Timezone Widget */}
            {timezoneInfo && (
              <Animated.View entering={FadeInDown.delay(0).duration(200).easing(Easing.out(Easing.quad))} style={styles.infoCard}>
                <View style={styles.infoCardIcon}>
                  <Ionicons name="time-outline" size={24} color={colors.primary} />
                </View>
                <View style={styles.infoCardContent}>
                  <Text style={styles.infoCardTitle}>
                    {timezoneInfo.title}
                  </Text>
                  <MarqueeText text={timezoneInfo.message} style={styles.infoCardSubtext} />
                </View>
              </Animated.View>
            )}

            {/* Arrival Weather Widget */}
            <Animated.View entering={FadeInDown.delay(100).duration(200).easing(Easing.out(Easing.quad))} style={styles.infoCard}>
              <View style={styles.infoCardIcon}>
                {isLoadingWeather ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : weatherData ? (
                  <Ionicons name={weatherData.icon as any} size={24} color={colors.primary} />
                ) : (
                  <Ionicons name="partly-sunny-outline" size={24} color={colors.primary} />
                )}
              </View>
              <View style={styles.infoCardContent}>
                <Text style={styles.infoCardTitle}>Arrival Weather</Text>
                <MarqueeText
                  text={isLoadingWeather ? 'Loading...' : weatherData ? `${weatherData.temperature}°${tempUnit} and ${weatherData.condition.toLowerCase()}` : 'Weather data unavailable'}
                  style={styles.infoCardSubtext}
                />
              </View>
            </Animated.View>

            {/* Where's My Train? */}
            <Animated.View entering={FadeInDown.delay(200).duration(200).easing(Easing.out(Easing.quad))}>
            <TouchableOpacity
              style={styles.historyCard}
              onPress={() => { hapticLight(); setIsWhereIsMyTrainExpanded(!isWhereIsMyTrainExpanded); }}
              activeOpacity={0.7}
            >
              <View style={styles.infoCardRow}>
                <View style={styles.infoCardIcon}>
                  <TrainIcon name={trainData?.routeName} size={24} color={colors.primary} />
                </View>
                <View style={styles.infoCardContent}>
                  <Text style={styles.infoCardTitle}>{isThruwayName(trainData?.routeName) ? "Where's My Bus?" : "Where's My Train?"}</Text>
                  <MarqueeText text={whereIsMyTrainSubtext} style={styles.infoCardSubtext} />
                </View>
                <Ionicons
                  name={isWhereIsMyTrainExpanded ? "chevron-up" : "chevron-down"}
                  size={20}
                  color={colors.secondary}
                  style={{ alignSelf: 'center' }}
                />
              </View>
              {isWhereIsMyTrainExpanded && allStops.length > 0 && (
                <View style={styles.wheresMyTrainContent}>
                  <View style={styles.fullRouteTimeline}>
                    {allStops.map((stop, index) => {
                      const isPast = isLiveTrain && index < nextStopIndex;
                      const isCurrent = isLiveTrain && index === nextStopIndex;
                      const isOrigin = index === 0;
                      const isDest = index === allStops.length - 1;

                      // Per-stop delay: use arrivalDelay for last stop, departureDelay for others
                      const stopDelayData = trainData.daysAway <= 0 ? stopDelays.get(stop.code) : undefined;
                      const stopDelayMin = isDest
                        ? (stopDelayData?.arrivalDelay ?? stopDelayData?.departureDelay)
                        : (stopDelayData?.departureDelay ?? stopDelayData?.arrivalDelay);
                      const stopDelayed = stopDelayMin && stopDelayMin > 0
                        ? addDelayToTime(stop.time, stopDelayMin, stop.dayOffset)
                        : undefined;

                      return (
                        <View key={index} style={styles.timelineStop}>
                          {!isOrigin && isPast && <View style={[styles.timelineConnector, styles.timelineConnectorPast]} />}
                          {!isOrigin && !isPast && <View style={styles.timelineConnectorGap} />}
                          {isCurrent && !isOrigin && (
                            <View style={styles.timelineTrainPosition}>
                              <TrainIcon name={trainData?.routeName} size={14} color={colors.primary} />
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
                              <View style={styles.timelineStopCodeRow}>
                                <Text style={[styles.timelineStopCode, isPast && styles.timelineTextPast, isCurrent && styles.timelineTextCurrent]}>
                                  {stop.code}
                                </Text>
                                {stopWeather[stop.code] && (
                                  <>
                                    <Text style={[styles.timelineStopCode, isPast && styles.timelineTextPast, isCurrent && styles.timelineTextCurrent]}> ·</Text>
                                    <Ionicons name={stopWeather[stop.code].icon as any} size={11} color={isCurrent ? '#FFFFFF' : colors.secondary} style={isPast ? { opacity: 0.6 } : undefined} />
                                    <AnimatedRollingText value={` ${stopWeather[stop.code].temp}°${tempUnit}`} style={[styles.timelineStopCode, isPast && styles.timelineTextPast, isCurrent && styles.timelineTextCurrent]} />
                                  </>
                                )}
                                {isCurrent && (() => {
                                  const currentMinutes = getCurrentMinutesInTimezone(agencyTz);
                                  const scheduledMinutes = timeToMinutes(stop.time) + stop.dayOffset * 24 * 60;
                                  const delayOffset = stopDelayMin && stopDelayMin > 0 ? stopDelayMin : 0;
                                  const diffMin = Math.max(0, Math.round(scheduledMinutes + delayOffset - currentMinutes));
                                  const arrivalText = diffMin >= 60
                                    ? `In ${Math.floor(diffMin / 60)}h${diffMin % 60 > 0 ? `${diffMin % 60}m` : ''}`
                                    : `In ${diffMin} min`;
                                  return (
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                      <Text style={styles.arrivalCountdown}> ·</Text>
                                      <AnimatedRollingText value={arrivalText} style={styles.arrivalCountdown} />
                                    </View>
                                  );
                                })()}
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
                              delayMinutes={stopDelayMin}
                              delayedTime={stopDelayed?.time}
                              delayedDayOffset={stopDelayed?.dayOffset}
                              delayLayout="vertical"
                            />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                  <Text style={styles.weatherNote}>Weather is calculated at each stop's scheduled arrival time.</Text>
                </View>
              )}
            </TouchableOpacity>
            </Animated.View>

            {/* My History on This Route */}
            <Animated.View entering={FadeInDown.delay(300).duration(200).easing(Easing.out(Easing.quad))} style={styles.historyCard}>
              <Text style={[styles.sectionTitle, { marginBottom: Spacing.xs }]}>My History on This Route</Text>
              {trainData && (
                <Text style={styles.historyRouteSubtitle}>{trainData.routeName}</Text>
              )}
              <View style={styles.historyStats}>
                <View style={styles.historyStat}>
                  <Text style={styles.historyStatLabel}>Trips</Text>
                  <View style={styles.historyStatValueRow}>
                    <TrainIcon name={trainData?.routeName} size={14} style={styles.historyStatIcon} />
                    <AnimatedRollingText
                      value={String(routeHistory && routeHistory.trips > 0 ? routeHistory.trips : 0)}
                      style={styles.historyStatValue}
                    />
                  </View>
                </View>
                <View style={styles.historyStat}>
                  <Text style={styles.historyStatLabel}>Distance</Text>
                  <View style={styles.historyStatValueRow}>
                    <Ionicons name="navigate" size={14} color={colors.primary} style={styles.historyStatIcon} />
                    <AnimatedRollingText
                      value={routeHistory && routeHistory.trips > 0
                        ? `${Math.round(convertDistance(routeHistory.distance, distanceUnit)).toLocaleString()} ${distanceSuffix(distanceUnit)}`
                        : `0 ${distanceSuffix(distanceUnit)}`}
                      style={styles.historyStatValue}
                    />
                  </View>
                </View>
                <View style={styles.historyStat}>
                  <Text style={styles.historyStatLabel}>Travel Time</Text>
                  <View style={styles.historyStatValueRow}>
                    <Ionicons name="time" size={14} color={colors.primary} style={styles.historyStatIcon} />
                    <AnimatedRollingText
                      value={routeHistory && routeHistory.trips > 0
                        ? `${Math.floor(routeHistory.duration / 60)}h ${routeHistory.duration % 60}m`
                        : '0m'}
                      style={styles.historyStatValue}
                    />
                  </View>
                </View>
              </View>
              {(!routeHistory || routeHistory.trips === 0) && (
                <Text style={styles.historyEmptyText}>No past rides on this route</Text>
              )}
            </Animated.View>
          </View>

          {/* Report Bad Data */}
          <TouchableOpacity
            style={styles.reportBadDataRow}
            activeOpacity={0.7}
            onPress={() => { hapticLight(); openReportBadDataEmail(); }}
          >
            <Ionicons name="information-circle-outline" size={16} color={colors.secondary} />
            <Text style={styles.reportBadDataText}>Report Bad Data</Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const createStyles = (colors: ColorPalette) => StyleSheet.create({
  modalContent: {
    flex: 1,
    marginHorizontal: -Spacing.xxl,
  },
  header: {
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 0,
    borderBottomColor: 'transparent',
    backgroundColor: 'transparent',
    zIndex: 10,
  },
  headerScrolled: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border.primary,
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
    color: colors.secondary,
  },
  absoluteCloseButton: {
    ...getCloseButtonStyle(colors),
    position: 'absolute',
    top: 0,
    right: Spacing.xxl,
    zIndex: 20,
  },
  routeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    fontFamily: FONTS.family,
    color: colors.primary,
  },
  statusSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.lg,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    fontFamily: FONTS.family,
    color: colors.primary,
  },
  fullWidthLine: {
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: colors.tertiary,
    backgroundColor: 'transparent',
  },
  journeySection: {
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.xl,
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
    color: colors.primary,
  },
  bigTimeText: {
    fontSize: 32,
    fontWeight: 'bold',
    fontFamily: FONTS.family,
    color: colors.primary,
  },
  bigTimeSuperscript: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.secondary,
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
    backgroundColor: colors.tertiary,
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
    color: colors.secondary,
  },
  expandableSection: {
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.xl,
    backgroundColor: colors.background.tertiary,
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
    color: colors.primary,
    flex: 1,
  },
  expandedContent: {
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    backgroundColor: colors.background.secondary,
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
    backgroundColor: colors.tertiary,
  },
  timelineConnectorGap: {
    position: 'absolute',
    left: 11,
    top: 0,
    width: 2,
    height: 18,
    backgroundColor: colors.tertiary,
  },
  timelineConnectorBottom: {
    position: 'absolute',
    left: 11,
    top: 24,
    bottom: 0,
    width: 2,
    backgroundColor: colors.tertiary,
  },
  timelineConnectorBottomGap: {
    position: 'absolute',
    left: 11,
    top: 38,
    bottom: 0,
    width: 2,
    backgroundColor: colors.tertiary,
  },
  timelineConnectorPast: {
    backgroundColor: colors.primary,
  },
  timelineStopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Spacing.lg,
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
    borderColor: colors.tertiary,
    backgroundColor: 'transparent',
  },
  timelineDotPast: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  timelineTrainPosition: {
    position: 'absolute',
    left: 0,
    top: -12,
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
    color: colors.primary,
  },
  arrivalCountdown: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  timelineTextCurrent: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  timelineStopCode: {
    fontSize: 12,
    fontFamily: FONTS.family,
    color: colors.secondary,
  },
  timelineStopCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timelineStopTime: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FONTS.family,
    color: colors.primary,
  },
  timelineStopTimeSuperscript: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.secondary,
    marginLeft: 2,
  },
  timelineTextPast: {
    color: colors.secondary,
    opacity: 0.6,
  },
  weatherNote: {
    fontSize: 11,
    color: colors.secondary,
    opacity: 0.6,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  wheresMyTrainContent: {
    marginTop: Spacing.md,
  },
  goodToKnowSection: {
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xl,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: FONTS.family,
    color: colors.primary,
    marginBottom: Spacing.lg,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 20,
    padding: Spacing.xl,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: colors.border.primary,
  },
  infoCardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoCardIcon: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
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
    color: colors.primary,
    marginBottom: Spacing.xs,
  },
  infoCardSubtext: {
    fontSize: 14,
    fontFamily: FONTS.family,
    color: colors.secondary,
  },
  historySection: {
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.xl,
  },
  historyRouteSubtitle: {
    fontSize: 14,
    fontFamily: FONTS.family,
    color: colors.secondary,
    marginBottom: Spacing.md,
    fontWeight: '400',
  },
  historyCard: {
    borderRadius: 20,
    padding: Spacing.xl,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: colors.border.primary,
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
    color: colors.secondary,
    marginBottom: Spacing.sm,
    fontWeight: '400',
  },
  historyStatValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyStatIcon: {
    marginRight: Spacing.sm,
  },
  historyStatValue: {
    fontSize: 14,
    fontWeight: '400',
    fontFamily: FONTS.family,
    color: colors.primary,
  },
  helpSection: {
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.xl,
  },
  historyEmptyText: {
    fontSize: 14,
    fontFamily: FONTS.family,
    color: colors.secondary,
    textAlign: 'left',
    paddingTop: Spacing.sm,
    fontWeight: '400',
  },
  reportBadDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xl,
  },
  reportBadDataText: {
    fontSize: 13,
    fontFamily: FONTS.family,
    color: colors.secondary,
  },
  departArriveBoard: {
    paddingTop: Spacing.xl,
  },
  infoSection: {
    paddingHorizontal: Spacing.xxl,
    paddingVertical: Spacing.lg,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
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
    color: colors.primary,
  },
  locationName: {
    fontSize: 16,
    fontFamily: FONTS.family,
    color: colors.primary,
  },
  timeText: {
    fontSize: 36,
    fontWeight: 'bold',
    fontFamily: FONTS.family,
    color: colors.primary,
    marginBottom: 0,
  },
  timeSuperscript: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.secondary,
    marginLeft: Spacing.xs,
    marginTop: 0,
  },
  delayStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
    marginTop: 2,
  },
  delayStatusLate: {
    color: colors.delayed,
  },
  delayStatusEarly: {
    color: colors.success,
  },
  countdownInline: {
    fontWeight: '400',
    color: colors.secondary,
  },
  durationLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  durationContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  durationText: {
    fontSize: 12,
    fontFamily: FONTS.family,
    color: colors.secondary,
  },
  horizontalLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border.primary,
    marginLeft: Spacing.sm,
  },
});
