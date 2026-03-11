import React, { createContext, useContext, useMemo } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { type ColorPalette, DarkColors, LightColors, getCloseButtonStyle } from '../constants/theme';

interface ThemeContextType {
  colors: ColorPalette;
  isDark: boolean;
  closeButtonStyle: ReturnType<typeof getCloseButtonStyle>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};

export const useColors = () => useTheme().colors;

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const scheme = useColorScheme();
  // On Android, always use dark theme (BlurView/transparency doesn't work well in light mode)
  const isDark = Platform.OS === 'android' || scheme !== 'light';
  const colors = isDark ? DarkColors : LightColors;

  const value = useMemo(
    () => ({ colors, isDark, closeButtonStyle: getCloseButtonStyle(colors) }),
    [colors, isDark]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
