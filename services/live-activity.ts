import { Platform } from 'react-native';
import type { LiveActivity } from 'expo-widgets';
import { trainLiveActivity, type TrainActivityProps } from '../widgets/TrainLiveActivity';
import type { Train } from '../types/train';
import { parseTimeToDate } from '../utils/time-formatting';
import { logger } from '../utils/logger';

// Map of "tripId|fromCode|toCode" -> LiveActivity instance
const activeActivities = new Map<string, LiveActivity<TrainActivityProps>>();

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

  const delay = train.realtime?.delay || 0;

  // Window: 2h before departure through arrival + delay
  const windowStart = new Date(departDate.getTime() - 2 * 60 * 60 * 1000);
  const windowEnd = new Date(arriveDate.getTime() + delay * 60 * 1000 + 30 * 60 * 1000); // +30m buffer

  return now >= windowStart && now <= windowEnd;
}

function buildProps(train: Train): TrainActivityProps {
  const delay = train.realtime?.delay ?? 0;
  const status = delay > 0 ? 'delayed' : delay < 0 ? 'early' : 'on-time';
  return {
    trainNumber: train.trainNumber,
    routeName: train.routeName,
    fromCode: train.fromCode,
    toCode: train.toCode,
    from: train.from,
    to: train.to,
    departTime: train.departTime,
    arriveTime: train.arriveTime,
    delayMinutes: delay,
    status,
    lastUpdated: Date.now(),
  };
}

export async function startForTrain(train: Train): Promise<void> {
  if (!isSupported()) return;

  const key = activityKey(train);
  if (activeActivities.has(key)) return;

  try {
    const activity = trainLiveActivity.start(buildProps(train));
    activeActivities.set(key, activity);
    logger.info(`[LiveActivity] Started for ${train.trainNumber} (${key})`);
  } catch (e) {
    logger.error(`[LiveActivity] Failed to start for ${train.trainNumber}:`, e);
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
