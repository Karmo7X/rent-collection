type Status =
  | 'paid'
  | 'partially_paid'
  | 'unpaid'
  | 'overdue'
  | 'pending_verification'
  | 'approved'
  | 'rejected'
  | 'voided'
  | 'pending'
  | 'failed'

const STYLES: Record<Status, { label: string; pill: string; dot: string }> = {
  paid: { label: 'Paid', pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500' },
  approved: { label: 'Approved', pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500' },
  partially_paid: { label: 'Partially paid', pill: 'bg-amber-50 text-amber-800 ring-amber-600/20', dot: 'bg-amber-500' },
  pending_verification: { label: 'Pending verification', pill: 'bg-amber-50 text-amber-800 ring-amber-600/20', dot: 'bg-amber-500' },
  pending: { label: 'Pending', pill: 'bg-amber-50 text-amber-800 ring-amber-600/20', dot: 'bg-amber-500 animate-pulse' },
  unpaid: { label: 'Unpaid', pill: 'bg-slate-50 text-slate-600 ring-slate-500/20', dot: 'bg-slate-400' },
  overdue: { label: 'Overdue', pill: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-500' },
  failed: { label: 'Failed', pill: 'bg-red-50 text-red-700 ring-red-600/20', dot: 'bg-red-500' },
  rejected: { label: 'Rejected', pill: 'bg-slate-100 text-slate-600 ring-slate-500/20', dot: 'bg-slate-400' },
  voided: { label: 'Voided', pill: 'bg-slate-100 text-slate-500 ring-slate-500/20 line-through', dot: 'bg-slate-400' },
}

export function StatusBadge({ status }: { status: Status }) {
  const style = STYLES[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${style.pill}`}
    >
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  )
}
