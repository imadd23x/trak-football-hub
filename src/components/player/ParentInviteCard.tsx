import { useAuth } from '@/contexts/AuthContext'
import { PlayerParentInviteCard } from './PlayerParentInviteCard'

/** Profile keeps academy guidance visible even when there are no invitations. */
export function ParentInviteCard() {
  const { user } = useAuth()
  return user ? <PlayerParentInviteCard playerUserId={user.id} showWhenEmpty /> : null
}
