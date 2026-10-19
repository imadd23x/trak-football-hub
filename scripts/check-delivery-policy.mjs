import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Historical evidence stays readable, but cannot become today's work instructions.
const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).trim().split('\n');
const historicalMarker = '<!-- delivery-policy: historical -->';
const retired = [
  /(?:obtain|request|requires?|needs?)\s+(?:an?\s+)?(?:independent|non-author|teammate|code-owner)\s+(?:human\s+)?(?:review|approval)/i,
  /(?:independent|non-author|teammate|code-owner)\s+(?:human\s+)?(?:review|approval).{0,70}(?:required|before merge|before release)/i,
  /before marking Done/i,
  /(?:pre-commit|per-commit).{0,60}(?:must|runs? the|gate|required)/i,
];
const problems = [];
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  if (content.startsWith(historicalMarker)) continue;
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/\b(no |not |optional|retired|removed|supersed|off\b|zero\b)/i.test(line)) continue;
    if (retired.some(pattern => pattern.test(line))) problems.push(`${file}:${index + 1}: ${line.trim()}`);
  }
}
if (problems.length) {
  console.error('Retired delivery instructions found. Use docs/release/merge-gate.md; mark historical records explicitly.\n' + problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Delivery policy checked in ${files.length} Markdown files.`);
}
