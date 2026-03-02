import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ensureFreshGTFS, isCacheStale, loadCachedGTFS } from '../services/gtfs-sync';
import { logger } from '../utils/logger';

interface GTFSRefreshState {
  isRefreshing: boolean;
  isLoadingCache: boolean;
  refreshProgress: number;
  refreshStep: string;
}

interface GTFSRefreshContextType extends GTFSRefreshState {
  /** Initialize GTFS on app startup (load cache, auto-refresh if stale) */
  initializeGTFS: (onCacheLoaded?: () => void) => Promise<void>;
  /** Manual refresh triggered from settings */
  triggerRefresh: () => void;
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
  const hasInitialized = useRef(false);
  const onRefreshCompleteRef = useRef(onRefreshComplete);
  onRefreshCompleteRef.current = onRefreshComplete;

  const runRefresh = useCallback(async (force: boolean) => {
    setIsRefreshing(true);
    setRefreshProgress(0.05);
    setRefreshStep(force ? 'Forcing refresh' : 'Checking schedule');
    try {
      if (force) {
        await AsyncStorage.removeItem('GTFS_LAST_FETCH');
      }
      const result = await ensureFreshGTFS(update => {
        setRefreshProgress(update.progress);
        setRefreshStep(update.step + (update.detail ? ` • ${update.detail}` : ''));
      });
      if (result.usedCache && !force) {
        // Cache is fresh — force refresh anyway without asking
        runRefresh(true);
        return;
      }
      setRefreshProgress(1);
      setRefreshStep('Refresh complete');
      onRefreshCompleteRef.current?.();
      // Brief display of completion then clear
      setTimeout(() => {
        setIsRefreshing(false);
        setRefreshProgress(0);
        setRefreshStep('');
      }, 1200);
    } catch (error) {
      logger.error('GTFS refresh failed:', error);
      setRefreshStep('Refresh failed');
      setTimeout(() => {
        setIsRefreshing(false);
        setRefreshProgress(0);
        setRefreshStep('');
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

        // Check staleness in background
        const stale = await isCacheStale();
        if (stale) {
          runRefresh(false);
        }
      } else {
        // No cache at all — must fetch before app is usable
        setIsLoadingCache(false);
        runRefresh(false);
      }
    } catch (error) {
      logger.error('GTFS initialization failed:', error);
      setIsLoadingCache(false);
      setRefreshStep('');
    }
  }, [runRefresh]);

  const triggerRefresh = useCallback(() => {
    if (isRefreshing) return;
    runRefresh(false);
  }, [isRefreshing, runRefresh]);

  return (
    <GTFSRefreshContext.Provider
      value={{
        isRefreshing,
        isLoadingCache,
        refreshProgress,
        refreshStep,
        initializeGTFS,
        triggerRefresh,
      }}
    >
      {children}
    </GTFSRefreshContext.Provider>
  );
};
