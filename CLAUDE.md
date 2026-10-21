# Rent Collection System: Working Plan for Claude Code

This is a timed (4h) technical assessment. I am the developer; you are my pair. The graders run hidden tests on edge cases, read our session logs, and will ask me to walk through every line in an interview. So: **correctness first, small steps, explain every non-obvious decision, never write code I can't explain.**

@AGENTS.md

## 0. Task requirements

The official brief is in `SPEC.md` and **overrides everything below**. Names in it (tables, columns, endpoints, file paths, response shapes) are a contract with the hidden tests: use them exactly.

@SPEC.md

If the spec is ambiguous, list the ambiguities and ask me before choosing. Edge cases live in `EDGE_CASES.md`.

## 1. Fixed stack and environment

- Next.js 16 (App Router) + TypeScript strict, no `any`. Check `node_modules/next/dist/docs/` for Next 16 conventions (e.g. `middleware.ts` is now `proxy.ts`).
- Supabase **local** (Docker). API `http://127.0.0.1:54321`, DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
- Prisma **pinned to 7.10.1** (exact). Never `prisma@latest`. Prisma 7 needs the driver adapter (`@prisma/adapter-pg` + `pg`).
- shadcn/ui + Tailwind.
- Env vars live in `.env.local` (gitignored). `.env.example` is committed with working local values and a comment per variable. `SUPABASE_SECRET_KEY` is server-only, never `NEXT_PUBLIC_`, only imported from `server-only` modules.
- **SQL migrations in `supabase/migrations/` are the source of truth.** Prisma schema comes from `npx prisma db pull` then `npx prisma generate`. Never `prisma migrate`.
- Seed data is created by `npm run seed` through the app's own services (not SQL).

## 2. Hard rules

1. **Money**: integer sen (`bigint` in DB). No floats anywhere, ever. Prisma `BigInt` is not JSON-serializable: convert to `number` at the API boundary.
2. **Time**: business timezone is fixed `Asia/Kuala_Lumpur` (UTC+8, no DST). Calendar values are `date`, instants are `timestamptz`. "Today" is always the Malaysia date, never the server's. Date logic lives in `lib/billing.ts` (pure, tested under 3 TZs).
3. **Authorization is server-side.** Prisma connects as the DB owner and bypasses RLS, so every handler: resolves the user (`getUser`, Bearer or cookie), loads role/org from `memberships` / `tenants.user_id`, scopes every query. 404 for other org/tenant, 403 for wrong role, 401 for no login. Never trust ids or roles from the client.
4. **Concurrency**: every money operation is one transaction that first locks the lease row (`SELECT ... FOR UPDATE`).
5. DB constraints do the heavy lifting (CHECK, UNIQUE, FK, exclusion), not just app code.
6. No new dependency without telling me why.
7. After every migration: `npx supabase db reset`, then `npx prisma db pull && npx prisma generate`, then tests.

## 3. Working process

- Small vertical steps. After each: show what changed, explain the decision in 2-3 sentences, run tests, commit with a meaningful message.
- When you make a choice I did not ask for, say so explicitly.
- Do not delete or rewrite session history/logs (they go to `ai-logs/`).
- Priority if time runs short: billing → access control → payments → webhook → UI. Record skipped work in README.
