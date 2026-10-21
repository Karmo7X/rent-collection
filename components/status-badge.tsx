import { Badge } from '@/components/ui/badge'

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

const STYLES: Record<Status, { label: string; className: string }> = {
  paid: { label: 'Paid', className: 'bg-emerald-100 text-emerald-800' },
  approved: { label: 'Approved', className: 'bg-emerald-100 text-emerald-800' },
  partially_paid: { label: 'Partially paid', className: 'bg-amber-100 text-amber-800' },
  pending_verification: { label: 'Pending verification', className: 'bg-amber-100 text-amber-800' },
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800' },
  unpaid: { label: 'Unpaid', className: 'bg-slate-100 text-slate-700' },
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-800' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800' },
  rejected: { label: 'Rejected', className: 'bg-slate-200 text-slate-700' },
  voided: { label: 'Voided', className: 'bg-slate-200 text-slate-700 line-through' },
}

export function StatusBadge({ status }: { status: Status }) {
  const style = STYLES[status]
  return <Badge className={`border-0 ${style.className}`}>{style.label}</Badge>
}
