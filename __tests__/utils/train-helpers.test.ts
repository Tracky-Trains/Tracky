import { extractTrainNumber } from '../../utils/train-helpers';

// Mock the gtfsParser
jest.mock('../../utils/gtfs-parser', () => ({
  gtfsParser: {
    getTrainNumber: jest.fn((tripId: string) => {
      // Simulate GTFS parser behavior
      if (tripId === 'Amtrak-43-20240104') return '43';
      if (tripId === '2151') return '2151';
      return tripId; // Fallback
    }),
  },
}));

describe('train-helpers utilities', () => {
  describe('extractTrainNumber', () => {
    it('should extract train number from GTFS trip ID', () => {
      expect(extractTrainNumber('Amtrak-43-20240104')).toBe('43');
    });

    it('should return train number directly if already a number', () => {
      expect(extractTrainNumber('2151')).toBe('2151');
    });

    it('should extract numeric portion as fallback', () => {
      // When gtfsParser returns the tripId unchanged, extract numbers
      expect(extractTrainNumber('train-123-xyz')).toMatch(/123/);
    });
  });
});
