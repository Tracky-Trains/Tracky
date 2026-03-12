import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Platform, StatusBar, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { BorderRadius, Spacing } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import { medium as hapticMedium } from '../../utils/haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const DEFAULT_SNAP_POINTS = {
  MIN: SCREEN_HEIGHT * 0.35,
  HALF: SCREEN_HEIGHT * 0.5,
  MAX: SCREEN_HEIGHT * 0.95,
};

/** Imperative handle exposed by SlideUpModal via ref */
export interface SlideUpModalHandle {
  snapToPoint: (point: 'min' | 'half' | 'max') => void;
  dismiss: (fast?: boolean) => void;
  slideIn: (targetSnap?: 'min' | 'half' | 'max') => void;
}

export const SlideUpModalContext = createContext<{
  isFullscreen: boolean;
  isCollapsed: boolean;
  scrollOffset: SharedValue<number>;
  panRef: React.RefObject<any>;
  modalHeight: SharedValue<number>;
  contentOpacity: SharedValue<number>;
  snapToPoint?: (point: 'min' | 'half' | 'max') => void;
  setGestureEnabled?: (enabled: boolean) => void;
}>({
  isFullscreen: false,
  isCollapsed: false,
  scrollOffset: { value: 0 } as SharedValue<number>,
  panRef: { current: null },
  modalHeight: { value: DEFAULT_SNAP_POINTS.HALF } as SharedValue<number>,
  contentOpacity: { value: 1 } as SharedValue<number>,
});

interface SlideUpModalProps {
  children: React.ReactNode;
  onSnapChange?: (snapPoint: 'min' | 'half' | 'max') => void;
  onHeightChange?: (height: number) => void;
  onDismiss?: () => void;
  minSnapPercent?: number;
  initialSnap?: 'min' | 'half' | 'max';
  startHidden?: boolean;
}

