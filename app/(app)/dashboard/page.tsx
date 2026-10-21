import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AppShell, PageSkeleton } from '@/components/app-shell'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getPageActor } from '@/lib/auth'
import { malaysiaToday } from '@/lib/billing'
import { formatInstantMyt, formatMonth, formatSen, lastMonths } from '@/lib/format'
import { collectionsReport, overdueInvoiceCount, pendingPayments } from '@/lib/reports'

export const metadata = { title: 'Dashboard · Rent Collection' }

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Dashboard />
    </Suspense>
  )
}

async function Dashboard() {
  const actor = await getPageActor()
  if (actor.kind !== 'member') redirect('/')

  const now = new Date()
  const { from, to } = lastMonths(malaysiaToday(now), 6)
  const [overdue, report, pending] = await Promise.all([
    overdueInvoiceCount(actor, now),
    collectionsReport(actor, from, to),
    pendingPayments(actor),
  ])
  const max = Math.max(...report.map((r) => r.collectedSen), 1)

  return (
    <AppShell actor={actor}>
      <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Overdue invoices</CardDescription>
            <CardTitle className={`text-4xl ${overdue > 0 ? 'text-red-600' : ''}`}>{overdue}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Unpaid after their due date (Malaysia time).</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Collected in the last 6 months</CardDescription>
            <CardTitle className="text-4xl">{formatSen(report.reduce((s, r) => s + r.collectedSen, 0))}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {formatMonth(from)} to {formatMonth(to)}, approved payments only.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Waiting for approval</CardDescription>
            <CardTitle className="text-4xl">{pending.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Payments recorded by staff.</CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Collections, last 6 months</CardTitle>
          <CardDescription>By the month the money was received, in Malaysia time.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {report.map((row) => (
            <div key={row.month} className="grid grid-cols-[6rem_1fr_9rem] items-center gap-3 text-sm">
              <span className="text-muted-foreground">{formatMonth(row.month)}</span>
              <div className="h-3 rounded bg-muted">
                <div className="h-3 rounded bg-primary" style={{ width: `${(row.collectedSen / max) * 100}%` }} />
              </div>
              <span className="text-right tabular-nums">{formatSen(row.collectedSen)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Pending verification</CardTitle>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments are waiting for approval.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/leases/${p.leaseId}`} className="font-medium underline-offset-4 hover:underline">
                        {p.unitName}
                      </Link>
                    </TableCell>
                    <TableCell>{p.tenantName}</TableCell>
                    <TableCell>{p.method === 'bank_transfer' ? 'Bank transfer' : 'Cash'}</TableCell>
                    <TableCell>{formatInstantMyt(p.receivedAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatSen(p.amountSen)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  )
}
