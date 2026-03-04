import { Text, VStack, HStack, Spacer } from '@expo/ui/swift-ui';
import { foregroundStyle, font, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetBase } from 'expo-widgets';
import type { NextTrainWidgetData } from '../services/widget-data';

// SwiftUI text style approximations
const headline = font({ size: 17, weight: 'semibold' });
const subheadline = font({ size: 15 });
const title2 = font({ size: 22, weight: 'bold' });
const title3 = font({ size: 20, weight: 'semibold' });
const caption = font({ size: 12 });
const caption2 = font({ size: 11 });

function NextTrainWidgetView(props: WidgetBase<NextTrainWidgetData>) {
  'widget';

  if (!props.hasTrains) {
    return (
      <VStack spacing={4}>
        <Text modifiers={[headline]}>No upcoming trains</Text>
        <Text modifiers={[caption, foregroundStyle('secondary')]}>Save a train to see it here</Text>
      </VStack>
    );
  }

  const delayColor = props.delayMinutes > 0 ? '#EF4444' : '#22C55E';
  const delayLabel =
    props.delayMinutes > 0
      ? `+${props.delayMinutes}m`
      : props.delayMinutes < 0
        ? `${props.delayMinutes}m`
        : 'On Time';

  if (props.family === 'systemSmall') {
    return (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 12 })]}>
        <HStack spacing={4}>
          <Text modifiers={[headline]}>{props.fromCode}</Text>
          <Text modifiers={[foregroundStyle('secondary')]}>-</Text>
          <Text modifiers={[headline]}>{props.toCode}</Text>
        </HStack>
        <Text modifiers={[title2]}>{props.departTime}</Text>
        <Spacer />
        <Text modifiers={[caption, foregroundStyle(delayColor)]}>{delayLabel}</Text>
        {props.daysAway > 0 && (
          <Text modifiers={[caption2, foregroundStyle('secondary')]}>in {props.daysAway}d</Text>
        )}
      </VStack>
    );
  }

  // systemMedium
  return (
    <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 12 })]}>
      <HStack>
        <Text modifiers={[headline]}>Train {props.trainNumber}</Text>
        <Spacer />
        <Text modifiers={[subheadline, foregroundStyle(delayColor)]}>{delayLabel}</Text>
      </HStack>
      <HStack spacing={8}>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[title3]}>{props.fromCode}</Text>
          <Text modifiers={[caption, foregroundStyle('secondary')]}>{props.departTime}</Text>
        </VStack>
        <Spacer />
        <Text modifiers={[foregroundStyle('secondary')]}>→</Text>
        <Spacer />
        <VStack alignment="trailing" spacing={2}>
          <Text modifiers={[title3]}>{props.toCode}</Text>
          <Text modifiers={[caption, foregroundStyle('secondary')]}>{props.arriveTime}</Text>
        </VStack>
      </HStack>
      <Text modifiers={[caption, foregroundStyle('secondary')]}>{props.routeName}</Text>
    </VStack>
  );
}

export const nextTrainWidget = createWidget<NextTrainWidgetData>('NextTrainWidget', NextTrainWidgetView);
