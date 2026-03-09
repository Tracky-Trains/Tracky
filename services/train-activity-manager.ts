import type { NotificationPrefs } from './storage';
import { DEFAULT_NOTIFICATION_PREFS, TrainStorageService } from './storage';
import { BackgroundTaskService } from './background-tasks';
import * as LiveActivityService from './live-activity';
import * as NotificationService from './notifications';
import { selectNextTrain } from './widget-data';
import type { Train } from '../types/train';
import { getAdjustedTrainDates } from '../utils/train-helpers';
import { logger } from '../utils/logger';
import { Platform } from 'react-native';

// Cached prefs — refreshed on startup and when changed
let cachedPrefs: NotificationPrefs = DEFAULT_NOTIFICATION_PREFS;

// Track which trains we've already sent arrival alerts for (to avoid duplicates).
// This in-memory set is synced from persistent storage on startup so both
// foreground and background code paths share the same dedup state.
const sentArrivalAlerts = new Set<string>();

// Track the last delay value we notified about per train, so we only notify
// when the delay actually changes (not on every poll cycle).
const lastNotifiedDelay = new Map<string, number>();

function trainKey(train: Train): string {
  return `${train.tripId}|${train.fromCode}|${train.toCode}`;
}

async function loadPrefs(): Promise<NotificationPrefs> {
  cachedPrefs = await TrainStorageService.getNotificationPrefs();
  return cachedPrefs;
}

function hasAnyFeatureEnabled(prefs: NotificationPrefs): boolean {
  return (
    prefs.morningAlerts || prefs.departureReminders || prefs.delayAlerts || prefs.arrivalAlerts || prefs.liveActivities
  );
}

// Lazy-load widget handles — expo-widgets requires native modules.
// The try/catch handles Expo Go or missing native module gracefully.
function getWidgetHandles() {
  if (Platform.OS !== 'ios') return null;
  try {
    const { nextTrainWidget } = require('../widgets/NextTrainWidget');
    return { nextTrainWidget };
  } catch {
    return null;
  }
}

function refreshTrainWidgets(trains: Train[]): void {
  try {
    const widgets = getWidgetHandles();
    if (!widgets) return;
    widgets.nextTrainWidget.updateSnapshot(selectNextTrain(trains));
  } catch (e) {
    logger.error('[Widget] Failed to refresh train widgets:', e);
  }
}

function isArrived(train: Train): boolean {
  // Future trains haven't arrived
  if (train.daysAway > 0) return false;
  const now = new Date();
  const { arriveDate } = getAdjustedTrainDates(train, now);
  const delay = train.realtime?.arrivalDelay ?? train.realtime?.delay ?? 0;
  const adjustedArrival = new Date(arriveDate.getTime() + delay * 60 * 1000);
  return now >= adjustedArrival;
}

