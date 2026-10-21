import { prisma } from '@/lib/prisma'
import { forbidden } from '@/lib/errors'

// No Next.js imports here: the seed script uses this outside Next.

/**
 * Who is calling. Role and org come ONLY from our tables (memberships, or
 * tenants.user_id), never from user_metadata or the request.
 */
export type Actor =
  | { kind: 'member'; userId: string; orgId: string; role: 'manager' | 'staff' }
  | { kind: 'tenant'; userId: string; orgId: string; tenantId: string }
  // Valid login but no membership and no tenant row: sees nothing.
  | { kind: 'none'; userId: string }

export type MemberActor = Extract<Actor, { kind: 'member' }>

/** Resolves an authenticated user id to an Actor from our tables. */
export async function loadActor(userId: string): Promise<Actor> {
  const membership = await prisma.memberships.findUnique({ where: { user_id: userId } })
  if (membership) {
    return { kind: 'member', userId, orgId: membership.org_id, role: membership.role }
  }
  const tenant = await prisma.tenants.findUnique({ where: { user_id: userId } })
  if (tenant) {
    return { kind: 'tenant', userId, orgId: tenant.org_id, tenantId: tenant.id }
  }
  return { kind: 'none', userId }
}

/** 403 unless the actor is a member with one of the given roles. */
export function requireRole(actor: Actor, ...roles: Array<'manager' | 'staff'>): asserts actor is MemberActor {
  if (actor.kind !== 'member' || !roles.includes(actor.role)) throw forbidden()
}
