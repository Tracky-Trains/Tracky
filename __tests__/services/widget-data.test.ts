import { selectNextTrain, buildTravelStats } from '../../services/widget-data';
import type { Train, CompletedTrip } from '../../types/train';

function makeTrain(overrides: Partial<Train> = {}): Train {
  return {
    id: 1,
    operator: 'AMTK',
    trainNumber: '91',
    from: 'New York',
    to: 'Boston',
    fromCode: 'NYP',
    toCode: 'BOS',
    departTime: '2:30 PM',
    arriveTime: '6:45 PM',
    date: '2026-03-04',
    daysAway: 0,
    routeName: 'Northeast Regional',
    ...overrides,
  };
}

function makeTrip(overrides: Partial<CompletedTrip> = {}): CompletedTrip {
  return {
    tripId: '2026-01-16_AMTK_91',
    trainNumber: '91',
    routeName: 'Northeast Regional',
    from: 'New York',
    to: 'Boston',
    fromCode: 'NYP',
    toCode: 'BOS',
    departTime: '2:30 PM',
    arriveTime: '6:45 PM',
    date: '2026-01-16',
    travelDate: 1737072000000,
    completedAt: 1737072000000,
    ...overrides,
  };
}

describe('selectNextTrain', () => {
  it('returns empty data when no trains', () => {
    const result = selectNextTrain([]);
    expect(result.hasTrains).toBe(false);
    expect(result.trainNumber).toBe('');
  });

  it('skips past trains (daysAway < 0)', () => {
    const result = selectNextTrain([makeTrain({ daysAway: -1 })]);
    expect(result.hasTrains).toBe(false);
  });

  it('picks the closest upcoming train', () => {
    const trains = [
      makeTrain({ trainNumber: '92', daysAway: 3 }),
      makeTrain({ trainNumber: '91', daysAway: 0 }),
      makeTrain({ trainNumber: '93', daysAway: 1 }),
    ];
    const result = selectNextTrain(trains);
    expect(result.hasTrains).toBe(true);
    expect(result.trainNumber).toBe('91');
  });

  it('sorts by departTime when daysAway is equal', () => {
    const trains = [
      makeTrain({ trainNumber: '92', daysAway: 0, departTime: '5:00 PM' }),
      makeTrain({ trainNumber: '91', daysAway: 0, departTime: '2:30 PM' }),
    ];
    const result = selectNextTrain(trains);
    expect(result.trainNumber).toBe('91');
  });

  it('computes delay status correctly', () => {
    const delayed = selectNextTrain([makeTrain({ realtime: { delay: 15 } })]);
    expect(delayed.status).toBe('delayed');
    expect(delayed.delayMinutes).toBe(15);

    const early = selectNextTrain([makeTrain({ realtime: { delay: -5 } })]);
    expect(early.status).toBe('early');

    const onTime = selectNextTrain([makeTrain({ realtime: { delay: 0 } })]);
    expect(onTime.status).toBe('on-time');

    const noRealtime = selectNextTrain([makeTrain()]);
    expect(noRealtime.status).toBe('on-time');
    expect(noRealtime.delayMinutes).toBe(0);
  });
});

describe('buildTravelStats', () => {
  it('returns empty data when no trips', () => {
    const result = buildTravelStats([]);
    expect(result.hasTrips).toBe(false);
    expect(result.totalTrips).toBe(0);
  });

  it('aggregates basic stats', () => {
    const trips = [
      makeTrip({ distance: 100, duration: 120 }),
      makeTrip({ tripId: '2', fromCode: 'WAS', toCode: 'NYP', distance: 200, duration: 180 }),
    ];
    const result = buildTravelStats(trips);
    expect(result.hasTrips).toBe(true);
    expect(result.totalTrips).toBe(2);
    expect(result.totalDistanceMiles).toBe(300);
    expect(result.totalDurationMinutes).toBe(300);
  });

  it('counts unique stations', () => {
    const trips = [
      makeTrip({ fromCode: 'NYP', toCode: 'BOS' }),
      makeTrip({ fromCode: 'NYP', toCode: 'WAS' }),
      makeTrip({ fromCode: 'BOS', toCode: 'NYP' }),
    ];
    const result = buildTravelStats(trips);
    expect(result.uniqueStations).toBe(3); // NYP, BOS, WAS
  });

  it('identifies favorite route', () => {
    const trips = [
      makeTrip({ routeName: 'Northeast Regional' }),
      makeTrip({ routeName: 'Northeast Regional' }),
      makeTrip({ routeName: 'Acela' }),
    ];
    const result = buildTravelStats(trips);
    expect(result.favoriteRoute).toBe('Northeast Regional');
  });

  it('handles missing distance/duration gracefully', () => {
    const trips = [
      makeTrip({ distance: undefined, duration: undefined }),
      makeTrip({ distance: 100, duration: 60 }),
    ];
    const result = buildTravelStats(trips);
    expect(result.totalDistanceMiles).toBe(100);
    expect(result.totalDurationMinutes).toBe(60);
  });
});