export const TrainActivityManager = {
  async onTrainSaved(train: Train): Promise<void> {
    const prefs = await loadPrefs();

    // Refresh widget regardless of notification prefs
    const allTrains = await TrainStorageService.getSavedTrains();
    refreshTrainWidgets(allTrains);

    if (!hasAnyFeatureEnabled(prefs)) return;

    if (prefs.morningAlerts || prefs.departureReminders) {
      await NotificationService.scheduleAllForTrain(train);
    }

    if (prefs.liveActivities && LiveActivityService.isTrainActiveNow(train)) {
      await LiveActivityService.startForTrain(train).catch(e => logger.error('[TrainActivityManager] Failed to start live activity:', e));
    }
  },

  async onTrainDeleted(tripId: string, fromCode: string, toCode: string): Promise<void> {
    await NotificationService.cancelRemindersForTrain(tripId, fromCode, toCode);
    await LiveActivityService.endForTrain(tripId, fromCode, toCode);
    const deletedKey = `${tripId}|${fromCode}|${toCode}`;
    sentArrivalAlerts.delete(deletedKey);
    lastNotifiedDelay.delete(deletedKey);
    await TrainStorageService.clearArrivalAlert(deletedKey);
    await TrainStorageService.clearLastNotifiedDelay(deletedKey);

    const remaining = await TrainStorageService.getSavedTrains();
    refreshTrainWidgets(remaining);
  },

  async onTrainArchived(train: Train): Promise<void> {
    await NotificationService.cancelRemindersForTrain(train.tripId || '', train.fromCode, train.toCode);
    await LiveActivityService.endForTrain(train.tripId || '', train.fromCode, train.toCode);
    const archivedKey = trainKey(train);
    sentArrivalAlerts.delete(archivedKey);
    lastNotifiedDelay.delete(archivedKey);
    await TrainStorageService.clearArrivalAlert(archivedKey);
    await TrainStorageService.clearLastNotifiedDelay(archivedKey);

    const remaining = await TrainStorageService.getSavedTrains();
    refreshTrainWidgets(remaining);
  },

  async onRealtimeUpdate(oldTrains: Train[], newTrains: Train[]): Promise<void> {
    refreshTrainWidgets(newTrains);

    const prefs = cachedPrefs;
    if (!hasAnyFeatureEnabled(prefs)) return;

    for (const newTrain of newTrains) {
      if (newTrain.daysAway > 0) continue;

      const key = trainKey(newTrain);
      const oldTrain = oldTrains.find(
        t => t.tripId === newTrain.tripId && t.fromCode === newTrain.fromCode && t.toCode === newTrain.toCode
      );

      // Delay alerts + reschedule departure reminder when delay changes
      if (newTrain.realtime?.delay != null) {
        const newDelay = newTrain.realtime.delay;
        const prevNotified = lastNotifiedDelay.get(key);
        const oldDelay = prevNotified ?? oldTrain?.realtime?.delay ?? 0;
        if (prevNotified === undefined || newDelay !== prevNotified) {
          lastNotifiedDelay.set(key, newDelay);
          TrainStorageService.setLastNotifiedDelay(key, newDelay).catch(e => logger.warn('Failed to persist lastNotifiedDelay', e));
          if (prevNotified !== undefined && Math.abs(newDelay - oldDelay) >= 5) {
            if (prefs.delayAlerts) {
              await NotificationService.sendDelayAlert(newTrain, oldDelay, newDelay);
            }
            // Reschedule departure reminder with updated delay-adjusted time
            if (prefs.departureReminders) {
              await NotificationService.scheduleDepartureReminder(newTrain);
            }
          }
        }
      }

      // Update Live Activities
      if (prefs.liveActivities) {
        if (LiveActivityService.hasActivityForTrain(newTrain)) {
          await LiveActivityService.updateForTrain(newTrain);
        } else if (LiveActivityService.isTrainActiveNow(newTrain)) {
          await LiveActivityService.startForTrain(newTrain).catch(e => logger.error('[TrainActivityManager] Failed to start live activity:', e));
        }
      }

      // Arrival detection
      if (prefs.arrivalAlerts && !sentArrivalAlerts.has(key) && isArrived(newTrain)) {
        sentArrivalAlerts.add(key);
        await TrainStorageService.markArrivalAlertSent(key);
        await NotificationService.sendArrivalAlert(newTrain);

        if (prefs.liveActivities) {
          await LiveActivityService.endForTrain(newTrain.tripId || '', newTrain.fromCode, newTrain.toCode);
        }
      }
    }
  },

  async onAppStartup(trains: Train[]): Promise<void> {
    // Refresh widgets on every startup
    refreshTrainWidgets(trains);

    // Restore persisted arrival alert dedup set
    const persisted = await TrainStorageService.getSentArrivalAlerts();
    for (const key of persisted) sentArrivalAlerts.add(key);

    // Restore persisted delay dedup map
    const persistedDelays = await TrainStorageService.getLastNotifiedDelays();
    for (const [key, delay] of persistedDelays) lastNotifiedDelay.set(key, delay);

    const prefs = await loadPrefs();
    if (!hasAnyFeatureEnabled(prefs)) return;

    // Start Live Activities for currently active trains
    if (prefs.liveActivities) {
      for (const train of trains) {
        if (LiveActivityService.isTrainActiveNow(train)) {
          await LiveActivityService.startForTrain(train).catch(e => logger.error('[TrainActivityManager] Failed to start live activity:', e));
        }
      }
    }

    // Register background task if any feature needs it
    if (prefs.delayAlerts || prefs.arrivalAlerts || prefs.liveActivities) {
      await BackgroundTaskService.register();
    }

    logger.info(`[TrainActivityManager] Startup complete, ${trains.length} trains`);
  },

  async onPrefsChanged(prefs: NotificationPrefs, trains: Train[]): Promise<void> {
    cachedPrefs = prefs;
    await TrainStorageService.saveNotificationPrefs(prefs);
    refreshTrainWidgets(trains);

    if (!hasAnyFeatureEnabled(prefs)) {
      await NotificationService.cancelAllReminders();
      await LiveActivityService.endAll();
      await BackgroundTaskService.unregister();
      return;
    }

    // Reschedule notifications based on new prefs
    if (prefs.morningAlerts || prefs.departureReminders) {
      await NotificationService.rescheduleAllReminders(trains);
    } else {
      await NotificationService.cancelAllReminders();
    }

    // Manage Live Activities
    if (prefs.liveActivities) {
      for (const train of trains) {
        if (LiveActivityService.isTrainActiveNow(train) && !LiveActivityService.hasActivityForTrain(train)) {
          await LiveActivityService.startForTrain(train).catch(e => logger.error('[TrainActivityManager] Failed to start live activity:', e));
        }
      }
    } else {
      await LiveActivityService.endAll();
    }

    // Register/unregister background task
    if (prefs.delayAlerts || prefs.arrivalAlerts || prefs.liveActivities) {
      await BackgroundTaskService.register();
    } else {
      await BackgroundTaskService.unregister();
    }
  },
};
