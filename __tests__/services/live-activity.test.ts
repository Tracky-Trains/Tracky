/**
 * Tests for the live-activity service's key parsing logic.
 * The main fix: using '|' as delimiter instead of '-' so tripIds with hyphens parse correctly.
 */

// Mock the dependencies before importing the module
jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: '17.0' },
}));

jest.mock('expo-widgets', () => {
  const activities: Array<{ props: Record<string, unknown>; ended: boolean }> = [];
  return {
    LiveActivity: class {},
    LiveActivityFactory: class {},
    createLiveActivity: () => ({
      start: (props: Record<string, unknown>) => {
        const activity = {
          props,
          ended: false,
          update: jest.fn(),
          end: jest.fn().mockImplementation(() => {
            activity.ended = true;
            return Promise.resolve();
          }),
        };
        activities.push(activity);
        return activity;
      },
      getInstances: () => activities.filter(a => !a.ended),
    }),
  };
});

jest.mock('../../widgets/TrainLiveActivity', () => {
  const { createLiveActivity } = require('expo-widgets');
  return {
    trainLiveActivity: createLiveActivity('TrainLiveActivity', () => ({ banner: null })),
  };
});

jest.mock('../../utils/time-formatting', () => ({
  parseTimeToDate: (time: string, base: Date) => {
    const d = new Date(base);
    d.setHours(14, 30, 0, 0);
    return d;
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

import type { Train } from '../../types/train';

// Must import after mocks
const LiveActivityService = require('../../services/live-activity');

function makeTrain(overrides: Partial<Train> = {}): Train {
  return {
    id: 1,
    operator: 'AMTK',
    trainNumber: '543',
    from: 'New York',
    to: 'Boston',
    fromCode: 'NYP',
    toCode: 'BOS',
    departTime: '2:30 PM',
    arriveTime: '6:45 PM',
    date: '2026-01-16',
    daysAway: 0,
    routeName: 'Northeast Regional',
    tripId: '2026-01-16_AMTK_543',
    ...overrides,
  };
}

describe('live-activity endAll delimiter fix', () => {
  beforeEach(async () => {
    // Clean up by ending all
    await LiveActivityService.endAll();
  });

  it('correctly parses tripIds containing hyphens when ending all', async () => {
    // This tripId has hyphens: 2026-01-16_AMTK_543
    const train = makeTrain({ tripId: '2026-01-16_AMTK_543', fromCode: 'NYP', toCode: 'BOS' });

    await LiveActivityService.startForTrain(train);
    expect(LiveActivityService.hasActivityForTrain(train)).toBe(true);

    // endAll should parse the key correctly with '|' delimiter
    await LiveActivityService.endAll();
    expect(LiveActivityService.hasActivityForTrain(train)).toBe(false);
  });

  it('uses pipe delimiter instead of hyphen for activity keys', async () => {
    const train = makeTrain({ tripId: 'trip-with-many-hyphens' });

    await LiveActivityService.startForTrain(train);
    expect(LiveActivityService.hasActivityForTrain(train)).toBe(true);

    await LiveActivityService.endForTrain('trip-with-many-hyphens', 'NYP', 'BOS');
    expect(LiveActivityService.hasActivityForTrain(train)).toBe(false);
  });
});
