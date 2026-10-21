import { createHmac, timingSafeEqual } from 'node:crypto'

// Gateway callback signature (SPEC.md section 5). No Next/DB imports: unit-tested directly.

export type CallbackFields = Record<string, string>

/**
 * Parses an application/x-www-form-urlencoded body. Returns null if a field
 * name appears twice: the signature can't be verified unambiguously then.
 */
export function parseCallbackBody(rawBody: string): CallbackFields | null {
  const fields: CallbackFields = {}
  for (const [key, value] of new URLSearchParams(rawBody)) {
    if (Object.hasOwn(fields, key)) return null
    fields[key] = value
  }
  return fields
}

/**
 * Every field except x_signature, sorted by key (by UTF-16 code unit, which
 * is JS's default sort), each written as key immediately followed by value,
 * joined with '|'. New fields the gateway adds later are included automatically.
 */
export function signatureSource(fields: CallbackFields): string {
  return Object.keys(fields)
    .filter((key) => key !== 'x_signature')
    .sort()
    .map((key) => `${key}${fields[key]}`)
    .join('|')
}

/** HMAC-SHA256 of the source string, lowercase hex. */
export function computeSignature(fields: CallbackFields, secretKey: string): string {
  return createHmac('sha256', secretKey).update(signatureSource(fields)).digest('hex')
}

/** Constant-time check of x_signature. Missing or malformed signatures are just invalid. */
export function isValidSignature(fields: CallbackFields, secretKey: string): boolean {
  const given = fields.x_signature
  if (typeof given !== 'string' || !/^[0-9a-f]{64}$/.test(given)) return false
  const expected = Buffer.from(computeSignature(fields, secretKey), 'hex')
  return timingSafeEqual(expected, Buffer.from(given, 'hex'))
}
