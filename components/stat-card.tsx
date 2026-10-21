import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

const TONES = {
  teal: 'bg-primary/10 text-primary',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-600',
  slate: 'bg-slate-100 text-slate-600',
} as const

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'teal',
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: keyof typeof TONES
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <span className={`grid size-9 place-items-center rounded-xl ${TONES[tone]}`}>
          <Icon className="size-4.5" />
        </span>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

/** Paid-of-total bar. `value` and `max` are sen. */
export function ProgressBar({ value, max, inverted = false }: { value: number; max: number; inverted?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full ${inverted ? 'bg-white/15' : 'bg-muted'}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div
        className={`h-full rounded-full ${inverted ? 'bg-amber-300' : 'bg-primary'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
