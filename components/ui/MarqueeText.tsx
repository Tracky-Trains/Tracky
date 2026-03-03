import React from 'react';
import { StyleProp, Text, TextStyle, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface MarqueeTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
}

export default function MarqueeText({ text, style }: MarqueeTextProps) {
  const translateX = useSharedValue(0);
  const [textWidth, setTextWidth] = React.useState(0);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const needsMarquee = textWidth > containerWidth && containerWidth > 0;

  React.useEffect(() => {
    if (!needsMarquee) {
      translateX.value = 0;
      return;
    }
    const overflow = textWidth - containerWidth;
    translateX.value = withRepeat(
      withSequence(
        withDelay(1500, withTiming(-overflow, { duration: overflow * 25, easing: Easing.linear })),
        withDelay(1500, withTiming(0, { duration: overflow * 25, easing: Easing.linear })),
      ),
      -1,
    );
  }, [needsMarquee, textWidth, containerWidth]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View
      style={{ overflow: 'hidden' }}
      onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {/* Hidden text to measure full intrinsic width */}
      <Text
        style={[style, { position: 'absolute', opacity: 0 }]}
        onLayout={e => setTextWidth(e.nativeEvent.layout.width)}
      >
        {text}
      </Text>
      {/* Visible scrolling text */}
      <Animated.View style={[{ width: textWidth > 0 ? textWidth : undefined }, animatedStyle]}>
        <Text style={style}>{text}</Text>
      </Animated.View>
    </View>
  );
}
