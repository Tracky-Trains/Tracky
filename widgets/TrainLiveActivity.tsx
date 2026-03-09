import { createLiveActivity, type LiveActivityLayout } from 'expo-widgets';
import { Text, VStack, HStack, Spacer, Image, ProgressView } from '@expo/ui/swift-ui';
import { foregroundStyle, font, padding, frame, background, clipShape, textCase, tint, progressViewStyle } from '@expo/ui/swift-ui/modifiers';

export interface TrainActivityProps {
  trainNumber: string;
  routeName: string;
  fromCode: string;
  toCode: string;
  from: string;
  to: string;
  departTime: string;
  arriveTime: string;
  departDelay: number;
  arrivalDelay: number;
  minutesUntilDeparture: number;
  minutesRemaining: number;
  progressFraction: number;
  status: string;
  lastUpdated: number;
}

function TrainLiveActivityLayout(props?: TrainActivityProps): LiveActivityLayout {
  'widget';

  function delayColor(delay: number): string {
    return delay > 0 ? '#EF4444' : '#22C55E';
  }

  function formatTimeRemaining(minutes: number): string {
    if (minutes <= 0) return 'Arrived';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

  function statusLabel(delay: number): string {
    if (delay > 0) {
      const h = Math.floor(delay / 60);
      const m = delay % 60;
      if (h > 0 && m > 0) return `Delayed ${h}h${m}m`;
      if (h > 0) return `Delayed ${h}h`;
      return `Delayed ${m}m`;
    }
    if (delay < 0) return `${-delay}m early`;
    return 'On Time';
  }

  const captionBold = font({ size: 12, weight: 'bold' });
  const caption2 = font({ size: 11 });
  const caption2Bold = font({ size: 11, weight: 'bold' });

  const departDelay = props?.departDelay ?? 0;
  const arrivalDelay = props?.arrivalDelay ?? 0;
  const departColor = delayColor(departDelay);
  const arrivalColor = delayColor(arrivalDelay);
  // Overall color for shared elements (progress bar, time remaining) uses arrival delay
  const color = arrivalColor;
  const timeRemaining = formatTimeRemaining(props?.minutesRemaining ?? 0);
  const toCode = props?.toCode ?? '';
  const progress = props?.progressFraction ?? 0;

  function delayLabel(delay: number): string {
    if (delay > 0) return `${delay}m late`;
    if (delay < 0) return `${-delay}m early`;
    return 'On time';
  }

  // 1 significant unit: "2h", "1h", "45m"
  function formatTimeShort(minutes: number): string {
    if (minutes <= 0) return '0m';
    if (minutes >= 60) return `${Math.floor(minutes / 60)}h`;
    return `${minutes}m`;
  }

  const minutesUntilDeparture = props?.minutesUntilDeparture ?? 0;
  const preDeparture = minutesUntilDeparture > 0 && minutesUntilDeparture <= 60;
  const compactColor = preDeparture ? departColor : arrivalColor;
  const compactStationCode = preDeparture ? (props?.fromCode ?? '') : toCode;

  return {
    // Lock Screen / Notification Center banner
    banner: (
      <VStack spacing={0} modifiers={[padding({ horizontal: 20, vertical: 14 })]}>
        {/* Header: train id left, app name right */}
        <HStack modifiers={[padding({ bottom: 12 })]}>
          <HStack spacing={7}>
            <Image
              systemName="tram.fill"
              size={12}
              color="#FFFFFF"
              modifiers={[padding({ all: 5 }), background(color), clipShape('circle')]}
            />
            <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle('#FFFFFF')]}>
              Train {props?.trainNumber}
            </Text>
          </HStack>
          <Spacer />
          <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle('#FFFFFF50')]}>Tracky</Text>
        </HStack>

        {/* Route row: FROM time ... tram ... time TO */}
        <HStack>
          <VStack alignment="leading" spacing={3}>
            <HStack spacing={5}>
              <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle('#FFFFFF')]}>{props?.fromCode}</Text>
              <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle(departColor)]}>{props?.departTime}</Text>
            </HStack>
            <Text modifiers={[font({ size: 12 }), foregroundStyle(departColor)]}>{delayLabel(departDelay)}</Text>
          </VStack>

          <Spacer />
          <Image systemName="tram.fill" size={14} color="#FFFFFF40" />
          <Spacer />

          <VStack alignment="trailing" spacing={3}>
            <HStack spacing={5}>
              <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle(arrivalColor)]}>{props?.arriveTime}</Text>
              <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle('#FFFFFF')]}>{props?.toCode}</Text>
            </HStack>
            <Text modifiers={[font({ size: 12 }), foregroundStyle(arrivalColor)]}>{delayLabel(arrivalDelay)}</Text>
          </VStack>
        </HStack>

        {/* Progress bar */}
        <ProgressView
          value={progress}
          modifiers={[
            progressViewStyle('linear'),
            tint(color),
            padding({ top: 14, bottom: 12 }),
          ]}
        />

        {/* Time remaining */}
        <VStack alignment="center" spacing={3}>
          <Text modifiers={[font({ size: 22, weight: 'bold', design: 'rounded' }), foregroundStyle(color)]}>
            {timeRemaining}
          </Text>
          <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle('#FFFFFF50'), textCase('uppercase')]}>
            Until arrival
          </Text>
        </VStack>
      </VStack>
    ),

    // Dynamic Island compact: leading
    compactLeading: preDeparture ? (
      <HStack spacing={5}>
        <Image
          systemName="arrow.up.right"
          size={9}
          color="#000000"
          modifiers={[padding({ all: 4 }), background(departColor), clipShape('circle')]}
        />
        <Text modifiers={[caption2Bold, foregroundStyle(departColor)]}>{minutesUntilDeparture}m</Text>
      </HStack>
    ) : (
      <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle(arrivalColor)]}>{timeRemaining}</Text>
    ),

    // Dynamic Island compact: trailing
    compactTrailing: (
      <HStack spacing={4} modifiers={[padding({ horizontal: 6, vertical: 3 }), background('#EAB308'), clipShape('capsule')]}>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle('#000000')]}>{compactStationCode}</Text>
      </HStack>
    ),

    // Dynamic Island minimal: tram icon
    minimal: <Image systemName="tram.fill" size={12} color={color} />,

    // Dynamic Island expanded: leading — station code + time, status below
    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 4 })]}>
        <HStack spacing={5}>
          <Text modifiers={[font({ size: 18, weight: 'bold' }), foregroundStyle('#FFFFFF')]}>{props?.fromCode}</Text>
          <Text modifiers={[font({ size: 18, weight: 'bold' }), foregroundStyle(departColor)]}>{props?.departTime}</Text>
        </HStack>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(departColor)]}>{delayLabel(departDelay)}</Text>
      </VStack>
    ),

    // Dynamic Island expanded: center — dots + tram + dots
    expandedCenter: (
      <HStack spacing={3}>
        <Text modifiers={[font({ size: 10 }), foregroundStyle('#FFFFFF30')]}>···</Text>
        <Image systemName="tram.fill" size={13} color="#FFFFFF50" />
        <Text modifiers={[font({ size: 10 }), foregroundStyle('#FFFFFF30')]}>···</Text>
      </HStack>
    ),

    // Dynamic Island expanded: trailing — time + station code, status below
    expandedTrailing: (
      <VStack alignment="trailing" spacing={2} modifiers={[padding({ trailing: 4 })]}>
        <HStack spacing={5}>
          <Text modifiers={[font({ size: 18, weight: 'bold' }), foregroundStyle(arrivalColor)]}>{props?.arriveTime}</Text>
          <Text modifiers={[font({ size: 18, weight: 'bold' }), foregroundStyle('#FFFFFF')]}>{props?.toCode}</Text>
        </HStack>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(arrivalColor)]}>{delayLabel(arrivalDelay)}</Text>
      </VStack>
    ),

    // Dynamic Island expanded: bottom — time remaining + delay badge
    expandedBottom: (
      <HStack modifiers={[padding({ horizontal: 4, bottom: 2 })]}>
        <Text modifiers={[font({ size: 16, weight: 'bold', design: 'rounded' }), foregroundStyle(color)]}>
          Arrives in {timeRemaining}
        </Text>
        <Spacer />
        {arrivalDelay > 0 && (
          <HStack spacing={3} modifiers={[padding({ horizontal: 8, vertical: 3 }), background(arrivalColor), clipShape('capsule')]}>
            <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle('#FFFFFF')]}>+{arrivalDelay}m</Text>
          </HStack>
        )}
      </HStack>
    ),
  };
}

export const trainLiveActivity = createLiveActivity<TrainActivityProps>(
  'TrainLiveActivity',
  TrainLiveActivityLayout
);
