// The one place that names publicly-known credentials.
//
// Both guards import this rather than one parsing the other:
//   * src/__tests__/no-committed-credentials.test.ts  — source scan, pre-commit and CI
//   * scripts/check-bundle-secrets.mjs                — build-output scan, after npm run build
//
// A rotated or live value must NEVER be added. Writing a working credential
// here would recommit the thing these guards exist to prevent. Everything below
// is already public and must never work again.
export const BURNED = ['TrakDev123', 'RehearsalTrak123']

// The only files permitted to contain a burned value, because naming them is
// their purpose. Asserted as an exact set by the source guard, so a third file
// cannot quietly join them.
export const ALLOWED_TO_NAME_THEM = [
  'docs/reviews/credential-boundary-2026-09-19.md',
  'scripts/burned-credentials.mjs',
  'src/__tests__/no-committed-credentials.test.ts',
]
