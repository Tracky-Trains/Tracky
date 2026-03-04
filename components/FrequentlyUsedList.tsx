import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { COLORS, styles } from '../screens/styles';
import { selection as hapticSelection } from '../utils/haptics';
import { TrainIcon } from './TrainIcon';

export interface FrequentlyUsedItemProps {
  id: string;
  name: string;
  code: string;
  subtitle: string;
  type: 'train' | 'station';
}

export function FrequentlyUsedList({
  items,
  onSelect,
}: {
  items: FrequentlyUsedItemProps[];
  onSelect: (item: FrequentlyUsedItemProps) => void;
}) {
  return (
    <>
      {items.map(item => (
        <TouchableOpacity
          key={item.id}
          style={styles.frequentlyUsedItem}
          activeOpacity={0.7}
          onPress={() => { hapticSelection(); onSelect(item); }}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${item.subtitle}`}
          accessibilityHint={`Select ${item.type === 'train' ? 'train route' : 'station'} ${item.name}`}
        >
          <View style={styles.frequentlyUsedIcon}>
            {item.type === 'train' && <TrainIcon name={item.name} size={24} color={COLORS.primary} />}
            {item.type === 'station' && <Ionicons name="location" size={24} color={COLORS.primary} />}
            {item.type === 'route' && <MaterialCommunityIcons name="train-track" size={24} color={COLORS.primary} />}
          </View>
          <View style={styles.frequentlyUsedText}>
            {item.type === 'train' ? (
              <>
                <Text style={styles.frequentlyUsedName}>{item.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <Text style={styles.frequentlyUsedSubtitle}>{item.code.split('-')[0]}</Text>
                  <Text style={styles.frequentlyUsedSubtitle}> • </Text>
                  <MaterialCommunityIcons
                    name="arrow-right"
                    size={16}
                    color={COLORS.secondary}
                    style={{ marginHorizontal: 2 }}
                  />
                  <Text style={styles.frequentlyUsedSubtitle}> • {item.code.split('-')[1]}</Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.frequentlyUsedName}>{item.name}</Text>
                <Text style={styles.frequentlyUsedSubtitle}>{item.subtitle}</Text>
              </>
            )}
          </View>
          <Ionicons name="arrow-forward" size={20} color={COLORS.secondary} />
        </TouchableOpacity>
      ))}
    </>
  );
}
