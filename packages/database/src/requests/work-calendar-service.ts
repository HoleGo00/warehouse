interface CalendarDatabase {
  readonly workCalendarDay: {
    findMany(args: {
      where: { date: { gt: Date; lte: Date } };
    }): Promise<readonly { date: Date; isWorkingDay: boolean }[]>;
  };
}

const addCalendarDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const defaultWorkingDay = (date: string): boolean => {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day !== 0 && day !== 6;
};

export const shanghaiLocalDate = (value: Date): string => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
};

export const calculateWorkingDayDeadline = (
  submittedAt: Date,
  workingDays: number,
  overrides: ReadonlyMap<string, boolean> = new Map(),
): Date => {
  if (!Number.isSafeInteger(workingDays) || workingDays <= 0) {
    throw new Error('workingDays must be a positive safe integer.');
  }
  let date = shanghaiLocalDate(submittedAt);
  let remaining = workingDays;
  while (remaining > 0) {
    date = addCalendarDays(date, 1);
    if (overrides.get(date) ?? defaultWorkingDay(date)) remaining -= 1;
  }
  return new Date(`${date}T15:59:59.999Z`);
};

export class WorkCalendarService {
  public constructor(private readonly database: CalendarDatabase) {}

  public async deadlineAfterWorkingDays(submittedAt: Date, workingDays: number): Promise<Date> {
    const startDate = shanghaiLocalDate(submittedAt);
    let searchDays = Math.max(workingDays * 4, 14);
    while (true) {
      const searchEnd = addCalendarDays(startDate, searchDays);
      const configuredDays = await this.database.workCalendarDay.findMany({
        where: {
          date: {
            gt: new Date(`${startDate}T00:00:00.000Z`),
            lte: new Date(`${searchEnd}T00:00:00.000Z`),
          },
        },
      });
      const deadline = calculateWorkingDayDeadline(
        submittedAt,
        workingDays,
        new Map(
          configuredDays.map((day) => [day.date.toISOString().slice(0, 10), day.isWorkingDay]),
        ),
      );
      if (shanghaiLocalDate(deadline) <= searchEnd) return deadline;
      searchDays *= 2;
    }
  }
}
