// Conversions at the DB / API boundary. Pure, no machine-timezone dependence.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Path/body ids that aren't UUIDs can't exist, so callers answer 404 (not a 500 from Postgres). */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

/** 'YYYY-MM-DD' -> the Date Prisma expects for a `date` column (UTC midnight). */
export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

/** A `date` column from Prisma (UTC midnight) -> 'YYYY-MM-DD'. */
export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** bigint sen from the DB -> JSON-safe number. Throws rather than lose precision. */
export function toSen(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('Amount out of safe integer range')
  }
  return Number(value)
}

const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000

/** An instant as ISO 8601 in Malaysia time with its offset, e.g. 2026-03-01T00:30:00+08:00. */
export function toMalaysiaIso(instant: Date): string {
  return new Date(instant.getTime() + MALAYSIA_OFFSET_MS).toISOString().slice(0, 19) + '+08:00'
}
