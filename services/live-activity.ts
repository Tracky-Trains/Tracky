import { Platform } from 'react-native';
import type { Train } from '../types/train';
import { parseTimeToDate } from '../utils/time-formatting';
import { logger } from '../utils/logger';

// Type-only import — erased at compile time, won't trigger native module loading
import type { TrainActivityProps } from '../widgets/TrainLiveActivity';
export type { TrainActivityProps };

// Map of "tripId|fromCode|toCode" -> any live activity instance
const activeActivities = new Map<string, any>();

// Lazy-load the live activity handle — expo-widgets requires native modules.
// The try/catch handles Expo Go or missing native module gracefully.
function getTrainLiveActivity() {
  if (Platform.OS !== 'ios') return null;
  try {
    return require('../widgets/TrainLiveActivity').trainLiveActivity;
  } catch {
    return null;
  }
}

function activityKey(train: Train): string {
  return `${train.tripId}|${train.fromCode}|${train.toCode}`;
}

export function isSupported(): boolean {
  if (Platform.OS !== 'ios') return false;
  const version = typeof Platform.Version === 'string' ? parseFloat(Platform.Version) : Platform.Version;
  return version >= 16.1;
}

export function isTrainActiveNow(train: Train): boolean {
  if (train.daysAway !== 0) return false;

  const now = new Date();
  const departDate = parseTimeToDate(train.departTime, now);
  const arriveDate = parseTimeToDate(train.arriveTime, now);

  // Account for multi-day journeys
  if (train.departDayOffset) {
    departDate.setDate(departDate.getDate() + train.departDayOffset);
  }
  if (train.arriveDayOffset) {
    arriveDate.setDate(arriveDate.getDate() + train.arriveDayOffset);
  }

  const delay = train.realtime?.delay ?? 0;

  // Window: 2h before departure through arrival + delay
  const windowStart = new Date(departDate.getTime() - 2 * 60 * 60 * 1000);
  const windowEnd = new Date(arriveDate.getTime() + delay * 60 * 1000 + 30 * 60 * 1000); // +30m buffer

  return now >= windowStart && now <= windowEnd;
}

function buildProps(train: Train): TrainActivityProps {
  const departDelay = train.realtime?.delay ?? 0;
  const arrivalDelay = train.realtime?.arrivalDelay ?? departDelay;
  const status = arrivalDelay > 0 ? 'delayed' : arrivalDelay < 0 ? 'early' : 'on-time';

  const now = new Date();
  const departDate = parseTimeToDate(train.departTime, now);
  if (train.departDayOffset) departDate.setDate(departDate.getDate() + train.departDayOffset);
  const arriveDate = parseTimeToDate(train.arriveTime, now);
  if (train.arriveDayOffset) arriveDate.setDate(arriveDate.getDate() + train.arriveDayOffset);

  const minutesUntilDeparture = Math.round((departDate.getTime() + departDelay * 60_000 - now.getTime()) / 60_000);
  const minutesRemaining = Math.max(0, Math.round((arriveDate.getTime() + arrivalDelay * 60_000 - now.getTime()) / 60_000));
  const totalMinutes = Math.max(1, Math.round((arriveDate.getTime() + arrivalDelay * 60_000 - departDate.getTime()) / 60_000));
  const progressFraction = Math.max(0, Math.min(1, 1 - minutesRemaining / totalMinutes));

  return {
    trainNumber: train.trainNumber,
    routeName: train.routeName,
    fromCode: train.fromCode,
    toCode: train.toCode,
    from: train.from,
    to: train.to,
    departTime: train.departTime,
    arriveTime: train.arriveTime,
    departDelay,
    arrivalDelay,
    minutesUntilDeparture,
    minutesRemaining,
    progressFraction,
    status,
    lastUpdated: Date.now(),
  };
}

export async function startForTrain(train: Train): Promise<boolean> {
  if (!isSupported()) {
    logger.warn('[LiveActivity] Not supported on this device/OS version');
    return false;
  }

  const key = activityKey(train);
  if (activeActivities.has(key)) return true;

  const liveActivity = getTrainLiveActivity();
  if (!liveActivity) {
    logger.warn('[LiveActivity] Native module not available (expo-widgets not linked)');
    return false;
  }

  try {
    const activity = liveActivity.start(buildProps(train));
    activeActivities.set(key, activity);
    logger.info(`[LiveActivity] Started for ${train.trainNumber} (${key})`);
    return true;
  } catch (e: any) {
    if (e?.code === 'ERR_LIVE_ACTIVITIES_NOT_SUPPORTED') {
      logger.warn('[LiveActivity] Live Activities not enabled on this device');
      return false;
    }
    logger.error(`[LiveActivity] Failed to start for ${train.trainNumber}:`, e);
    throw e;
  }
}

export async function updateForTrain(train: Train): Promise<void> {
  if (!isSupported()) return;

  const key = activityKey(train);
  const activity = activeActivities.get(key);
  if (!activity) return;

  try {
    await activity.update(buildProps(train));
  } catch (e) {
    logger.error(`[LiveActivity] Failed to update for ${train.trainNumber}:`, e);
  }
}

export async function endForTrain(tripId: string, fromCode: string, toCode: string): Promise<void> {
  if (!isSupported()) return;

  const key = `${tripId}|${fromCode}|${toCode}`;
  const activity = activeActivities.get(key);
  if (!activity) return;

  try {
    await activity.end('default');
    activeActivities.delete(key);
    logger.info(`[LiveActivity] Ended for ${key}`);
  } catch (e) {
    logger.error(`[LiveActivity] Failed to end for ${key}:`, e);
  }
}

export async function endAll(): Promise<void> {
  for (const [key] of activeActivities) {
    const [tripId, fromCode, toCode] = key.split('|');
    await endForTrain(tripId, fromCode, toCode);
  }
}

export function hasActivityForTrain(train: Train): boolean {
  return activeActivities.has(activityKey(train));
}
