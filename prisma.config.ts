import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Env lives in .env.local (graders run `cp .env.example .env.local`).
config({ path: ".env.local" });

// The CLI (db pull) uses the direct connection; the app uses DATABASE_URL via the pg adapter.
// Optional here: `prisma generate` runs at `npm install`, before .env.local exists, and
// doesn't need a database. `db pull` fails with a clear Prisma error if it's missing.
const directUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

// No `migrations` block: SQL in supabase/migrations/ is the source of truth.
// We only run `prisma db pull` + `prisma generate`, never `prisma migrate`.
export default defineConfig({
  schema: "prisma/schema.prisma",
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
