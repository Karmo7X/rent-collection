import 'server-only'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

// Prisma connects as the database owner and BYPASSES RLS.
// Every query must be scoped by the caller's org/tenant in our services.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

// One client per process (Next dev hot reload would otherwise open new pools).
export const prisma = globalForPrisma.prisma ?? createPrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]
/** Either the client or an open transaction. */
export type Db = PrismaClient | Tx
