'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/browser'

// Same rule as the tenants_phone_check constraint in the database.
const PHONE_PATTERN = /^\+?[0-9][0-9 -]{5,19}$/

/**
 * Updates the phone number straight from the browser through the Data API
 * (supabase-js + the tenant's session). RLS and the column grant only allow
 * a tenant to change the phone on their own row.
 */
export function PhoneForm({ tenantId, initialPhone }: { tenantId: string; initialPhone: string }) {
  const router = useRouter()
  const [phone, setPhone] = useState(initialPhone)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const value = phone.trim()
    if (value && !PHONE_PATTERN.test(value)) {
      setError('Use digits, spaces or dashes, optionally starting with +, e.g. +60 12-345 6789.')
      return
    }
    setError(null)
    setPending(true)
    const { data, error: updateError } = await createClient()
      .from('tenants')
      .update({ phone: value || null })
      .eq('id', tenantId)
      .select('phone')
    setPending(false)
    if (updateError || !data || data.length !== 1) {
      toast.error('Could not update your phone number')
      return
    }
    toast.success('Phone number updated')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone number</Label>
        <Input
          id="phone"
          type="tel"
          placeholder="+60 12-345 6789"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={Boolean(error)}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <Button type="submit" variant="outline" className="w-full" disabled={pending}>
        {pending ? 'Saving…' : 'Save phone number'}
      </Button>
    </form>
  )
}
