'use client'

import { ArrowRight, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/browser'

// Seeded demo accounts (emails only; the shared password is in the README).
const DEMO_ACCOUNTS = [
  { email: 'manager@northwind.test', label: 'Manager' },
  { email: 'staff@northwind.test', label: 'Staff' },
  { email: 'aisyah@northwind.test', label: 'Tenant' },
]

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setPending(true)
    setError(null)
    const { error: signInError } = await createClient().auth.signInWithPassword({ email: email.trim(), password })
    if (signInError) {
      setPending(false)
      setError('Wrong email or password.')
      toast.error('Sign in failed')
      return
    }
    toast.success('Signed in')
    // The home page sends each role to the right place.
    router.replace('/')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.test"
          className="h-11"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          className="h-11"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" className="h-11 w-full text-[15px]" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>

      <div className="pt-2">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Demo accounts</p>
        <div className="flex flex-wrap gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => setEmail(account.email)}
              className="rounded-full border bg-card px-3 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
            >
              {account.label}
            </button>
          ))}
        </div>
      </div>
    </form>
  )
}
