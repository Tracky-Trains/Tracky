import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import type { Train } from '../types/train';
import { logger } from '../utils/logger';
import { Platform } from 'react-native';

// Lazy-load widget handles — expo-widgets requires native modules.
// The try/catch handles Expo Go or missing native module gracefully.
function getWidgetHandles() {
  if (Platform.OS !== 'ios') return null;
  try {
    const { nextTrainWidget } = require('../widgets/NextTrainWidget');
    const { travelStatsWidget } = require('../widgets/TravelStatsWidget');
    const { upcomingTrainsWidget } = require('../widgets/UpcomingTrainsWidget');
    return { nextTrainWidget, travelStatsWidget, upcomingTrainsWidget };
  } catch {
    return null;
  }
}

const BACKGROUND_TASK_NAME = 'TRACKY_TRAIN_UPDATE';

// Define the task at module level (required by expo-task-manager)
TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  try {
    logger.info('[BackgroundTask] Running train update');

    // Lazy-load heavy services only when background task actually runs
    const { TrainStorageService } = require('./storage') as typeof import('./storage');
    const { TrainAPIService } = require('./api') as typeof import('./api');
    const NotificationService = require('./notifications') as typeof import('./notifications');
    const LiveActivityService = require('./live-activity') as typeof import('./live-activity');
    const { parseTimeToDate } = require('../utils/time-formatting') as typeof import('../utils/time-formatting');
    const { selectNextTrain, selectUpcomingTrains, buildTravelStats } = require('./widget-data') as typeof import('./widget-data');

    const prefs = await TrainStorageService.getNotificationPrefs();
    const trains = await TrainStorageService.getSavedTrains();

    // Only process today's trains
    const todayTrains = trains.filter(t => t.daysAway === 0);
    if (todayTrains.length === 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    let hasNewData = false;

    // Load persistent dedup sets so background task shares state with foreground
    const sentAlerts = await TrainStorageService.getSentArrivalAlerts();
    const lastNotifiedDelays = await TrainStorageService.getLastNotifiedDelays();

    function bgTrainKey(t: Train): string {
      return `${t.tripId}|${t.fromCode}|${t.toCode}`;
    }

    for (const train of todayTrains) {
      const updated = await TrainAPIService.refreshRealtimeData(train);

      // Delay alerts — use persisted dedup map to avoid re-notifying
      if (prefs.delayAlerts && updated.realtime?.delay != null) {
        const key = bgTrainKey(updated);
        const newDelay = updated.realtime.delay;
        const prevNotified = lastNotifiedDelays.get(key);
        if (prevNotified === undefined) {
          // Seed cycle: record current delay, don't notify
          lastNotifiedDelays.set(key, newDelay);
          await TrainStorageService.setLastNotifiedDelay(key, newDelay);
        } else if (newDelay !== prevNotified) {
          const oldDelay = prevNotified;
          lastNotifiedDelays.set(key, newDelay);
          await TrainStorageService.setLastNotifiedDelay(key, newDelay);
          if (Math.abs(newDelay - oldDelay) >= 5) {
            await NotificationService.sendDelayAlert(updated, oldDelay, newDelay);
            hasNewData = true;
          }
        }
      }

      // Update Live Activities
      if (prefs.liveActivities && LiveActivityService.hasActivityForTrain(updated)) {
        await LiveActivityService.updateForTrain(updated);
        hasNewData = true;
      }

      // Arrival detection (simple: arrival time + delay has passed)
      const key = bgTrainKey(updated);
      if (prefs.arrivalAlerts && updated.arriveTime && !sentAlerts.has(key)) {
        const now = new Date();
        const arriveDate = parseTimeToDate(updated.arriveTime, now);
        // Account for multi-day journeys
        if (updated.arriveDayOffset) {
          arriveDate.setDate(arriveDate.getDate() + updated.arriveDayOffset);
        }

        const delay = updated.realtime?.arrivalDelay ?? updated.realtime?.delay ?? 0;
        const adjustedArrival = new Date(arriveDate.getTime() + delay * 60 * 1000);

        if (now >= adjustedArrival) {
          sentAlerts.add(key);
          await TrainStorageService.markArrivalAlertSent(key);
          await NotificationService.sendArrivalAlert(updated);
          hasNewData = true;
        }
      }
    }

    // Refresh widget snapshots after processing
    try {
      const widgets = getWidgetHandles();
      if (widgets) {
        const allTrains = await TrainStorageService.getSavedTrains();
        widgets.nextTrainWidget.updateSnapshot(selectNextTrain(allTrains));
        widgets.upcomingTrainsWidget.updateSnapshot(selectUpcomingTrains(allTrains));
        const history = await TrainStorageService.getTripHistory();
        widgets.travelStatsWidget.updateSnapshot(buildTravelStats(history));
      }
    } catch (widgetErr) {
      logger.error('[BackgroundTask] Widget refresh failed:', widgetErr);
    }

    return hasNewData ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (e) {
    logger.error('[BackgroundTask] Failed:', e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export const BackgroundTaskService = {
  async register(): Promise<void> {
    try {
      const status = await BackgroundFetch.getStatusAsync();
      if (status === BackgroundFetch.BackgroundFetchStatus.Denied) {
        logger.warn('[BackgroundTask] Background fetch denied by system');
        return;
      }

      await BackgroundFetch.registerTaskAsync(BACKGROUND_TASK_NAME, {
        minimumInterval: 15 * 60, // 15 minutes minimum
        stopOnTerminate: false,
        startOnBoot: true,
      });
      logger.info('[BackgroundTask] Registered successfully');
    } catch (e) {
      logger.error('[BackgroundTask] Registration failed:', e);
    }
  },

  async unregister(): Promise<void> {
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME);
      if (isRegistered) {
        await BackgroundFetch.unregisterTaskAsync(BACKGROUND_TASK_NAME);
        logger.info('[BackgroundTask] Unregistered');
      }
    } catch (e) {
      logger.error('[BackgroundTask] Unregister failed:', e);
    }
  },
};
