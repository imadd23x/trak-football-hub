#!/usr/bin/env node
// Retired: the old tool inherited a live target and could report partial success.
console.error('Retired legacy demo tool. Preview a deterministic synthetic manifest with:');
console.error('  npm run demo:plan -- --as-of YYYY-MM-DD');
console.error('Read docs/demo-data.md for explicit-target apply, credentials and verification. No purge is supported.');
process.exitCode = 1;
