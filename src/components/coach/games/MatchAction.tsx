import { useNavigate } from 'react-router-dom'
import { actionLink, matchActions, type GameState } from '@/lib/games/loop'
import { SplitButton } from '@/components/arc/split-button/split-button'

/* TRAK-333 (Imad, 2 Nov): every match action is an Arc split button: the next action (or View plan once a plan is
   shared or scheduled), and behind the chevron the match's other pages. Matches' Next match card, Home's Needs you and
   the week's next step use it. Nothing while the match is on, or once it's published. */
export function MatchAction({ state, eventId }: { state: GameState; eventId: string }) {
  const navigate = useNavigate()
  const actions = matchActions(state)
  if (!actions) return null
  return <span className="arc"><SplitButton label={actions.main.label} onClick={() => navigate(actionLink(eventId, actions.main))}
    actions={actions.more.map(action => ({ label: action.label, onSelect: () => navigate(actionLink(eventId, action)) }))} /></span>
}
