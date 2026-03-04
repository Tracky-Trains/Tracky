import { Text, VStack, HStack, Spacer } from '@expo/ui/swift-ui';
import { foregroundStyle, font, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetBase } from 'expo-widgets';
import type { TravelStatsWidgetData } from '../services/widget-data';

// SwiftUI text style approximations
const headline = font({ size: 17, weight: 'semibold' });
const subheadline = font({ size: 15 });
const title1 = font({ size: 28, weight: 'bold' });
const title2 = font({ size: 22, weight: 'bold' });
const caption = font({ size: 12 });

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function TravelStatsWidgetView(props: WidgetBase<TravelStatsWidgetData>) {
  'widget';

  if (!props.hasTrips) {
    return (
      <VStack spacing={4}>
        <Text modifiers={[headline]}>No trips yet</Text>
        <Text modifiers={[caption, foregroundStyle('secondary')]}>Complete a trip to see stats</Text>
      </VStack>
    );
  }

  if (props.family === 'systemSmall') {
    return (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ all: 12 })]}>
        <Text modifiers={[caption, foregroundStyle('secondary')]}>Travel Stats</Text>
        <VStack alignment="leading" spacing={4}>
          <Text modifiers={[title1]}>{props.totalTrips}</Text>
          <Text modifiers={[caption, foregroundStyle('secondary')]}>trips</Text>
        </VStack>
        <Spacer />
        <Text modifiers={[subheadline]}>{props.totalDistanceMiles.toLocaleString()} mi</Text>
      </VStack>
    );
  }

  // systemMedium
  return (
    <VStack alignment="leading" spacing={8} modifiers={[padding({ all: 12 })]}>
      <Text modifiers={[caption, foregroundStyle('secondary')]}>Travel Stats</Text>
      <HStack spacing={16}>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[title2]}>{props.totalTrips}</Text>
          <Text modifiers={[caption, foregroundStyle('secondary')]}>trips</Text>
        </VStack>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[title2]}>{props.totalDistanceMiles.toLocaleString()} mi</Text>
          <Text modifiers={[caption, foregroundStyle('secondary')]}>distance</Text>
        </VStack>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[title2]}>{props.uniqueStations}</Text>
          <Text modifiers={[caption, foregroundStyle('secondary')]}>stations</Text>
        </VStack>
      </HStack>
      <HStack>
        <Text modifiers={[caption, foregroundStyle('secondary')]}>
          {formatDuration(props.totalDurationMinutes)} total
        </Text>
        <Spacer />
        {props.favoriteRoute ? (
          <Text modifiers={[caption, foregroundStyle('secondary')]}>{props.favoriteRoute}</Text>
        ) : null}
      </HStack>
    </VStack>
  );
}

export const travelStatsWidget = createWidget<TravelStatsWidgetData>(
  'TravelStatsWidget',
  TravelStatsWidgetView
);
