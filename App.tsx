import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect } from 'react';
import { Alert, LogBox, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

LogBox.ignoreLogs([
  'Cannot find native module \'ExpoWidgets\'',
  'Cannot find native module \'ExpoUI\'',
]);
import { ErrorBoundary } from './components/ErrorBoundary';
import { HapticsProvider } from './context/HapticsContext';
import { ThemeProvider } from './context/ThemeContext';
import MapScreen from './screens/MapScreen';
import './services/background-tasks';
import { info } from './utils/logger';

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

export default function App() {
  useEffect(() => {
    const version = Constants.expoConfig?.version ?? 'unknown';
    info(`[App] Tracky starting — v${version}, ${Platform.OS} ${Platform.Version}`);

    AsyncStorage.getItem('hasSeenWelcome').then((seen) => {
      if (!seen) {
        Alert.alert(
          'Welcome to Tracky Early Access!',
          'Thanks for trying Tracky! This is an early access release, so there may be bugs in certain places.\n\nFeel free to email him@jasonxu.me or report issues on GitHub (found in Settings) if you run into anything.',
          [{ text: 'Got it', onPress: () => AsyncStorage.setItem('hasSeenWelcome', 'true') }],
        );
      }
    });
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <HapticsProvider>
          <ErrorBoundary>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <MapScreen />
              <StatusBar style="auto" />
            </GestureHandlerRootView>
          </ErrorBoundary>
        </HapticsProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
