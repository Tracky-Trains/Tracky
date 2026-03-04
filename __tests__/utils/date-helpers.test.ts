import {
  formatDateForDisplay,
  calculateDaysAway,
  getDaysAwayLabel,
  isSameDay,
  getStartOfDay,
  addDays,
} from '../../utils/date-helpers';

describe('date-helpers utilities', () => {
  describe('formatDateForDisplay', () => {
    it('should format date as "MMM D"', () => {
      const date = new Date(2024, 0, 4); // Jan 4, 2024
      expect(formatDateForDisplay(date)).toBe('Jan 4');

      const date2 = new Date(2024, 11, 25); // Dec 25, 2024
      expect(formatDateForDisplay(date2)).toBe('Dec 25');
    });

    it('should accept timestamp as input', () => {
      const timestamp = new Date(2024, 5, 15).getTime(); // Jun 15, 2024
      expect(formatDateForDisplay(timestamp)).toBe('Jun 15');
    });
  });

  describe('calculateDaysAway', () => {
    beforeEach(() => {
      // Mock current date to Jan 1, 2024
      jest.useFakeTimers();
      jest.setSystemTime(new Date(2024, 0, 1, 12, 0, 0));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should calculate days until future date', () => {
      const tomorrow = new Date(2024, 0, 2);
      expect(calculateDaysAway(tomorrow)).toBe(1);

      const nextWeek = new Date(2024, 0, 8);
      expect(calculateDaysAway(nextWeek)).toBe(7);
    });

    it('should return 0 for today', () => {
      const today = new Date(2024, 0, 1, 15, 30, 0); // Same day, different time
      expect(calculateDaysAway(today)).toBe(0);
    });

    it('should return negative for past dates', () => {
      const yesterday = new Date(2023, 11, 31);
      expect(calculateDaysAway(yesterday)).toBe(-1);
    });
  });

  describe('getDaysAwayLabel', () => {
    it('should return "Today" for 0 days', () => {
      expect(getDaysAwayLabel(0)).toBe('Today');
    });

    it('should return "Tomorrow" for 1 day', () => {
      expect(getDaysAwayLabel(1)).toBe('Tomorrow');
    });

    it('should return "Yesterday" for -1 day', () => {
      expect(getDaysAwayLabel(-1)).toBe('Yesterday');
    });

    it('should return "in N days" for future', () => {
      expect(getDaysAwayLabel(3)).toBe('in 3 days');
      expect(getDaysAwayLabel(7)).toBe('in 7 days');
    });

    it('should return "N days ago" for past', () => {
      expect(getDaysAwayLabel(-3)).toBe('3 days ago');
      expect(getDaysAwayLabel(-7)).toBe('7 days ago');
    });
  });

  describe('isSameDay', () => {
    it('should return true for same calendar day', () => {
      const date1 = new Date(2024, 0, 15, 9, 0, 0);
      const date2 = new Date(2024, 0, 15, 18, 30, 0);
      expect(isSameDay(date1, date2)).toBe(true);
    });

    it('should return false for different days', () => {
      const date1 = new Date(2024, 0, 15, 23, 59, 0);
      const date2 = new Date(2024, 0, 16, 0, 1, 0);
      expect(isSameDay(date1, date2)).toBe(false);
    });
  });

  describe('getStartOfDay', () => {
    it('should set time to midnight', () => {
      const date = new Date(2024, 0, 15, 14, 30, 45, 123);
      const result = getStartOfDay(date);

      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(15);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
    });
  });

  describe('addDays', () => {
    it('should add positive days', () => {
      const date = new Date(2024, 0, 15);
      const result = addDays(date, 5);

      expect(result.getDate()).toBe(20);
      expect(result.getMonth()).toBe(0);
    });

    it('should add negative days', () => {
      const date = new Date(2024, 0, 15);
      const result = addDays(date, -5);

      expect(result.getDate()).toBe(10);
      expect(result.getMonth()).toBe(0);
    });

    it('should handle month rollover', () => {
      const date = new Date(2024, 0, 30);
      const result = addDays(date, 5);

      expect(result.getDate()).toBe(4);
      expect(result.getMonth()).toBe(1); // February
    });
  });
});
