'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { postJson } from '@/lib/api-client'
import { parseRinggitToSen } from '@/lib/billing'
import { formatSen, malaysiaLocalInputToIso } from '@/lib/format'
import { createClient } from '@/lib/supabase/browser'

const SLIP_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' }
const MAX_SLIP_BYTES = 5 * 1024 * 1024
const METHODS = { cash: 'Cash', bank_transfer: 'Bank transfer' }

type Method = keyof typeof METHODS

export function RecordPaymentForm({
  leaseId,
  orgId,
  defaultReceivedAt,
}: {
  leaseId: string
  orgId: string
  defaultReceivedAt: string // 'YYYY-MM-DDTHH:mm', Malaysia time
}) {
  const router = useRouter()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<Method>('cash')
  const [receivedAt, setReceivedAt] = useState(defaultReceivedAt)
  const [slip, setSlip] = useState<File | null>(null)
  const [errors, setErrors] = useState<Partial<Record<'amount' | 'receivedAt' | 'slip', string>>>({})
  const [pending, setPending] = useState(false)

  let preview: string | null = null
  try {
    preview = amount.trim() ? formatSen(parseRinggitToSen(amount)) : null
  } catch {
    preview = null
  }

  function validate() {
    const next: typeof errors = {}
    let amountSen = 0
    try {
      amountSen = parseRinggitToSen(amount)
      if (amountSen <= 0) next.amount = 'Enter an amount above RM 0.00.'
    } catch {
      next.amount = 'Use digits like 1,500.50 (no "RM", at most 2 decimals).'
    }
    const receivedIso = malaysiaLocalInputToIso(receivedAt)
    if (!receivedIso) next.receivedAt = 'Pick the date and time the money was received.'
    if (method === 'bank_transfer') {
      if (!slip) next.slip = 'Attach the bank transfer slip.'
      else if (!SLIP_TYPES[slip.type]) next.slip = 'The slip must be a JPEG, PNG or PDF.'
      else if (slip.size > MAX_SLIP_BYTES) next.slip = 'The slip must be 5 MB or smaller.'
    }
    setErrors(next)
    return Object.keys(next).length === 0 ? { amountSen, receivedIso: receivedIso! } : null
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const valid = validate()
    if (!valid) return
    setPending(true)
    try {
      let slipPath: string | undefined
      if (method === 'bank_transfer' && slip) {
        // Uploaded with the user's own session: Storage RLS allows only their org's folder.
        slipPath = `${orgId}/${crypto.randomUUID()}.${SLIP_TYPES[slip.type]}`
        const { error } = await createClient()
          .storage.from('payment-slips')
          .upload(slipPath, slip, { contentType: slip.type })
        if (error) throw new Error(`Slip upload failed: ${error.message}`)
      }
      // If this fails, the server removes the uploaded slip.
      const result = await postJson<{ id: string; status: string }>(`/api/leases/${leaseId}/payments`, {
        amountSen: valid.amountSen,
        method,
        receivedAt: valid.receivedIso,
        ...(slipPath ? { slipPath } : {}),
      })
      toast.success(result.status === 'approved' ? 'Payment recorded and approved' : 'Payment recorded, waiting for approval')
      setAmount('')
      setSlip(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record the payment')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="amount">Amount (RM)</Label>
        <Input
          id="amount"
          inputMode="decimal"
          placeholder="1,500.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={Boolean(errors.amount)}
        />
        {errors.amount ? (
          <p className="text-sm text-destructive">{errors.amount}</p>
        ) : (
          preview && <p className="text-xs text-muted-foreground">= {preview}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label>Method</Label>
        <Select items={METHODS} value={method} onValueChange={(value) => value && setMethod(value as Method)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="bank_transfer">Bank transfer</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="receivedAt">Received (Malaysia time)</Label>
        <Input
          id="receivedAt"
          type="datetime-local"
          value={receivedAt}
          onChange={(e) => setReceivedAt(e.target.value)}
          aria-invalid={Boolean(errors.receivedAt)}
        />
        {errors.receivedAt && <p className="text-sm text-destructive">{errors.receivedAt}</p>}
      </div>
      {method === 'bank_transfer' && (
        <div className="space-y-2">
          <Label htmlFor="slip">Transfer slip (JPEG, PNG or PDF, max 5 MB)</Label>
          <Input
            id="slip"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(e) => setSlip(e.target.files?.[0] ?? null)}
            aria-invalid={Boolean(errors.slip)}
          />
          {errors.slip && <p className="text-sm text-destructive">{errors.slip}</p>}
        </div>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? 'Recording…' : 'Record payment'}
      </Button>
    </form>
  )
}
