// Billing rules (SPEC.md section 3).
//
// Pure: no I/O, no framework imports, and no dependence on the machine's
// timezone. Calendar dates are handled as 'YYYY-MM-DD' strings and converted
// to whole day numbers with integer arithmetic, so `Date` is only used to read
// the instant passed to invoiceStatus (via getTime(), which is timezone-free).

export type InvoiceKind = 'deposit' | 'rent'

export interface ScheduledInvoice {
  kind: InvoiceKind
  periodIndex: number | null // 0, 1, 2... for rent; null for the deposit
  periodStart: string | null // 'YYYY-MM-DD'; null for the deposit
  periodEnd: string | null // 'YYYY-MM-DD', inclusive; null for the deposit
  dueDate: string // 'YYYY-MM-DD'
  amountSen: number // integer
}

export type InvoiceStatus = 'paid' | 'partially_paid' | 'unpaid' | 'overdue'

// Malaysia is UTC+8 all year (no daylight saving).
const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Calendar dates
// ---------------------------------------------------------------------------

interface CivilDate {
  y: number
  m: number // 1..12
  d: number // 1..31
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31
}

/** Parses a strict 'YYYY-MM-DD' that is a real calendar date, or throws. */
function parseDate(value: unknown, field: string): CivilDate {
  if (typeof value !== 'string') throw new Error(`${field} must be a 'YYYY-MM-DD' string`)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error(`${field} must be written as YYYY-MM-DD`)
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new Error(`${field} is not a real calendar date`)
  }
  return { y, m, d }
}

/**
 * Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's
 * days_from_civil). Integer-only, so it can't be affected by a timezone.
 */
function toDayNumber({ y, m, d }: CivilDate): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const mp = m > 2 ? m - 3 : m + 9
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** Inverse of toDayNumber (civil_from_days). */
function fromDayNumber(days: number): CivilDate {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d }
}

function formatDate({ y, m, d }: CivilDate): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Start date plus k calendar months, always counted from the start date.
 * If the target month is shorter than the start day, use its last day.
 */
function addMonthsClamped(start: CivilDate, k: number): CivilDate {
  const monthIndex = start.m - 1 + k
  const y = start.y + Math.floor(monthIndex / 12)
  const m = (monthIndex % 12) + 1
  return { y, m, d: Math.min(start.d, daysInMonth(y, m)) }
}

/** The calendar date in Malaysia at the given instant, as a day number. */
function malaysiaDayNumber(now: Date): number {
  const ms = now.getTime()
  if (Number.isNaN(ms)) throw new Error('now must be a valid Date')
  return Math.floor((ms + MALAYSIA_OFFSET_MS) / MS_PER_DAY)
}

/** Today's date in Malaysia as 'YYYY-MM-DD', whatever the machine's timezone. */
export function malaysiaToday(now: Date): string {
  return formatDate(fromDayNumber(malaysiaDayNumber(now)))
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * numerator / denominator rounded half up, for non-negative integers.
 * BigInt so rent x days can never lose precision.
 */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator)
}

// ---------------------------------------------------------------------------
// generateSchedule
// ---------------------------------------------------------------------------

export function generateSchedule(lease: {
  startDate: string
  endDate: string
  monthlyRentSen: number
  depositSen: number
}): ScheduledInvoice[] {
  const start = parseDate(lease.startDate, 'startDate')
  const end = parseDate(lease.endDate, 'endDate')
  const startDay = toDayNumber(start)
  const endDay = toDayNumber(end)
  if (endDay < startDay) throw new Error('endDate is before startDate')
  if (!Number.isSafeInteger(lease.monthlyRentSen) || lease.monthlyRentSen <= 0) {
    throw new Error('monthlyRentSen must be a positive integer')
  }
  if (!Number.isSafeInteger(lease.depositSen) || lease.depositSen < 0) {
    throw new Error('depositSen must be a non-negative integer')
  }

  const invoices: ScheduledInvoice[] = []

  if (lease.depositSen > 0) {
    invoices.push({
      kind: 'deposit',
      periodIndex: null,
      periodStart: null,
      periodEnd: null,
      dueDate: formatDate(start),
      amountSen: lease.depositSen,
    })
  }

  // One period for every anchor on or before endDate.
  for (let k = 0; ; k++) {
    const anchorDay = toDayNumber(addMonthsClamped(start, k))
    if (anchorDay > endDay) break
    const nextAnchorDay = toDayNumber(addMonthsClamped(start, k + 1))
    const fullLength = nextAnchorDay - anchorDay
    const periodEndDay = Math.min(nextAnchorDay - 1, endDay)
    const usedDays = periodEndDay - anchorDay + 1

    // Only the last period can be cut short by endDate.
    const amountSen =
      usedDays === fullLength
        ? lease.monthlyRentSen
        : Number(divideRoundHalfUp(BigInt(lease.monthlyRentSen) * BigInt(usedDays), BigInt(fullLength)))

    const periodStart = formatDate(fromDayNumber(anchorDay))
    invoices.push({
      kind: 'rent',
      periodIndex: k,
      periodStart,
      periodEnd: formatDate(fromDayNumber(periodEndDay)),
      dueDate: periodStart,
      amountSen,
    })
  }

  return invoices
}

// ---------------------------------------------------------------------------
// invoiceStatus
// ---------------------------------------------------------------------------

export function invoiceStatus(
  invoice: { dueDate: string; amountSen: number; paidSen: number },
  now: Date,
): InvoiceStatus {
  if (invoice.paidSen >= invoice.amountSen) return 'paid'
  // Overdue from 00:00 Malaysia time on the day after dueDate.
  if (malaysiaDayNumber(now) > toDayNumber(parseDate(invoice.dueDate, 'dueDate'))) return 'overdue'
  if (invoice.paidSen > 0) return 'partially_paid'
  return 'unpaid'
}

// ---------------------------------------------------------------------------
// parseRinggitToSen
// ---------------------------------------------------------------------------

// Digits, either plain or with comma separators in groups of exactly three,
// then an optional 1-2 digit decimal part. \d is ASCII-only without the u flag.
const RINGGIT_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/

export function parseRinggitToSen(input: string): number {
  if (typeof input !== 'string') throw new Error('Amount must be text')
  const match = RINGGIT_PATTERN.exec(input.trim())
  if (!match) throw new Error(`Invalid ringgit amount: "${input}"`)
  // String/BigInt math only: no floating point anywhere.
  const ringgit = BigInt(match[1].replace(/,/g, ''))
  const sen = BigInt((match[2] ?? '').padEnd(2, '0'))
  const total = ringgit * 100n + sen
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount is too large')
  return Number(total)
}
