# AI logs

Transcripts of the AI sessions used for this assessment (Claude Code, desktop app → Export).

| Folder | Session | Contents |
|---|---|---|
| `session-1/` | The main build session (spec → billing → database → access control → payments → webhook → UI → write-ups) | `transcript.jsonl` (full conversation, one JSON event per line), `metadata.json`, `tool-results/` (browser screenshots taken while verifying the UI) |

**Redactions:** the only changes to the export are keys of the local Supabase stack, replaced with placeholders so GitHub push protection accepts the repo:
- `sb_secret_…`
- JWTs
- the JWT secret
- the S3 keys

Nothing else was edited or removed.

**Where to look (for DECISIONS.md question 6):** search `transcript.jsonl` for
- `rent collection.pdf` / `rewrite from scratch`: the assistant had built a draft schema before the official brief and had to redo it.
- `3 FAILED`: the assistant's own test expectations were wrong, not the code.

Other corrections visible in the log:
- `Date.now()` while prerendering: a `cacheComponents` fix.
- `unstable_rethrow`: Next's internal errors were being swallowed.
- `--font-sans`: a font variable lost when `layout.tsx` was rewritten.
- `Prisma reads a unique index`: constraints rewritten so Prisma doesn't misread them as 1:1 relations.
