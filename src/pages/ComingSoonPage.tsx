import { Link } from 'react-router-dom'
import { MobileShell } from '@/components/trak'

export default function ComingSoonPage({ feature, home }: { feature: string; home: string }) {
  return <MobileShell>
    <main className="py-16 space-y-4">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{feature}</p>
      <h1 className="text-3xl font-semibold text-foreground">Coming soon</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">This feature will be available in a future update.</p>
      <Link to={home} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-primary">Back to home</Link>
    </main>
  </MobileShell>
}
