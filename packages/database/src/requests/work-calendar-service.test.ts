import { describe, expect, it } from 'vitest';
import { calculateWorkingDayDeadline, WorkCalendarService } from './work-calendar-service.js';

describe('working day deadline', () => {
  it('does not count the submission day and skips weekends', () => {
    expect(calculateWorkingDayDeadline(new Date('2026-09-04T08:00:00.000Z'), 3).toISOString()).toBe(
      '2026-09-09T15:59:59.999Z',
    );
  });

  it('honors explicit holidays and weekend make-up days', () => {
    const overrides = new Map<string, boolean>([
      ['2026-09-07', false],
      ['2026-09-12', true],
    ]);
    expect(
      calculateWorkingDayDeadline(new Date('2026-09-04T15:59:59.999Z'), 5, overrides).toISOString(),
    ).toBe('2026-09-12T15:59:59.999Z');
  });

  it('uses the Shanghai local submission date at the midnight boundary', () => {
    expect(calculateWorkingDayDeadline(new Date('2026-09-06T16:00:00.000Z'), 1).toISOString()).toBe(
      '2026-09-08T15:59:59.999Z',
    );
  });

  it('expands the configured-date window when explicit holidays exceed the initial range', async () => {
    const configuredDays = Array.from({ length: 45 }, (_, index) => {
      const date = new Date('2026-09-05T00:00:00.000Z');
      date.setUTCDate(date.getUTCDate() + index);
      return { date, isWorkingDay: false };
    });
    let reads = 0;
    const service = new WorkCalendarService({
      workCalendarDay: {
        findMany: async ({ where }) => {
          reads += 1;
          return configuredDays.filter(
            (day) => day.date > where.date.gt && day.date <= where.date.lte,
          );
        },
      },
    });

    await expect(
      service.deadlineAfterWorkingDays(new Date('2026-09-04T08:00:00.000Z'), 3),
    ).resolves.toEqual(
      calculateWorkingDayDeadline(
        new Date('2026-09-04T08:00:00.000Z'),
        3,
        new Map(configuredDays.map((day) => [day.date.toISOString().slice(0, 10), false])),
      ),
    );
    expect(reads).toBeGreaterThan(1);
  });
});
