/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const AppColors = {
  primary: '#fff',
  secondary: 'rgba(255, 255, 255, 0.5)',
  tertiary: 'rgba(255, 255, 255, 0.2)',
  accent: '#FF6B35',
  accentBlue: '#FFFFFF',
  success: '#10B981',
  error: '#EF4444',
  delayed: '#EF4444',
  shadow: '#000',
  background: {
    primary: '#18181B',
    secondary: '#1D1D1F',
    tertiary: '#29292D',
  },
  border: {
    primary: '#2C2C30',
    secondary: '#3A3A3F',
  },
};

export const FontSizes = {
  title: 28,
  searchLabel: 16,
  daysAway: 32,
  daysLabel: 12,
  trainNumber: 14,
  trainDate: 13,
  route: 13,
  timeCode: 12,
  timeValue: 13,
  timeLabel: 10,
};

export const FontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 32,
};

export const CloseButtonStyle = {
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: AppColors.background.secondary,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  borderWidth: 1,
  borderColor: AppColors.border.primary,
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
