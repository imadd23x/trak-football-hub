import { MobileShell } from '@/components/trak/MobileShell';
import { Link } from 'react-router-dom';
export default function StaffInviteRequired() {
  return <MobileShell><main className="py-12 space-y-6 text-foreground">
    <h1 className="text-2xl">Join through your academy</h1>
    <p>Coaches receive a personal invitation from their academy administrator. Academy administrators receive an activation link from Trak.</p>
    <p className="text-muted-foreground">Open that link in your email to activate your account. Shared academy codes cannot activate staff access.</p>
    <Link className="text-primary inline-flex min-h-11 items-center" to="/">Back to sign in</Link>
  </main></MobileShell>;
}
