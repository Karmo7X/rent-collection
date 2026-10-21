import type { ReactNode } from 'react'
import { StatusBadge } from '@/components/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, formatInstantMyt, formatSen } from '@/lib/format'
import type { LeaseDetail } from '@/lib/leases'

const METHOD_LABEL = { cash: 'Cash', bank_transfer: 'Bank transfer', online: 'Online' } as const

export function InvoiceTable({ invoices }: { invoices: LeaseDetail['invoices'] }) {
  if (invoices.length === 0) return <p className="text-sm text-muted-foreground">This lease has no invoices.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice</TableHead>
          <TableHead>Period</TableHead>
          <TableHead>Due</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Paid</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => (
          <TableRow key={invoice.id}>
            <TableCell>{invoice.kind === 'deposit' ? 'Deposit' : `Rent #${(invoice.periodIndex ?? 0) + 1}`}</TableCell>
            <TableCell>
              {invoice.periodStart ? `${formatDate(invoice.periodStart)} – ${formatDate(invoice.periodEnd)}` : '-'}
            </TableCell>
            <TableCell>{formatDate(invoice.dueDate)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatSen(invoice.amountSen)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatSen(invoice.paidSen)}</TableCell>
            <TableCell>
              <StatusBadge status={invoice.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function PaymentTable({
  payments,
  slipUrls = {},
  reasons = {},
  renderActions,
}: {
  payments: LeaseDetail['payments']
  slipUrls?: Record<string, string>
  reasons?: Record<string, string | null>
  renderActions?: (payment: LeaseDetail['payments'][number]) => ReactNode
}) {
  if (payments.length === 0) return <p className="text-sm text-muted-foreground">No payments yet.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Received</TableHead>
          <TableHead>Method</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Unapplied</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Slip</TableHead>
          {renderActions && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((payment) => (
          <TableRow key={payment.id}>
            <TableCell>{formatInstantMyt(payment.receivedAt)}</TableCell>
            <TableCell>{METHOD_LABEL[payment.method]}</TableCell>
            <TableCell className="text-right tabular-nums">{formatSen(payment.amountSen)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {payment.unappliedSen > 0 ? formatSen(payment.unappliedSen) : '-'}
            </TableCell>
            <TableCell>
              <StatusBadge status={payment.status} />
              {reasons[payment.id] && <p className="mt-1 text-xs text-muted-foreground">{reasons[payment.id]}</p>}
            </TableCell>
            <TableCell>
              {slipUrls[payment.id] ? (
                <a href={slipUrls[payment.id]} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">
                  View slip
                </a>
              ) : (
                '-'
              )}
            </TableCell>
            {renderActions && <TableCell className="text-right">{renderActions(payment)}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
