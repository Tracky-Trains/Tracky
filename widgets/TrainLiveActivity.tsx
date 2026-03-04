import { Text, VStack, HStack, Spacer, Image } from '@expo/ui/swift-ui';
import {
  foregroundStyle,
  font,
  padding,
  background,
  cornerRadius,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityLayout } from 'expo-widgets';

export interface TrainActivityProps {
  trainNumber: string;
  routeName: string;
  fromCode: string;
  toCode: string;
  from: string;
  to: string;
  departTime: string;
  arriveTime: string;
  delayMinutes: number;
  status: string;
  lastUpdated: number;
}

// SwiftUI text style approximations
const headline = font({ size: 17, weight: 'semibold' });
const subheadlineBold = font({ size: 15, weight: 'bold' });
const title3Bold = font({ size: 20, weight: 'bold' });
const captionBold = font({ size: 12, weight: 'bold' });
const caption = font({ size: 12 });
const caption2 = font({ size: 11 });
const caption2Bold = font({ size: 11, weight: 'bold' });

function delayColor(delay: number): string {
  return delay > 0 ? '#EF4444' : '#22C55E';
}

function delayText(delay: number): string {
  if (delay > 0) return `+${delay}m`;
  if (delay < 0) return `${delay}m`;
  return 'On Time';
}

function statusLabel(delay: number): string {
  if (delay > 0) {
    const h = Math.floor(delay / 60);
    const m = delay % 60;
    if (h > 0 && m > 0) return `Delayed ${h}h${m}m`;
    if (h > 0) return `Delayed ${h}h`;
    return `Delayed ${m}m`;
  }
  if (delay < 0) {
    return `${-delay}m early`;
  }
  return 'On Time';
}

function TrainLiveActivityLayout(props?: TrainActivityProps): LiveActivityLayout {
  'widget';

  const delay = props?.delayMinutes ?? 0;
  const color = delayColor(delay);

  return {
    // Lock Screen / Notification Center banner
    banner: (
      <VStack spacing={12} modifiers={[padding({ all: 16 })]}>
        {/* Header */}
        <HStack>
          <Text modifiers={[headline, foregroundStyle('#FFFFFF')]}>Train {props?.trainNumber}</Text>
          <Spacer />
          <Text
            modifiers={[
              subheadlineBold,
              foregroundStyle(color),
              padding({ leading: 8, trailing: 8, top: 4, bottom: 4 }),
              background(color + '4D'),
              cornerRadius(12),
            ]}
          >
            {statusLabel(delay)}
          </Text>
        </HStack>

        {/* Route row */}
        <HStack spacing={8}>
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[title3Bold, foregroundStyle('#FFFFFF')]}>{props?.fromCode}</Text>
            <Text modifiers={[caption, foregroundStyle('#FFFFFFB3')]}>{props?.departTime}</Text>
          </VStack>
          <Spacer />
          <Text modifiers={[foregroundStyle('#FFFFFF80')]}>→</Text>
          <Spacer />
          <VStack alignment="trailing" spacing={2}>
            <Text modifiers={[title3Bold, foregroundStyle('#FFFFFF')]}>{props?.toCode}</Text>
            <Text modifiers={[caption, foregroundStyle('#FFFFFFB3')]}>{props?.arriveTime}</Text>
          </VStack>
        </HStack>

        {/* Route name footer */}
        <Text modifiers={[caption, foregroundStyle('#FFFFFF80')]}>{props?.routeName}</Text>
      </VStack>
    ),

    // Dynamic Island compact: leading = tram icon
    compactLeading: <Image systemName="tram.fill" size={14} color="#007AFF" />,

    // Dynamic Island compact: trailing = delay text
    compactTrailing: (
      <Text modifiers={[caption2Bold, foregroundStyle(color)]}>{delayText(delay)}</Text>
    ),

    // Dynamic Island minimal: tram icon
    minimal: <Image systemName="tram.fill" size={12} color="#007AFF" />,

    // Dynamic Island expanded: leading
    expandedLeading: (
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ size: 17, weight: 'bold' })]}>{props?.fromCode}</Text>
        <Text modifiers={[caption2, foregroundStyle('secondary')]}>{props?.departTime}</Text>
      </VStack>
    ),

    // Dynamic Island expanded: center
    expandedCenter: (
      <VStack spacing={2}>
        <Text modifiers={[captionBold]}>Train {props?.trainNumber}</Text>
        <Text modifiers={[caption2, foregroundStyle(color)]}>{statusLabel(delay)}</Text>
      </VStack>
    ),

    // Dynamic Island expanded: trailing
    expandedTrailing: (
      <VStack alignment="trailing" spacing={2}>
        <Text modifiers={[font({ size: 17, weight: 'bold' })]}>{props?.toCode}</Text>
        <Text modifiers={[caption2, foregroundStyle('secondary')]}>{props?.arriveTime}</Text>
      </VStack>
    ),

    // Dynamic Island expanded: bottom
    expandedBottom: (
      <Text modifiers={[caption2, foregroundStyle('secondary')]}>{props?.routeName}</Text>
    ),
  };
}

export const trainLiveActivity = createLiveActivity<TrainActivityProps>(
  'TrainLiveActivity',
  TrainLiveActivityLayout
);
