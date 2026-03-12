export type TextShadowStyle = {
  textShadowColor?: string;
  textShadowOffset?: { width: number; height: number };
  textShadowRadius?: number;
};

export type ColorPalette = {
  primary: string;
  secondary: string;
  tertiary: string;
  accent: string;
  accentBlue: string;
  success: string;
  error: string;
  delayed: string;
  inProgress: string;
  shadow: string;
  background: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  border: {
    primary: string;
    secondary: string;
  };
  textShadow: TextShadowStyle;
};

/** Spread text shadow onto every style that has `fontSize` (i.e. text styles). */
export function withTextShadow<T extends Record<string, any>>(
  styles: T,
  shadow: TextShadowStyle,
): T {
  if (!shadow.textShadowColor) return styles;
  const result: any = {};
  for (const [key, style] of Object.entries(styles)) {
    if (style && typeof style === 'object' && 'fontSize' in style) {
      result[key] = { ...style, ...shadow };
    } else {
      result[key] = style;
    }
  }
  return result;
}

export const DarkColors: ColorPalette = {
  primary: '#fff',
  secondary: 'rgba(255, 255, 255, 0.5)',
  tertiary: 'rgba(255, 255, 255, 0.2)',
  accent: '#FF6B35',
  accentBlue: '#FFFFFF',
  success: '#10B981',
  error: '#EF4444',
  delayed: '#EF4444',
  inProgress: '#10B981',
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
  textShadow: {},
};

export const LightColors: ColorPalette = {
  primary: '#000',
  secondary: 'rgba(0, 0, 0, 0.5)',
  tertiary: 'rgba(0, 0, 0, 0.2)',
  accent: '#FF6B35',
  accentBlue: '#60A5FA',
  success: '#059669',
  error: '#DC2626',
  delayed: '#DC2626',
  inProgress: '#059669',
  shadow: 'rgba(0, 0, 0, 0.1)',
  background: {
    primary: '#FFFFFF',
    secondary: '#F4F4F5',
    tertiary: '#E4E4E7',
  },
  border: {
    primary: '#D4D4D8',
    secondary: '#E4E4E7',
  },
  textShadow: {},
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

export const getCloseButtonStyle = (colors: ColorPalette, isDark: boolean) => ({
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: isDark ? colors.background.secondary : 'transparent',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  borderWidth: 1,
  borderColor: colors.border.primary,
});

