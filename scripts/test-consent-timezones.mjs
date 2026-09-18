import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const vitest = resolve(root, 'node_modules/vitest/vitest.mjs');
const timezones = ['UTC', 'Asia/Dubai', 'Europe/Athens', 'America/New_York'];

// Start a new runtime per timezone. Changing process.env.TZ within a browser
// simulation is not reliable evidence of device-independent calendar behavior.
for (const timezone of timezones) {
  console.log(`Consent calendar regression timezone: ${timezone}`);
  const result = spawnSync(process.execPath, [vitest, 'run', 'src/lib/__tests__/consent.test.ts'], {
    cwd: root,
    env: { ...process.env, TZ: timezone },
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    if (result.error) console.error(result.error.message);
    process.exitCode = result.status || 1;
    break;
  }
}
