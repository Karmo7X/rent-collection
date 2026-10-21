// Runs the test suite once per timezone the graders use (SPEC.md "Hidden tests").
// Extra args are passed to vitest, e.g. `npm test -- lib/billing.test.ts`.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const timezones = ['UTC', 'Asia/Kuala_Lumpur', 'America/New_York']

let failed = false
for (const tz of timezones) {
  console.log(`\n=== TZ=${tz} ===`)
  const result = spawnSync(process.execPath, [vitest, 'run', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, TZ: tz },
  })
  if (result.status !== 0) failed = true
}

process.exit(failed ? 1 : 0)
