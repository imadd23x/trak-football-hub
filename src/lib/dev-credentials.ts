// Local development accounts. NEVER put the password in this file.
//
// It used to be a literal in DevSetupPage.tsx and DevSwitcher.tsx. The route is
// registered behind `import.meta.env.DEV`, which stops the ROUTE existing in
// production — it does not stop Rollup emitting the lazy chunk. The built
// bundle shipped dist/assets/DevSetupPage-*.js containing the password twelve
// times, referenced from the entry bundle, on a public site. CLAUDE.md said at
// the time: "Real credentials live in your local Supabase project — never
// committed." They were committed, and they were served.
//
// Reading it from the environment means the literal cannot exist in any build,
// whether or not the chunk is emitted and whether or not the route is reachable.
export const DEV_PASSWORD: string | undefined = import.meta.env.VITE_DEV_PASSWORD

/** Throws rather than attempting a sign-in that would silently fail. */
export function requireDevPassword(): string {
  if (!import.meta.env.DEV) {
    throw new Error('Development sign-in is not available in this build.')
  }
  if (!DEV_PASSWORD) {
    throw new Error(
      'Set VITE_DEV_PASSWORD in your local .env to use the development accounts. '
      + 'It is deliberately not committed.',
    )
  }
  return DEV_PASSWORD
}
