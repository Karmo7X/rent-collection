/** An error that maps to an HTTP status and a safe, user-facing message. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export const unauthorized = () => new HttpError(401, 'Not signed in')
// One message for "doesn't exist" and "not yours", so 404 reveals nothing.
export const notFound = () => new HttpError(404, 'Not found')
export const forbidden = () => new HttpError(403, 'Forbidden')
export const badRequest = (message: string) => new HttpError(400, message)
export const conflict = (message: string) => new HttpError(409, message)
export const unprocessable = (message: string) => new HttpError(422, message)

// Stands in for a request body that wasn't valid JSON, so services can reject
// it with 400 only AFTER their 404/403 checks.
export const INVALID_JSON = Symbol('invalid-json')

/**
 * Postgres SQLSTATE of a database error raised through Prisma's pg adapter,
 * e.g. '23P01' (exclusion violation). Prisma wraps driver errors differently
 * by kind, so look in the places it can appear.
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const e = current as {
      code?: unknown
      meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } }; code?: unknown }
      cause?: unknown
    }
    const fromAdapter = e.meta?.driverAdapterError?.cause?.originalCode
    if (typeof fromAdapter === 'string') return fromAdapter
    if (typeof e.meta?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.meta.code)) return e.meta.code
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code
    current = e.cause
  }
  return undefined
}
