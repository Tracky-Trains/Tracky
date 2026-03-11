import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { ensureFreshGTFS, isCacheStale, loadCachedGTFS } from '../services/gtfs-sync';
import { LocationSuggestionsService } from '../services/location-suggestions';
import { gtfsParser } from '../utils/gtfs-parser';
import { logger } from '../utils/logger';

interface GTFSRefreshState {
  isRefreshing: boolean;
  isLoadingCache: boolean;
  refreshProgress: number;
  refreshStep: string;
  refreshFailed: boolean;
}

interface GTFSRefreshContextType extends GTFSRefreshState {
  /** Initialize GTFS on app startup (load cache, auto-refresh if stale) */
  initializeGTFS: (onCacheLoaded?: () => void) => Promise<void>;
  /** Manual refresh triggered from settings */
  triggerRefresh: () => void;
  /** Dismiss the persistent failure indicator */
  dismissRefreshFailure: () => void;
  /** Debug: show loading screen for 5 seconds */
  debugShowLoadingScreen: () => void;
}

const GTFSRefreshContext = createContext<GTFSRefreshContextType | undefined>(undefined);

export const useGTFSRefresh = () => {
  const ctx = useContext(GTFSRefreshContext);
  if (!ctx) throw new Error('useGTFSRefresh must be used within GTFSRefreshProvider');
  return ctx;
};

export const GTFSRefreshProvider: React.FC<{ children: React.ReactNode; onRefreshComplete?: () => void }> = ({
  children,
  onRefreshComplete,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingCache, setIsLoadingCache] = useState(true);
  const [refreshProgress, setRefreshProgress] = useState(0);
  const [refreshStep, setRefreshStep] = useState('');
  const [refreshFailed, setRefreshFailed] = useState(false);
  const hasInitialized = useRef(false);
  const onRefreshCompleteRef = useRef(onRefreshComplete);
  onRefreshCompleteRef.current = onRefreshComplete;

  const runRefresh = useCallback(async (force: boolean) => {
    logger.info(`[GTFS] Starting refresh (force=${force})`);
    setIsRefreshing(true);
    setRefreshProgress(0.05);
    setRefreshStep(force ? 'Forcing refresh' : 'Checking schedule');
    try {
      if (force) {
        await AsyncStorage.removeItem('GTFS_LAST_FETCH');
      }
      const result = await ensureFreshGTFS(update => {
        setRefreshProgress(update.progress);
        setRefreshStep(update.step + (update.detail ? ` · ${update.detail}` : ''));
      });
      if (result.usedCache && !force) {
        // Cache was still valid — no download needed
      }
      setRefreshProgress(1);
      setRefreshStep('Refresh complete');
      setRefreshFailed(false);
      logger.info(`[GTFS] Refresh complete (usedCache=${result.usedCache})`);
      LocationSuggestionsService.initialize(gtfsParser).catch(e => logger.warn('LocationSuggestionsService.initialize failed', e));
      onRefreshCompleteRef.current?.();
      // Brief display of completion then clear
      setTimeout(() => {
        setIsRefreshing(false);
        setRefreshProgress(0);
        setRefreshStep('');
      }, 1200);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`GTFS refresh failed: ${msg}`, error);
      setRefreshStep(`Schedule update failed: ${msg}`);
      setRefreshFailed(true);
      setTimeout(() => {
        setIsRefreshing(false);
        setRefreshProgress(0);
      }, 2000);
    }
  }, []);

  const initializeGTFS = useCallback(async (onCacheLoaded?: () => void) => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    setIsLoadingCache(true);
    setRefreshStep('Loading cached data...');
    setRefreshProgress(0.1);

    try {
      const loaded = await loadCachedGTFS();
      if (loaded) {
        // Cache loaded — app is usable now
        setIsLoadingCache(false);
        setRefreshProgress(0);
        setRefreshStep('');
        onCacheLoaded?.();
        SplashScreen.hideAsync();

        // Pre-compute location-based suggestions in background
        LocationSuggestionsService.initialize(gtfsParser).catch(e => logger.warn('LocationSuggestionsService.initialize failed', e));

        // Check staleness in background
        const stale = await isCacheStale();
        if (stale) {
          runRefresh(false);
        }
      } else {
        // No cache at all — hide splash so user sees refresh progress UI
        setIsLoadingCache(false);
        SplashScreen.hideAsync();
        runRefresh(false);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`GTFS initialization failed: ${msg}`, error);
      setIsLoadingCache(false);
      setRefreshStep('');
      SplashScreen.hideAsync();
      Alert.alert(
        'Unable to Load Schedules',
        'Tracky could not load train schedule data. Please check your internet connection and restart the app.',
        [{ text: 'Retry', onPress: () => { hasInitialized.current = false; initializeGTFS(onCacheLoaded); } }, { text: 'OK' }]
      );
    }
  }, [runRefresh]);

  const triggerRefresh = useCallback(() => {
    if (isRefreshing) return;
    setRefreshFailed(false);
    runRefresh(false);
  }, [isRefreshing, runRefresh]);

  const dismissRefreshFailure = useCallback(() => {
    setRefreshFailed(false);
    setRefreshStep('');
  }, []);

  const debugShowLoadingScreen = useCallback(() => {
    setIsLoadingCache(true);
    setTimeout(() => setIsLoadingCache(false), 5000);
  }, []);

  const value = useMemo(
    () => ({
      isRefreshing,
      isLoadingCache,
      refreshProgress,
      refreshStep,
      refreshFailed,
      initializeGTFS,
      triggerRefresh,
      dismissRefreshFailure,
      debugShowLoadingScreen,
    }),
    [isRefreshing, isLoadingCache, refreshProgress, refreshStep, refreshFailed, initializeGTFS, triggerRefresh, dismissRefreshFailure, debugShowLoadingScreen]
  );

  return (
    <GTFSRefreshContext.Provider value={value}>
      {children}
    </GTFSRefreshContext.Provider>
  );
};
