'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/browser'

export function LogoutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function logout() {
    setPending(true)
    const { error } = await createClient().auth.signOut()
    if (error) {
      setPending(false)
      toast.error('Could not sign out. Please try again.')
      return
    }
    toast.success('Signed out')
    router.replace('/login')
    router.refresh()
  }

  return (
    <Button variant="outline" size="sm" onClick={logout} disabled={pending}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
