/** A page retry replaces the SDK lifecycle instead of queueing another restore. */
export function AccountLoading({ error }: { error?: string | null }) {
  if (!error) return <p role="status" aria-label="Account access" className="text-sm text-muted-foreground">Checking your account…</p>;
  return <section aria-label="Account connection" className="w-full max-w-sm space-y-4 text-center">
    <p role="alert" className="text-sm text-muted-foreground">{error}</p>
    <button type="button" onClick={() => window.location.reload()}
      className="min-h-11 w-full rounded-xl border border-border p-3 text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      Try again
    </button>
  </section>;
}
