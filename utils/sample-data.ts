/**
 * Sample data generator for testing the profile page
 * This file can be used during development to populate the profile with sample trips
 */
import { TrainStorageService } from '../services/storage';
import type { CompletedTrip } from '../types/train';

export async function addSampleTripData() {
  const currentYear = new Date().getFullYear();
  
  const sampleTrips: CompletedTrip[] = [
    // 2025 trips
    {
      tripId: 'sample-1',
      trainNumber: '2151',
      routeName: 'Northeast Regional',
      from: 'New York Penn',
      to: 'Boston South',
      fromCode: 'NYP',
      toCode: 'BOS',
      departTime: '08:00',
      arriveTime: '12:30',
      date: 'Jan 15',
      travelDate: new Date(2025, 0, 15).getTime(),
      completedAt: new Date(2025, 0, 15).getTime(),
      delay: 15, // 15 minutes late
      distance: 231,
      duration: 270,
    },
    {
      tripId: 'sample-2',
      trainNumber: '2153',
      routeName: 'Northeast Regional',
      from: 'Boston South',
      to: 'New York Penn',
      fromCode: 'BOS',
      toCode: 'NYP',
      departTime: '18:00',
      arriveTime: '22:15',
      date: 'Jan 17',
      travelDate: new Date(2025, 0, 17).getTime(),
      completedAt: new Date(2025, 0, 17).getTime(),
      delay: 0,
      distance: 231,
      duration: 255,
    },
    {
      tripId: 'sample-3',
      trainNumber: '93',
      routeName: 'Acela',
      from: 'New York Penn',
      to: 'Washington Union',
      fromCode: 'NYP',
      toCode: 'WAS',
      departTime: '09:00',
      arriveTime: '11:50',
      date: 'Feb 3',
      travelDate: new Date(2025, 1, 3).getTime(),
      completedAt: new Date(2025, 1, 3).getTime(),
      delay: 5,
      distance: 225,
      duration: 170,
    },
    {
      tripId: 'sample-4',
      trainNumber: '2156',
      routeName: 'Northeast Regional',
      from: 'Washington Union',
      to: 'New York Penn',
      fromCode: 'WAS',
      toCode: 'NYP',
      departTime: '16:00',
      arriveTime: '19:30',
      date: 'Feb 5',
      travelDate: new Date(2025, 1, 5).getTime(),
      completedAt: new Date(2025, 1, 5).getTime(),
      delay: 45, // Major delay
      distance: 225,
      duration: 210,
    },
    {
      tripId: 'sample-5',
      trainNumber: '2160',
      routeName: 'Northeast Regional',
      from: 'Philadelphia 30th',
      to: 'Boston South',
      fromCode: 'PHL',
      toCode: 'BOS',
      departTime: '10:30',
      arriveTime: '17:00',
      date: 'Feb 12',
      travelDate: new Date(2025, 1, 12).getTime(),
      completedAt: new Date(2025, 1, 12).getTime(),
      delay: 20,
      distance: 314,
      duration: 390,
    },
    // 2024 trips
    {
      tripId: 'sample-6',
      trainNumber: '19',
      routeName: 'Crescent',
      from: 'New York Penn',
      to: 'Atlanta',
      fromCode: 'NYP',
      toCode: 'ATL',
      departTime: '14:15',
      arriveTime: '20:30',
      date: 'Dec 10',
      travelDate: new Date(2024, 11, 10).getTime(),
      completedAt: new Date(2024, 11, 10).getTime(),
      delay: 60,
      distance: 863,
      duration: 975, // ~16 hours
    },
    {
      tripId: 'sample-7',
      trainNumber: '2170',
      routeName: 'Northeast Regional',
      from: 'Boston South',
      to: 'New York Penn',
      fromCode: 'BOS',
      toCode: 'NYP',
      departTime: '14:00',
      arriveTime: '18:30',
      date: 'Nov 22',
      travelDate: new Date(2024, 10, 22).getTime(),
      completedAt: new Date(2024, 10, 22).getTime(),
      delay: 10,
      distance: 231,
      duration: 270,
    },
    {
      tripId: 'sample-8',
      trainNumber: '66',
      routeName: 'Northeast Regional',
      from: 'Washington Union',
      to: 'Boston South',
      fromCode: 'WAS',
      toCode: 'BOS',
      departTime: '06:30',
      arriveTime: '15:00',
      date: 'Oct 5',
      travelDate: new Date(2024, 9, 5).getTime(),
      completedAt: new Date(2024, 9, 5).getTime(),
      delay: 0,
      distance: 456,
      duration: 510,
    },
  ];

  // Add all sample trips
  for (const trip of sampleTrips) {
    await TrainStorageService.addToHistory(trip);
  }

  console.log(`Added ${sampleTrips.length} sample trips to profile history`);
}

export async function clearSampleData() {
  // This would require a method to clear all history
  console.log('Clear sample data - implement if needed');
}
