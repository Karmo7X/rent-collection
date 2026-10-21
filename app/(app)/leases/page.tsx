import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { AppShell, PageSkeleton } from '@/components/app-shell'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getPageActor } from '@/lib/auth'
import { formatDate, formatSen } from '@/lib/format'
import { listLeases } from '@/lib/leases'

export const metadata = { title: 'Leases · Rent Collection' }

export default function LeasesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Leases />
    </Suspense>
  )
}

async function Leases() {
  const actor = await getPageActor()
  if (actor.kind !== 'member') redirect('/')
  const leases = await listLeases(actor)

  return (
    <AppShell actor={actor}>
      <h1 className="mb-6 text-2xl font-semibold">Leases</h1>
      <Card>
        <CardContent>
          {leases.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No leases yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Term</TableHead>
                  <TableHead className="text-right">Monthly rent</TableHead>
                  <TableHead className="text-right">Paid / total</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leases.map((lease) => (
                  <TableRow key={lease.id}>
                    <TableCell>
                      <Link href={`/leases/${lease.id}`} className="font-medium underline-offset-4 hover:underline">
                        {lease.unitName}
                      </Link>
                    </TableCell>
                    <TableCell>{lease.tenantName}</TableCell>
                    <TableCell>
                      {formatDate(lease.startDate)} – {formatDate(lease.endDate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatSen(lease.monthlyRentSen)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatSen(lease.paidSen)} / {formatSen(lease.totalSen)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatSen(lease.totalSen - lease.paidSen)}</TableCell>
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
