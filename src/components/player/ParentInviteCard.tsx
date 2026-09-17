import { useAuth } from '@/contexts/AuthContext'
import { PlayerParentInviteCard } from './PlayerParentInviteCard'

/** Profile entry point: creation and recovery share the home screen's expiry rules. */
export function ParentInviteCard() {
  const { user } = useAuth()
  return user ? <PlayerParentInviteCard playerUserId={user.id} allowCreate /> : null
}
