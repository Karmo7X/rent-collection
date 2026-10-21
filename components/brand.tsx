import { KeyRound } from 'lucide-react'

/** Logo mark + wordmark. `inverted` for use on the dark brand gradient. */
export function Brand({ inverted = false, size = 'md' }: { inverted?: boolean; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-11 rounded-xl' : 'size-8 rounded-lg'
  const icon = size === 'lg' ? 'size-5' : 'size-4'
  return (
    <span className="flex items-center gap-2.5">
      <span
        className={`${box} grid place-items-center ${inverted ? 'bg-white/15 text-white ring-1 ring-white/25' : 'brand-gradient text-white shadow-sm'}`}
      >
        <KeyRound className={icon} />
      </span>
      <span className={`leading-tight ${inverted ? 'text-white' : ''}`}>
        <span className={`block font-semibold tracking-tight ${size === 'lg' ? 'text-xl' : 'text-[15px]'}`}>Sewa</span>
        <span className={`block text-[11px] ${inverted ? 'text-white/70' : 'text-muted-foreground'}`}>Rent collection</span>
      </span>
    </span>
  )
}
