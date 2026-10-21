import { Clock3, ShieldCheck, Wallet } from 'lucide-react'
import { Brand } from '@/components/brand'
import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in · Sewa' }

const FEATURES = [
  { icon: Wallet, title: 'Cash, transfer or online', text: 'Every sen allocated to the oldest invoice first.' },
  { icon: ShieldCheck, title: 'Manager approval', text: 'Staff payments wait for a manager before they count.' },
  { icon: Clock3, title: 'Malaysia time, always', text: 'Due dates and receipts in MYT, wherever you are.' },
]

export default function LoginPage() {
  return (
    <main className="grid flex-1 lg:grid-cols-[1.1fr_1fr]">
      <section className="brand-gradient relative hidden overflow-hidden lg:block">
        <div className="brand-grid absolute inset-0" aria-hidden />
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-amber-300/20 blur-3xl" aria-hidden />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <Brand inverted size="lg" />
          <div className="max-w-md">
            <h1 className="text-4xl font-semibold leading-tight tracking-tight">
              Collect rent,
              <br />
              <span className="text-amber-200">not headaches.</span>
            </h1>
            <p className="mt-4 text-white/75">
              Leases, invoices and payments for Malaysian property managers, with tenants paying online in a click.
            </p>
            <ul className="mt-10 space-y-5">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20">
                    <Icon className="size-5" />
                  </span>
                  <span>
                    <span className="block font-medium">{title}</span>
                    <span className="block text-sm text-white/70">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-white/50">All amounts in MYT and RM.</p>
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to manage leases or pay your rent.</p>
          <div className="mt-8">
            <LoginForm />
          </div>
        </div>
      </section>
    </main>
  )
}