export default React.forwardRef<SlideUpModalHandle, SlideUpModalProps>(function SlideUpModal(
  { children, onSnapChange, onHeightChange, onDismiss, minSnapPercent = 0.35, initialSnap = 'half', startHidden = false }: SlideUpModalProps,
  ref: React.Ref<SlideUpModalHandle>
) {
  const { colors, isDark } = useTheme();
  // Capture color strings as locals for worklet closures
  const bgPrimary = colors.background.primary;
  const borderPrimary = isDark ? colors.border.primary : 'transparent';
  const shadowColor = colors.shadow;

  const screenHeight = Dimensions.get('screen').height;
  const windowHeight = Dimensions.get('window').height;
  const safeAreaBottomInset = screenHeight - windowHeight;
  const statusBarHeight = StatusBar.currentHeight || 0;

  const SNAP_POINTS = React.useMemo(
    () => ({
      MIN: SCREEN_HEIGHT * minSnapPercent,
      HALF: DEFAULT_SNAP_POINTS.HALF,
      MAX: DEFAULT_SNAP_POINTS.MAX,
    }),
    [minSnapPercent]
  );

  const getInitialHeight = () => {
    if (initialSnap === 'min') return SNAP_POINTS.MIN;
    if (initialSnap === 'max') return SNAP_POINTS.MAX;
    return SNAP_POINTS.HALF;
  };

  const translateY = useSharedValue(SCREEN_HEIGHT);
  const context = useSharedValue({ y: 0 });
  const currentSnap = useSharedValue<'min' | 'half' | 'max'>(initialSnap);
  const scrollOffset = useSharedValue(0);
  const modalHeight = useSharedValue(getInitialHeight());
  const [isFullscreen, setIsFullscreen] = useState(initialSnap === 'max');
  const [isCollapsed, setIsCollapsed] = useState(initialSnap === 'min');
  const [gestureEnabled, setGestureEnabled] = useState(true);
  const panRef = React.useRef<any>(undefined);
  const onSnapChangeRef = useRef(onSnapChange);
  onSnapChangeRef.current = onSnapChange;
  const onHeightChangeRef = useRef(onHeightChange);
  onHeightChangeRef.current = onHeightChange;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const panStartY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panDecided = useSharedValue(false);

  const contentOpacity = useDerivedValue(() => {
    const currentHeight = SCREEN_HEIGHT - translateY.value;
    const minHeight = SNAP_POINTS.MIN;
    const halfHeight = SNAP_POINTS.HALF;

    return interpolate(currentHeight, [minHeight, halfHeight], [0, 1], 'clamp');
  });

  const snapToPoint = useCallback((point: 'min' | 'half' | 'max') => {
    const snapPoint = point === 'min' ? SNAP_POINTS.MIN : point === 'half' ? SNAP_POINTS.HALF : SNAP_POINTS.MAX;
    const targetY = SCREEN_HEIGHT - snapPoint;

    currentSnap.value = point;
    modalHeight.value = snapPoint;

    onSnapChangeRef.current?.(point);
    onHeightChangeRef.current?.(snapPoint);

    runOnJS(setIsFullscreen)(point === 'max');
    runOnJS(setIsCollapsed)(point === 'min');

    translateY.value = withSpring(targetY, {
      damping: 60,
      stiffness: 500,
    });
  }, [SNAP_POINTS, translateY, currentSnap, modalHeight]);

  const dismiss = useCallback((fast?: boolean) => {
    if (fast) {
      translateY.value = withTiming(
        SCREEN_HEIGHT,
        { duration: 150, easing: Easing.out(Easing.quad) },
        finished => {
          if (finished && onDismissRef.current) {
            runOnJS(onDismissRef.current)();
          }
        }
      );
    } else {
      translateY.value = withSpring(
        SCREEN_HEIGHT,
        {
          damping: 60,
          stiffness: 500,
        },
        finished => {
          if (finished && onDismissRef.current) {
            runOnJS(onDismissRef.current)();
          }
        }
      );
    }
  }, [translateY]);

  const slideIn = useCallback((targetSnap: 'min' | 'half' | 'max' = 'half') => {
    const snapPoint =
      targetSnap === 'min' ? SNAP_POINTS.MIN : targetSnap === 'half' ? SNAP_POINTS.HALF : SNAP_POINTS.MAX;
    const targetY = SCREEN_HEIGHT - snapPoint;

    currentSnap.value = targetSnap;
    modalHeight.value = snapPoint;

    runOnJS(setIsFullscreen)(targetSnap === 'max');
    runOnJS(setIsCollapsed)(targetSnap === 'min');

    translateY.value = withSpring(targetY, {
      damping: 60,
      stiffness: 500,
    });
  }, [SNAP_POINTS, translateY, currentSnap, modalHeight]);

  React.useImperativeHandle(
    ref,
    () => ({
      snapToPoint,
      dismiss,
      slideIn,
    }),
    [snapToPoint, dismiss, slideIn]
  );

  useEffect(() => {
    if (startHidden) return;
    translateY.value = withSpring(SCREEN_HEIGHT - getInitialHeight(), {
      damping: 60,
      stiffness: 500,
    });
  }, []);

  const panGesture = Gesture.Pan()
    .withRef(panRef)
    .manualActivation(true)
    .enableTrackpadTwoFingerGesture(true)
    .maxPointers(1)
    .enabled(gestureEnabled)
    .onTouchesDown((event, stateManager) => {
      if (event.numberOfTouches > 1) {
        stateManager.fail();
        return;
      }
      panStartY.value = event.allTouches[0].absoluteY;
      panStartX.value = event.allTouches[0].absoluteX;
      panDecided.value = false;
    })
    .onTouchesMove((event, stateManager) => {
      if (panDecided.value || event.numberOfTouches === 0) return;
      if (event.numberOfTouches > 1) {
        stateManager.fail();
        panDecided.value = true;
        return;
      }

      const dy = event.allTouches[0].absoluteY - panStartY.value;
      const dx = event.allTouches[0].absoluteX - panStartX.value;

      if (Math.abs(dx) > 20) {
        stateManager.fail();
        panDecided.value = true;
        return;
      }

      if (Math.abs(dy) < 15) return;

      if (currentSnap.value !== 'max') {
        stateManager.activate();
        panDecided.value = true;
      } else if (scrollOffset.value > 1) {
        stateManager.fail();
        panDecided.value = true;
      } else if (dy > 0) {
        stateManager.activate();
        panDecided.value = true;
      } else {
        stateManager.fail();
        panDecided.value = true;
      }
    })
    .onStart(() => {
      context.value = { y: translateY.value };
    })
    .onUpdate(event => {
      const newY = context.value.y + event.translationY;
      translateY.value = Math.max(SCREEN_HEIGHT - SNAP_POINTS.MAX, Math.min(SCREEN_HEIGHT - SNAP_POINTS.MIN, newY));
    })
    .onEnd(event => {
      const velocity = event.velocityY;
      const currentHeight = SCREEN_HEIGHT - translateY.value;

      const QUICK_SWIPE_VELOCITY = 1000;

      let targetSnap: 'min' | 'half' | 'max';

      if (velocity < -QUICK_SWIPE_VELOCITY) {
        targetSnap = 'max';
      } else if (velocity > QUICK_SWIPE_VELOCITY) {
        targetSnap = 'min';
      } else {
        const distances = [
          { distance: Math.abs(currentHeight - SNAP_POINTS.MIN), key: 'min' as const },
          { distance: Math.abs(currentHeight - SNAP_POINTS.HALF), key: 'half' as const },
          { distance: Math.abs(currentHeight - SNAP_POINTS.MAX), key: 'max' as const },
        ];
        targetSnap = distances.reduce((prev, curr) => (curr.distance < prev.distance ? curr : prev)).key;
      }

      const targetHeight = SNAP_POINTS[targetSnap.toUpperCase() as 'MIN' | 'HALF' | 'MAX'];
      const targetY = SCREEN_HEIGHT - targetHeight;

      currentSnap.value = targetSnap;
      modalHeight.value = targetHeight;

      if (targetSnap !== 'max') {
        scrollOffset.value = 0;
      }

      runOnJS(setIsFullscreen)(targetSnap === 'max');
      runOnJS(setIsCollapsed)(targetSnap === 'min');
      runOnJS(hapticMedium)();

      if (onSnapChangeRef.current) {
        runOnJS(onSnapChangeRef.current)(targetSnap);
      }

      if (onHeightChangeRef.current) {
        runOnJS(onHeightChangeRef.current)(targetHeight);
      }

      translateY.value = withSpring(targetY, {
        damping: 60,
        stiffness: 500,
      });
    });

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  const animatedBorderRadius = useAnimatedStyle(() => {
    return {
      borderTopLeftRadius: BorderRadius.xl,
      borderTopRightRadius: BorderRadius.xl,
    };
  });

  const animatedBackground = useAnimatedStyle(() => {
    const currentHeight = SCREEN_HEIGHT - translateY.value;

    const halfHeight = SNAP_POINTS.HALF;
    const maxHeight = SNAP_POINTS.MAX;

    const progress = Math.max(0, Math.min(1, (currentHeight - halfHeight) / (maxHeight - halfHeight)));

    const borderOpacity = 1 - progress;

    return {
      borderColor: progress >= 1 ? bgPrimary : borderOpacity > 0.01 ? borderPrimary : 'transparent',
      borderWidth: 1,
    };
  });

  const animatedMargins = useAnimatedStyle(() => {
    const currentHeight = SCREEN_HEIGHT - translateY.value;

    const halfHeight = SNAP_POINTS.HALF;
    const maxHeight = SNAP_POINTS.MAX;

    const progress = Math.max(0, Math.min(1, (currentHeight - halfHeight) / (maxHeight - halfHeight)));

    const horizontalMargin = 10 * (1 - progress);

    const topMargin = 15 * progress;

    return {
      marginLeft: horizontalMargin,
      marginRight: horizontalMargin,
      marginTop: topMargin,
    };
  });

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[staticStyles.container, animatedStyle]}>
        <SlideUpModalContext.Provider
          value={useMemo(() => ({
            isFullscreen,
            isCollapsed,
            scrollOffset,
            panRef,
            modalHeight,
            contentOpacity,
            snapToPoint,
            setGestureEnabled,
          }), [isFullscreen, isCollapsed, scrollOffset, panRef, modalHeight, contentOpacity, snapToPoint])}
        >
          <Animated.View
            style={[
              { flex: 1, overflow: 'hidden', borderBottomWidth: 0, shadowColor, shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.25, shadowRadius: 20, elevation: 10 },
              animatedBorderRadius,
              animatedBackground,
              animatedMargins,
              isFullscreen && staticStyles.blurContainerFullscreen,
            ]}
          >
            <Animated.View style={[StyleSheet.absoluteFill, animatedBorderRadius, { overflow: 'hidden' }]}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: bgPrimary }]} />
              <Animated.View style={staticStyles.content}>
                <View style={staticStyles.handleContainer} />
                <View style={staticStyles.childrenContainer}>{children}</View>
              </Animated.View>
            </Animated.View>
          </Animated.View>
        </SlideUpModalContext.Provider>
      </Animated.View>
    </GestureDetector>
  );
});

const staticStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SCREEN_HEIGHT,
    zIndex: 1000,
  },
  blurContainerFullscreen: {
    borderWidth: 0,
    borderBottomWidth: 0,
    shadowOpacity: 0,
  },
  content: {
    flex: 1,
  },
  handleContainer: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    paddingTop: Spacing.md,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#71717A',
  },
  childrenContainer: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
  },
});
