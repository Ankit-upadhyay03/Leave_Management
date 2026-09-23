import fc from 'fast-check';
import { LeaveCalculationService } from '../leaveCalculation.service';

/**
 * These tests exercise the real LeaveCalculationService.
 *
 * Earlier revisions re-implemented the day-count loop inside the assertion, which
 * made several properties tautological — they would have passed even if the service
 * were deleted. Each property below now compares the service output against an
 * independently derived expectation.
 */

/** Local-date formatter, independent of the implementation under test. */
const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

describe('LeaveCalculationService', () => {
  describe('formatDate', () => {
    it('uses local calendar fields, not a UTC conversion', () => {
      // A UTC round-trip on this date shifts the day for any positive offset.
      const date = new Date(2026, 7, 15); // 15 Aug 2026, local midnight
      expect(LeaveCalculationService.formatDate(date)).toBe('2026-08-15');
    });

    it('pads single-digit months and days', () => {
      expect(LeaveCalculationService.formatDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    it('round-trips with parseDate for every day of a year', () => {
      const start = new Date(2026, 0, 1);
      for (let i = 0; i < 365; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const formatted = LeaveCalculationService.formatDate(d);
        expect(LeaveCalculationService.formatDate(LeaveCalculationService.parseDate(formatted))).toBe(formatted);
      }
    });
  });

  describe('parseDate', () => {
    it('parses a YYYY-MM-DD string to local midnight', () => {
      const d = LeaveCalculationService.parseDate('2026-08-15');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(7);
      expect(d.getDate()).toBe(15);
      expect(d.getHours()).toBe(0);
    });

    it('ignores a time component', () => {
      expect(LeaveCalculationService.formatDate(LeaveCalculationService.parseDate('2026-08-15T18:30:00.000Z')))
        .toBe('2026-08-15');
    });

    it('normalises a Date to local midnight', () => {
      const noon = new Date(2026, 7, 15, 12, 30, 45);
      expect(LeaveCalculationService.parseDate(noon).getHours()).toBe(0);
    });
  });

  describe('isWeekend', () => {
    it('identifies Saturday and Sunday', () => {
      expect(LeaveCalculationService.isWeekend(new Date(2026, 7, 15))).toBe(true); // Sat
      expect(LeaveCalculationService.isWeekend(new Date(2026, 7, 16))).toBe(true); // Sun
    });

    it('rejects Monday through Friday', () => {
      for (let day = 17; day <= 21; day++) {
        expect(LeaveCalculationService.isWeekend(new Date(2026, 7, day))).toBe(false);
      }
    });
  });

  describe('calculateLeaveDaysSync — known cases', () => {
    it('counts a full Mon-Fri week as 5 days', () => {
      // 17-21 Aug 2026 is Mon-Fri.
      const result = LeaveCalculationService.calculateLeaveDaysSync(
        new Date(2026, 7, 17), new Date(2026, 7, 21), false, []
      );
      expect(result).toBe(5);
    });

    it('excludes the weekend from a Mon-Sun range', () => {
      const result = LeaveCalculationService.calculateLeaveDaysSync(
        new Date(2026, 7, 17), new Date(2026, 7, 23), false, []
      );
      expect(result).toBe(5);
    });

    it('excludes a weekday holiday', () => {
      const result = LeaveCalculationService.calculateLeaveDaysSync(
        new Date(2026, 7, 17), new Date(2026, 7, 21), false, ['2026-08-19']
      );
      expect(result).toBe(4);
    });

    it('does not double-count a holiday landing on a weekend', () => {
      // 15 Aug 2026 is a Saturday; already excluded as a weekend.
      const result = LeaveCalculationService.calculateLeaveDaysSync(
        new Date(2026, 7, 14), new Date(2026, 7, 17), false, ['2026-08-15']
      );
      expect(result).toBe(2); // Fri 14 + Mon 17
    });

    it('returns 0 when the range is only weekends', () => {
      const result = LeaveCalculationService.calculateLeaveDaysSync(
        new Date(2026, 7, 15), new Date(2026, 7, 16), false, []
      );
      expect(result).toBe(0);
    });

    it('counts a single weekday as 1', () => {
      expect(LeaveCalculationService.calculateLeaveDaysSync(
        new Date(2026, 7, 17), new Date(2026, 7, 17), false, []
      )).toBe(1);
    });

    it('handles a range spanning a month boundary', () => {
      // 31 Aug 2026 (Mon) to 4 Sep 2026 (Fri).
      expect(LeaveCalculationService.calculateLeaveDaysSync(
        new Date(2026, 7, 31), new Date(2026, 8, 4), false, []
      )).toBe(5);
    });
  });

  describe('Property 1: leave day count excludes weekends and holidays', () => {
    it('equals weekday count minus weekday holidays in range', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 28 }),
          fc.integer({ min: 0, max: 40 }),
          fc.uniqueArray(fc.integer({ min: 1, max: 28 }), { minLength: 0, maxLength: 6 }),
          (startDay, duration, holidayDays) => {
            const from = new Date(2026, 2, startDay); // March 2026
            const to = new Date(from);
            to.setDate(to.getDate() + duration);

            const holidays = holidayDays.map(d => ymd(2026, 3, d));
            const actual = LeaveCalculationService.calculateLeaveDaysSync(from, to, false, holidays);

            // Independent expectation: walk the range with plain Date arithmetic.
            const holidaySet = new Set(holidays);
            let expected = 0;
            for (const cur = new Date(from); cur <= to; cur.setDate(cur.getDate() + 1)) {
              const dow = cur.getDay();
              const key = ymd(cur.getFullYear(), cur.getMonth() + 1, cur.getDate());
              if (dow !== 0 && dow !== 6 && !holidaySet.has(key)) expected++;
            }

            expect(actual).toBe(expected);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('never exceeds the total days in the range and is never negative', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 28 }),
          fc.integer({ min: 0, max: 60 }),
          (startDay, duration) => {
            const from = new Date(2026, 5, startDay);
            const to = new Date(from);
            to.setDate(to.getDate() + duration);

            const result = LeaveCalculationService.calculateLeaveDaysSync(from, to, false, []);
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThanOrEqual(duration + 1);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('is additive across a split of the range', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          fc.integer({ min: 1, max: 15 }),
          fc.integer({ min: 1, max: 15 }),
          (startDay, firstLen, secondLen) => {
            const from = new Date(2026, 3, startDay);
            const mid = new Date(from);
            mid.setDate(mid.getDate() + firstLen);
            const afterMid = new Date(mid);
            afterMid.setDate(afterMid.getDate() + 1);
            const to = new Date(afterMid);
            to.setDate(to.getDate() + secondLen);

            const whole = LeaveCalculationService.calculateLeaveDaysSync(from, to, false, []);
            const partA = LeaveCalculationService.calculateLeaveDaysSync(from, mid, false, []);
            const partB = LeaveCalculationService.calculateLeaveDaysSync(afterMid, to, false, []);

            expect(partA + partB).toBe(whole);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Property 2: half-day is always exactly 0.5', () => {
    it('ignores range length and holidays when isHalfDay is set', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 28 }),
          fc.integer({ min: 0, max: 30 }),
          fc.array(fc.integer({ min: 1, max: 28 }), { maxLength: 5 }),
          (startDay, duration, holidayDays) => {
            const from = new Date(2026, 8, startDay);
            const to = new Date(from);
            to.setDate(to.getDate() + duration);
            const holidays = holidayDays.map(d => ymd(2026, 9, d));

            expect(LeaveCalculationService.calculateLeaveDaysSync(from, to, true, holidays)).toBe(0.5);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 3: adding a holiday reduces the count by at most 1', () => {
    it('reduces by exactly 1 for an in-range weekday, otherwise leaves it unchanged', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          fc.integer({ min: 5, max: 20 }),
          fc.integer({ min: 1, max: 28 }),
          (startDay, duration, holidayDay) => {
            const from = new Date(2026, 4, startDay); // May 2026
            const to = new Date(from);
            to.setDate(to.getDate() + duration);

            const holiday = new Date(2026, 4, holidayDay);
            const holidayStr = ymd(2026, 5, holidayDay);

            const before = LeaveCalculationService.calculateLeaveDaysSync(from, to, false, []);
            const after = LeaveCalculationService.calculateLeaveDaysSync(from, to, false, [holidayStr]);

            const inRange = holiday >= from && holiday <= to;
            const isWeekday = holiday.getDay() !== 0 && holiday.getDay() !== 6;

            expect(after).toBe(inRange && isWeekday ? before - 1 : before);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('is monotonically non-increasing as holidays accumulate', () => {
      fc.assert(
        fc.property(
          fc.uniqueArray(fc.integer({ min: 1, max: 28 }), { minLength: 1, maxLength: 8 }),
          holidayDays => {
            const from = new Date(2026, 6, 1);
            const to = new Date(2026, 6, 28);

            let previous = LeaveCalculationService.calculateLeaveDaysSync(from, to, false, []);
            const accumulated: string[] = [];

            for (const day of holidayDays) {
              accumulated.push(ymd(2026, 7, day));
              const current = LeaveCalculationService.calculateLeaveDaysSync(from, to, false, accumulated);
              expect(current).toBeLessThanOrEqual(previous);
              previous = current;
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 4: duplicate holiday entries are idempotent', () => {
    it('listing the same holiday repeatedly does not over-deduct', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 28 }), holidayDay => {
          const from = new Date(2026, 9, 1);
          const to = new Date(2026, 9, 28);
          const holiday = ymd(2026, 10, holidayDay);

          const once = LeaveCalculationService.calculateLeaveDaysSync(from, to, false, [holiday]);
          const thrice = LeaveCalculationService.calculateLeaveDaysSync(from, to, false, [holiday, holiday, holiday]);

          expect(thrice).toBe(once);
        }),
        { numRuns: 100 }
      );
    });

    it('holidays outside the range never affect the count', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 28 }), fc.integer({ min: 1, max: 10 }), (startDay, duration) => {
          const from = new Date(2026, 1, startDay); // February
          const to = new Date(from);
          to.setDate(to.getDate() + duration);

          const baseline = LeaveCalculationService.calculateLeaveDaysSync(from, to, false, []);
          // Holidays in a different year cannot intersect the range.
          const withDistant = LeaveCalculationService.calculateLeaveDaysSync(
            from, to, false, ['2020-01-01', '2035-12-25']
          );

          expect(withDistant).toBe(baseline);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 5: date ordering', () => {
    it('an inverted range yields 0 rather than looping or throwing', () => {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 28 }), fc.integer({ min: 1, max: 20 }), (startDay, gap) => {
          const from = new Date(2026, 10, startDay);
          const to = new Date(from);
          to.setDate(to.getDate() - gap); // to precedes from

          expect(LeaveCalculationService.calculateLeaveDaysSync(from, to, false, [])).toBe(0);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 6: a full calendar week always contains 5 working days', () => {
    it('any Monday plus 6 days yields 5 when there are no holidays', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 51 }), weekOffset => {
          // 5 Jan 2026 is a Monday; step whole weeks from there.
          const monday = new Date(2026, 0, 5);
          monday.setDate(monday.getDate() + weekOffset * 7);
          const sunday = new Date(monday);
          sunday.setDate(sunday.getDate() + 6);

          expect(monday.getDay()).toBe(1);
          expect(LeaveCalculationService.calculateLeaveDaysSync(monday, sunday, false, [])).toBe(5);
        }),
        { numRuns: 52 }
      );
    });
  });
});
