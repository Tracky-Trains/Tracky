import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { TrainAPIService } from './api';
import * as LiveActivityService from './live-activity';
import * as NotificationService from './notifications';
import { TrainStorageService } from './storage';
import { selectNextTrain, buildTravelStats } from './widget-data';
import { nextTrainWidget } from '../widgets/NextTrainWidget';
import { travelStatsWidget } from '../widgets/TravelStatsWidget';
import { parseTimeToDate } from '../utils/time-formatting';
import { logger } from '../utils/logger';

const BACKGROUND_TASK_NAME = 'TRACKY_TRAIN_UPDATE';

// Define the task at module level (required by expo-task-manager)
TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  try {
    logger.info('[BackgroundTask] Running train update');

    const prefs = await TrainStorageService.getNotificationPrefs();
    const trains = await TrainStorageService.getSavedTrains();

    // Only process today's trains
    const todayTrains = trains.filter(t => t.daysAway === 0);
    if (todayTrains.length === 0) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    let hasNewData = false;

    for (const train of todayTrains) {
      const updated = await TrainAPIService.refreshRealtimeData(train);

      // Delay alerts
      if (prefs.delayAlerts && train.realtime?.delay != null && updated.realtime?.delay != null) {
        const oldDelay = train.realtime.delay;
        const newDelay = updated.realtime.delay;
        if (Math.abs(newDelay - oldDelay) >= 5) {
          await NotificationService.sendDelayAlert(updated, oldDelay, newDelay);
          hasNewData = true;
        }
      }

      // Update Live Activities
      if (prefs.liveActivities && LiveActivityService.hasActivityForTrain(updated)) {
        await LiveActivityService.updateForTrain(updated);
        hasNewData = true;
      }

      // Arrival detection (simple: arrival time + delay has passed)
      if (prefs.arrivalAlerts && updated.arriveTime) {
        const now = new Date();
        const arriveDate = parseTimeToDate(updated.arriveTime, now);
        // Account for multi-day journeys
        if (updated.arriveDayOffset) {
          arriveDate.setDate(arriveDate.getDate() + updated.arriveDayOffset);
        }

        const delay = updated.realtime?.arrivalDelay ?? updated.realtime?.delay ?? 0;
        const adjustedArrival = new Date(arriveDate.getTime() + delay * 60 * 1000);

        if (now >= adjustedArrival) {
          await NotificationService.sendArrivalAlert(updated);
          hasNewData = true;
        }
      }
    }

    // Refresh widget snapshots after processing
    try {
      const allTrains = await TrainStorageService.getSavedTrains();
      nextTrainWidget.updateSnapshot(selectNextTrain(allTrains));
      const history = await TrainStorageService.getTripHistory();
      travelStatsWidget.updateSnapshot(buildTravelStats(history));
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
