// Display helpers. Pure and deterministic: the same output on the server and
// in any browser timezone, so there are no hydration mismatches.

const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 150050 -> 'RM 1,500.50'. Integer math only. */
export function formatSen(sen: number): string {
  const negative = sen < 0
  const abs = Math.abs(sen)
  const ringgit = Math.floor(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  return `${negative ? '-' : ''}RM ${ringgit.toLocaleString('en-US')}.${cents}`
}

/** 'YYYY-MM-DD' (a calendar date, no timezone) -> '31 Jan 2026'. */
export function formatDate(date: string | null): string {
  if (!date) return '-'
  const [y, m, d] = date.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`
}

/** An instant -> Malaysia wall-clock time, e.g. '1 Mar 2026, 00:30 MYT'. */
export function formatInstantMyt(instant: string | Date): string {
  const shifted = new Date(new Date(instant).getTime() + MALAYSIA_OFFSET_MS).toISOString()
  return `${formatDate(shifted.slice(0, 10))}, ${shifted.slice(11, 16)} MYT`
}

/** 'YYYY-MM' -> 'Jan 2026'. */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-')
  return `${MONTHS[Number(m) - 1]} ${y}`
}

/** Current Malaysia time as a <input type="datetime-local"> value: 'YYYY-MM-DDTHH:mm'. */
export function malaysiaNowLocalInput(now: Date): string {
  return new Date(now.getTime() + MALAYSIA_OFFSET_MS).toISOString().slice(0, 16)
}

/** A datetime-local value typed in Malaysia time -> ISO 8601 with offset. */
export function malaysiaLocalInputToIso(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+08:00` : null
}

/** The last n calendar months ending with the month of `today` ('YYYY-MM-DD'), as YYYY-MM. */
export function lastMonths(today: string, n: number): { from: string; to: string } {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7)) - 1
  const startIndex = year * 12 + month - (n - 1)
  const from = `${Math.floor(startIndex / 12)}-${String((startIndex % 12) + 1).padStart(2, '0')}`
  return { from, to: today.slice(0, 7) }
}
