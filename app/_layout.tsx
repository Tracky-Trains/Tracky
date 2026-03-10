import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { LogBox, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

// expo-widgets / @expo/ui require native modules that aren't available in Expo Go
LogBox.ignoreLogs([
  'Cannot find native module \'ExpoWidgets\'',
  'Cannot find native module \'ExpoUI\'',
]);
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ThemeProvider } from '../context/ThemeContext';
import '../services/background-tasks';
import { info } from '../utils/logger';

// Keep splash visible until GTFS data is ready
SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const unstable_settings = {
  anchor: '/',
};

function RootLayout() {
  useEffect(() => {
    const version = Constants.expoConfig?.version ?? 'unknown';
    info(`[App] Tracky starting — v${version}, ${Platform.OS} ${Platform.Version}`);
  }, []);

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="light" />
        </GestureHandlerRootView>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default RootLayout;
