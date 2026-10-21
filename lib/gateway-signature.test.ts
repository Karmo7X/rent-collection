import { describe, expect, it } from 'vitest'
import { computeSignature, isValidSignature, parseCallbackBody, signatureSource } from './gateway-signature'

const KEY = 'test_x_signature_key'
const EXAMPLE = {
  id: 'bill_8f3a2c',
  paid: 'true',
  paid_amount: '210050',
  paid_at: '2026-04-01 00:30:12 +0800',
  transaction_id: 'TX-000123',
  transaction_status: 'completed',
}
const EXPECTED = '06994fab2d674e7829144eaa2204631716d3c099b503d38945e92b6296531641'

describe('gateway signature', () => {
  it('matches the test vector in the brief', () => {
    expect(signatureSource(EXAMPLE)).toBe(
      'idbill_8f3a2c|paidtrue|paid_amount210050|paid_at2026-04-01 00:30:12 +0800|transaction_idTX-000123|transaction_statuscompleted',
    )
    expect(computeSignature(EXAMPLE, KEY)).toBe(EXPECTED)
  })

  it('accepts the right signature and excludes x_signature from the source', () => {
    expect(isValidSignature({ ...EXAMPLE, x_signature: EXPECTED }, KEY)).toBe(true)
  })

  it('rejects missing, wrong, uppercase, short or tampered signatures', () => {
    expect(isValidSignature(EXAMPLE, KEY)).toBe(false)
    expect(isValidSignature({ ...EXAMPLE, x_signature: '0'.repeat(64) }, KEY)).toBe(false)
    expect(isValidSignature({ ...EXAMPLE, x_signature: EXPECTED.toUpperCase() }, KEY)).toBe(false)
    expect(isValidSignature({ ...EXAMPLE, x_signature: EXPECTED.slice(0, 10) }, KEY)).toBe(false)
    expect(isValidSignature({ ...EXAMPLE, paid_amount: '210051', x_signature: EXPECTED }, KEY)).toBe(false)
    expect(isValidSignature({ ...EXAMPLE, x_signature: EXPECTED }, 'other_key')).toBe(false)
  })

  it('includes fields the gateway adds later', () => {
    const withExtra = { ...EXAMPLE, currency: 'MYR' }
    expect(isValidSignature({ ...withExtra, x_signature: EXPECTED }, KEY)).toBe(false)
    expect(isValidSignature({ ...withExtra, x_signature: computeSignature(withExtra, KEY) }, KEY)).toBe(true)
  })

  it('parses a form body and refuses repeated field names', () => {
    const body = new URLSearchParams({ ...EXAMPLE, x_signature: EXPECTED }).toString()
    expect(parseCallbackBody(body)).toEqual({ ...EXAMPLE, x_signature: EXPECTED })
    expect(parseCallbackBody(`${body}&paid=false`)).toBeNull()
  })
})
