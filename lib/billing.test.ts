import { describe, expect, it } from 'vitest'
import { generateSchedule, invoiceStatus, malaysiaToday, parseRinggitToSen, type ScheduledInvoice } from './billing'

// `npm test` runs this file under TZ=UTC, Asia/Kuala_Lumpur and America/New_York.
describe('test environment', () => {
  it('runs in the timezone it was started with', () => {
    if (process.env.TZ) {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(process.env.TZ)
    }
  })
})

const rent = (periodIndex: number, periodStart: string, periodEnd: string, amountSen: number): ScheduledInvoice => ({
  kind: 'rent',
  periodIndex,
  periodStart,
  periodEnd,
  dueDate: periodStart,
  amountSen,
})

const deposit = (dueDate: string, amountSen: number): ScheduledInvoice => ({
  kind: 'deposit',
  periodIndex: null,
  periodStart: null,
  periodEnd: null,
  dueDate,
  amountSen,
})

describe('generateSchedule', () => {
  it('matches the worked example (Aisyah)', () => {
    expect(
      generateSchedule({ startDate: '2026-01-31', endDate: '2026-07-15', monthlyRentSen: 150000, depositSen: 300000 }),
    ).toEqual([
      deposit('2026-01-31', 300000),
      rent(0, '2026-01-31', '2026-02-27', 150000),
      rent(1, '2026-02-28', '2026-03-30', 150000),
      rent(2, '2026-03-31', '2026-04-29', 150000),
      rent(3, '2026-04-30', '2026-05-30', 150000),
      rent(4, '2026-05-31', '2026-06-29', 150000),
      rent(5, '2026-06-30', '2026-07-15', 77419),
    ])
  })

  it('rounds an exact half up (Ben: 100029 x 15 / 30 = 50014.5)', () => {
    expect(
      generateSchedule({ startDate: '2026-01-01', endDate: '2026-04-15', monthlyRentSen: 100029, depositSen: 0 }),
    ).toEqual([
      rent(0, '2026-01-01', '2026-01-31', 100029),
      rent(1, '2026-02-01', '2026-02-28', 100029),
      rent(2, '2026-03-01', '2026-03-31', 100029),
      rent(3, '2026-04-01', '2026-04-15', 50015),
    ])
  })

  it('charges full rent when the lease ends the day before the next anchor (Probe)', () => {
    const schedule = generateSchedule({
      startDate: '2026-02-28',
      endDate: '2027-02-27',
      monthlyRentSen: 200000,
      depositSen: 400000,
    })
    expect(schedule).toHaveLength(13)
    expect(schedule[0]).toEqual(deposit('2026-02-28', 400000))
    expect(schedule[1]).toEqual(rent(0, '2026-02-28', '2026-03-27', 200000))
    expect(schedule[12]).toEqual(rent(11, '2027-01-28', '2027-02-27', 200000))
    expect(schedule.slice(1).every((i) => i.amountSen === 200000)).toBe(true)
  })

  it('makes 12 full periods for a one-year lease (Chen)', () => {
    const schedule = generateSchedule({
      startDate: '2026-03-15',
      endDate: '2027-03-14',
      monthlyRentSen: 220000,
      depositSen: 440000,
    })
    expect(schedule).toHaveLength(13)
    expect(schedule[12]).toEqual(rent(11, '2027-02-15', '2027-03-14', 220000))
  })

  it('uses Feb 29 as the anchor in a leap year', () => {
    expect(
      generateSchedule({ startDate: '2028-01-31', endDate: '2028-03-30', monthlyRentSen: 1000, depositSen: 0 }),
    ).toEqual([rent(0, '2028-01-31', '2028-02-28', 1000), rent(1, '2028-02-29', '2028-03-30', 1000)])
  })

  it('counts anchors from the start date, not from the previous anchor', () => {
    const anchors = (startDate: string, endDate: string) =>
      generateSchedule({ startDate, endDate, monthlyRentSen: 1000, depositSen: 0 }).map((i) => i.periodStart)
    expect(anchors('2026-01-30', '2026-05-29')).toEqual(['2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30'])
    expect(anchors('2026-03-31', '2026-07-30')).toEqual(['2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'])
    expect(anchors('2026-12-31', '2027-03-30')).toEqual(['2026-12-31', '2027-01-31', '2027-02-28'])
  })

  it('handles a one-day lease', () => {
    // Full period 2026-02-10..2026-03-09 is 28 days: 100000 / 28 = 3571.43
    expect(
      generateSchedule({ startDate: '2026-02-10', endDate: '2026-02-10', monthlyRentSen: 100000, depositSen: 0 }),
    ).toEqual([rent(0, '2026-02-10', '2026-02-10', 3571)])
  })

  it('makes a one-day last period when endDate is exactly an anchor', () => {
    expect(
      generateSchedule({ startDate: '2026-01-15', endDate: '2026-02-15', monthlyRentSen: 100000, depositSen: 0 }),
    ).toEqual([rent(0, '2026-01-15', '2026-02-14', 100000), rent(1, '2026-02-15', '2026-02-15', 3571)])
  })

  it('skips the deposit when it is 0', () => {
    const schedule = generateSchedule({ startDate: '2026-01-01', endDate: '2026-01-31', monthlyRentSen: 5, depositSen: 0 })
    expect(schedule).toEqual([rent(0, '2026-01-01', '2026-01-31', 5)])
  })

  it('produces contiguous periods covering the whole lease, for every start day over two years', () => {
    for (let day = 0; day < 731; day++) {
      const startMs = Date.UTC(2027, 0, 1) + day * 86_400_000
      const startDate = new Date(startMs).toISOString().slice(0, 10)
      for (const lengthDays of [0, 27, 30, 45, 400]) {
        const endDate = new Date(startMs + lengthDays * 86_400_000).toISOString().slice(0, 10)
        const periods = generateSchedule({ startDate, endDate, monthlyRentSen: 100000, depositSen: 0 })
        expect(periods[0].periodStart).toBe(startDate)
        expect(periods.at(-1)?.periodEnd).toBe(endDate)
        periods.forEach((p, i) => {
          expect(p.periodIndex).toBe(i)
          expect(p.dueDate).toBe(p.periodStart)
          expect(p.amountSen).toBeGreaterThan(0)
          expect(p.amountSen).toBeLessThanOrEqual(100000)
          expect(Number.isInteger(p.amountSen)).toBe(true)
          if (i > 0) {
            const prevEnd = Date.parse(`${periods[i - 1].periodEnd}T00:00:00Z`)
            expect(Date.parse(`${p.periodStart}T00:00:00Z`) - prevEnd).toBe(86_400_000)
          }
        })
      }
    }
  })

  it.each([
    ['2026-02-30', '2026-03-31'],
    ['2026-13-01', '2026-12-31'],
    ['2026-2-3', '2026-12-31'],
    ['2026-02-03T00:00', '2026-12-31'],
    ['20260203', '2026-12-31'],
    ['', '2026-12-31'],
    ['2026-01-01', '2025-02-29'],
    ['2027-02-29', '2027-12-31'],
  ])('throws for invalid date %j / %j', (startDate, endDate) => {
    expect(() => generateSchedule({ startDate, endDate, monthlyRentSen: 1000, depositSen: 0 })).toThrow(Error)
  })

  it('throws when endDate is before startDate', () => {
    expect(() =>
      generateSchedule({ startDate: '2026-02-02', endDate: '2026-02-01', monthlyRentSen: 1000, depositSen: 0 }),
    ).toThrow(Error)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'throws for monthlyRentSen %s',
    (monthlyRentSen) => {
      expect(() =>
        generateSchedule({ startDate: '2026-01-01', endDate: '2026-12-31', monthlyRentSen, depositSen: 0 }),
      ).toThrow(Error)
    },
  )

  it.each([-1, 0.5, Number.NaN])('throws for depositSen %s', (depositSen) => {
    expect(() =>
      generateSchedule({ startDate: '2026-01-01', endDate: '2026-12-31', monthlyRentSen: 1000, depositSen }),
    ).toThrow(Error)
  })

  it('throws for non-number amounts passed at runtime', () => {
    const lease = { startDate: '2026-01-01', endDate: '2026-12-31', monthlyRentSen: '1000', depositSen: 0 }
    expect(() => generateSchedule(lease as unknown as Parameters<typeof generateSchedule>[0])).toThrow(Error)
  })
})

describe('invoiceStatus', () => {
  const due = (paidSen: number) => ({ dueDate: '2026-03-01', amountSen: 1000, paidSen })

  it('becomes overdue at 2026-03-02 00:00 Malaysia time, not a moment earlier', () => {
    expect(invoiceStatus(due(0), new Date('2026-03-01T15:59:59.999Z'))).toBe('unpaid')
    expect(invoiceStatus(due(0), new Date('2026-03-01T16:00:00.000Z'))).toBe('overdue')
  })

  it('is not overdue on the due date itself in Malaysia', () => {
    // 2026-02-28T16:00Z is 2026-03-01 00:00 in Malaysia.
    expect(invoiceStatus(due(0), new Date('2026-02-28T16:00:00Z'))).toBe('unpaid')
  })

  it('applies the rules in order', () => {
    const late = new Date('2026-04-01T00:00:00Z')
    const early = new Date('2026-02-01T00:00:00Z')
    expect(invoiceStatus(due(1000), late)).toBe('paid')
    expect(invoiceStatus(due(1500), late)).toBe('paid')
    expect(invoiceStatus(due(500), late)).toBe('overdue')
    expect(invoiceStatus(due(500), early)).toBe('partially_paid')
    expect(invoiceStatus(due(0), early)).toBe('unpaid')
  })

  it('throws for an invalid now', () => {
    expect(() => invoiceStatus(due(0), new Date('nope'))).toThrow(Error)
  })
})

describe('malaysiaToday', () => {
  it('rolls over at 16:00 UTC', () => {
    expect(malaysiaToday(new Date('2026-02-28T15:59:59.999Z'))).toBe('2026-02-28')
    expect(malaysiaToday(new Date('2026-02-28T16:00:00Z'))).toBe('2026-03-01')
    expect(malaysiaToday(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01')
  })
})

describe('parseRinggitToSen', () => {
  it.each([
    ['1,500.50', 150050],
    ['1.15', 115],
    ['7', 700],
    ['  7  ', 700],
    ['\t12.3\n', 1230],
    ['1.5', 150],
    ['0.05', 5],
    ['0', 0],
    ['1000', 100000],
    ['1,000', 100000],
    ['1,000,000.99', 100000099],
    ['123,456', 12345600],
  ])('parses %j as %i sen', (input, expected) => {
    expect(parseRinggitToSen(input)).toBe(expected)
  })

  it.each([
    '',
    '   ',
    '-5',
    '+5',
    '1.234',
    '1e3',
    'RM 10',
    '1,23',
    '1,5000',
    '1234,567',
    ',100',
    '1,',
    '1.',
    '.5',
    '1 000',
    '1,000.5.0',
    '1.000,50',
    '١٢',
    'NaN',
    'Infinity',
    '0x10',
    '99999999999999999',
  ])('rejects %j', (input) => {
    expect(() => parseRinggitToSen(input)).toThrow(Error)
  })
})
