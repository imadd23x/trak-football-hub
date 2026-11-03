/* TRAK-340 (Training redo 2/5, spec TRAK-338, 2 Nov prototype): Trak's session parts and its drill shelf, built into
   the app (Kostas, 22 Oct: no links out of Trak). The drills use standard coaching names (Mirror drill, Y-passing
   drill, FIFA 11+); a coach should still check them. The new Trak Library (Kostas, 2 Nov) is a project of its own;
   until then the shelf is grouped by part.

   `players` says how a drill takes its players, for Who's here (step 4): any number (at least `min`), pairs, two teams
   (at least `min`), or groups of about `g` (each between `lo` and `hi`), with names for some group sizes ("4 v 2"). */

export const PART_TYPES = [
  { key: 'warmup', name: 'Dry warm-up', note: 'No ball', mins: 10, options: [5, 10, 15],
    guide: 'Get them moving before the ball comes out. Short and lively, so nobody stands still.' },
  { key: 'passing', name: 'Passing & movement', note: 'With the ball', mins: 15, options: [10, 15, 20],
    guide: 'A ball for every few players. Pass, then move into a new space straight away.' },
  { key: 'rondo', name: 'Rondo', note: 'Keep the ball', mins: 15, options: [10, 15, 20],
    guide: 'Keep the ball under pressure. Whoever loses it goes in the middle.' },
  { key: 'functional', name: 'Functional drills', note: 'Passing and finishing', mins: 25, options: [20, 25, 30],
    guide: 'Passing that ends in a shot. Pick one with a transition if you want them to react the moment the ball is lost.' },
  { key: 'game', name: 'Game', note: 'Everyone plays', mins: 25, options: [20, 25, 30],
    guide: 'Finish with a game. On the day, Trak splits the teams from who is here.' },
  { key: 'setpieces', name: 'Set pieces', note: 'Corners and free kicks', mins: 15, options: [10, 15, 20],
    guide: 'Walk the routine through first, then run it at full speed against defenders.' },
  { key: 'finishing', name: 'Finishing', note: 'Shots on goal', mins: 15, options: [10, 15, 20],
    guide: 'Lots of shots with both feet. Keep the queues short so nobody waits long.' },
  { key: 'cooldown', name: 'Cool-down', note: 'Easy jog and stretch', mins: 5, options: [5, 10],
    guide: 'Slow them down with an easy jog and stretches. A good moment for a quick word with the group.' },
] as const

export type ShelfPart = (typeof PART_TYPES)[number]['key']
export type PartType = ShelfPart | 'own'

/** A part the coach named: any drill fits it. */
export const OWN_PART = { key: 'own', name: 'Your own part', note: 'Your own part', mins: 15, options: [10, 15, 20, 25],
  guide: 'This part is yours. Pick any drill, or write your own.' } as const

/** Trak's session, the first time: its first five parts. */
export const STANDARD: ShelfPart[] = ['warmup', 'passing', 'rondo', 'functional', 'game']

export const partInfo = (type: PartType) => PART_TYPES.find(p => p.key === type) ?? OWN_PART

export type Players =
  | { kind: 'any'; min?: number }
  | { kind: 'pairs' }
  | { kind: 'teams'; min?: number }
  | { kind: 'groups'; g: number; lo: number; hi: number; unit: string; labels?: Record<number, string> }

const G = (g: number, lo: number, hi: number, unit: string, labels?: Record<number, string>): Players =>
  ({ kind: 'groups', g, lo, hi, unit, labels })
const RL: Record<number, string> = { 3: '2 v 1', 4: '3 v 1', 5: '4 v 1', 6: '4 v 2', 7: '5 v 2', 8: '6 v 2' }

export type ShelfDrill = { id: string; part: ShelfPart; name: string; how: string; players: Players; swap?: string }

export const SHELF: ShelfDrill[] = [
  { id: 'w1', part: 'warmup', name: 'Dynamic warm-up', how: 'Jog, high knees, heel flicks, skips and leg swings across the pitch, then three short sprints.', players: { kind: 'any', min: 1 } },
  { id: 'w2', part: 'warmup', name: 'FIFA 11+ running part', how: 'Six runs between two lines of cones: hip out, hip in, circling a partner, shoulder contact, forward and back.', players: { kind: 'pairs' }, swap: 'w1' },
  { id: 'w3', part: 'warmup', name: 'Mirror drill', how: 'In pairs, one leads with side steps, turns and stops. The other copies. Swap every 30 seconds.', players: { kind: 'pairs' }, swap: 'w1' },
  { id: 'w4', part: 'warmup', name: 'SAQ ladder circuit', how: 'Speed, agility and quickness: ladders, hurdles and poles in four stations, two minutes each.', players: { kind: 'any', min: 4 }, swap: 'w1' },
  { id: 'w5', part: 'warmup', name: 'Tag games', how: 'Stuck in the mud or chain tag inside a 20 × 20 m box. Three rounds of 90 seconds.', players: { kind: 'any', min: 6 }, swap: 'w1' },
  { id: 'w6', part: 'warmup', name: '5-10-5 shuttle runs', how: 'Sprint 5 m, turn, 10 m, turn, 5 m. Walk back to recover. Four rounds.', players: { kind: 'any', min: 1 } },
  { id: 'w7', part: 'warmup', name: 'Partner resistance runs', how: 'One holds the partner’s hips while they drive forward for 10 m. Swap after each run.', players: { kind: 'pairs' }, swap: 'w1' },
  { id: 'p1', part: 'passing', name: 'Pass and follow', how: 'A 10 m square with players on each cone. Pass, then follow your pass to the next cone.', players: G(6,4,8,'square'), swap: 'p4' },
  { id: 'p2', part: 'passing', name: 'Y-passing drill', how: 'Cones in a Y. Pass in, lay off, play through, and follow your pass each time.', players: G(6,5,8,'group'), swap: 'p4' },
  { id: 'p3', part: 'passing', name: 'Passing diamond', how: 'Four cones in a diamond. Pass and move round it, with a one-two on each side.', players: G(6,5,8,'diamond'), swap: 'p4' },
  { id: 'p4', part: 'passing', name: 'Passing in pairs on the move', how: 'Pairs pass while jogging across the area. Two touches, then one.', players: { kind: 'pairs' } },
  { id: 'p5', part: 'passing', name: 'Triangle passing', how: 'Three cones 8 m apart. Pass and follow, then switch direction on the whistle.', players: G(4,3,5,'triangle'), swap: 'p4' },
  { id: 'p6', part: 'passing', name: 'Third-man run', how: 'A plays to B, B sets for C running past. Swap roles every two minutes.', players: G(4,3,5,'group'), swap: 'p4' },
  { id: 'p7', part: 'passing', name: 'Long passing in channels', how: 'Partners 30 m apart. Driven pass, control, return. Both feet.', players: { kind: 'pairs' } },
  { id: 'r1', part: 'rondo', name: 'Rondo 4 v 2', how: '12 × 12 m square, two touches. Win it and swap with the player who lost it.', players: G(6,4,7,'grid',RL), swap: 'r4' },
  { id: 'r2', part: 'rondo', name: 'Rondo 4 v 1', how: '8 × 8 m. Good for a smaller group or a first rondo.', players: G(5,4,6,'grid',RL), swap: 'r4' },
  { id: 'r3', part: 'rondo', name: 'Rondo 6 v 3, two boxes', how: 'Two 15 × 15 m boxes side by side. Win it, then play into the other box.', players: G(9,8,10,'area',{8:'5 v 3',9:'6 v 3',10:'7 v 3'}), swap: 'r1' },
  { id: 'r4', part: 'rondo', name: 'Rondo 3 v 1', how: '6 × 6 m. Lots of touches for small groups.', players: G(4,3,5,'grid',RL) },
  { id: 'r5', part: 'rondo', name: 'Rondo 5 v 2', how: '15 × 15 m. One touch for the outside players when they’re ready.', players: G(7,6,8,'grid',RL), swap: 'r1' },
  { id: 'r6', part: 'rondo', name: 'Rondo with a target player', how: 'Keep it 4 v 2, then find the target player on the end line for a point.', players: G(7,6,8,'grid'), swap: 'r1' },
  { id: 'f1', part: 'functional', name: 'One-two and finish', how: 'Play a one-two with the wall player at the edge of the box, then shoot first time. Both feet, both sides.', players: { kind: 'any', min: 3 } },
  { id: 'f2', part: 'functional', name: 'Crossing and finishing 3 v 2', how: 'A winger crosses. Three attack the box against two defenders and a keeper.', players: G(6,5,7,'group',{5:'2 v 2 + winger',6:'3 v 2 + winger',7:'3 v 3 + winger'}), swap: 'f3' },
  { id: 'f3', part: 'functional', name: '2 v 1 to goal', how: 'Two attackers against one defender from 30 m out. Score within eight seconds.', players: G(3,3,4,'group',{3:'2 v 1',4:'2 v 2'}), swap: 'f1' },
  { id: 'f4', part: 'functional', name: 'Finishing waves with a counter', how: 'After the shot, the defenders break out to two mini goals. Has a transition.', players: G(6,5,8,'wave'), swap: 'f1' },
  { id: 'f5', part: 'functional', name: 'Counter-pressing 5 v 3', how: 'Lose the ball, win it back within five seconds or the other team scores on the mini goals.', players: G(8,7,9,'group',{7:'4 v 3',8:'5 v 3',9:'6 v 3'}), swap: 'f3' },
  { id: 'f6', part: 'functional', name: 'Overlap and cross', how: 'Wide pair: pass inside, overlap, cross for two runners attacking the near and far post.', players: { kind: 'any', min: 4 }, swap: 'f1' },
  { id: 'f7', part: 'functional', name: 'Shooting from the edge of the box', how: 'Set the ball across the D and shoot first time. Keepers swap every five shots.', players: { kind: 'any', min: 2 } },
  { id: 'f8', part: 'functional', name: 'Playing out from the back 6 v 4', how: 'Keeper, back four and a holding player against four pressers. Score by dribbling through a gate.', players: G(10,9,11,'group',{9:'6 v 3',10:'6 v 4',11:'7 v 4'}), swap: 'f2' },
  { id: 'g1', part: 'game', name: 'Free play', how: 'No rules. Let them play and watch.', players: { kind: 'teams', min: 8 }, swap: 'g4' },
  { id: 'g2', part: 'game', name: 'Conditioned game: goals from crosses count double', how: 'Pushes play wide and makes them defend the box.', players: { kind: 'teams', min: 8 }, swap: 'g4' },
  { id: 'g3', part: 'game', name: 'Conditioned game: two touches', how: 'Moves the ball quicker. Free kick to the other team if someone takes three.', players: { kind: 'teams', min: 8 }, swap: 'g4' },
  { id: 'g4', part: 'game', name: 'Small-sided games to mini goals', how: '25 × 20 m pitches, no keepers. Lots of touches and quick decisions.', players: G(8,6,10,'pitch',{6:'3 v 3',7:'4 v 3',8:'4 v 4',9:'5 v 4',10:'5 v 5'}) },
  { id: 'g5', part: 'game', name: 'End-zone game', how: 'Score by receiving the ball in the end zone. Teaches forward runs.', players: { kind: 'teams', min: 8 }, swap: 'g4' },
  { id: 'g6', part: 'game', name: 'Possession game: 10 passes = 1 point', how: 'Two teams, no goals. Ten passes in a row scores a point.', players: { kind: 'teams', min: 6 }, swap: 'g4' },
  { id: 's1', part: 'setpieces', name: 'Near-post corner flick-on', how: 'One attacks the near post and flicks the ball on. Two more arrive at the back post. Walk it, then play it live.', players: { kind: 'any', min: 6 } },
  { id: 's2', part: 'setpieces', name: 'Defending corners: zones and markers', how: 'Four hold zones across the six-yard box, the rest mark a runner each. Ten corners, then swap.', players: { kind: 'any', min: 10 }, swap: 's3' },
  { id: 's3', part: 'setpieces', name: 'Free kicks around the box', how: 'A wall of three. Each player takes five free kicks from different spots, then the keeper swaps.', players: { kind: 'any', min: 3 } },
  { id: 's4', part: 'setpieces', name: 'Throw-in patterns', how: 'Throw, set it back, switch play. Add a defender after five goes.', players: G(4,3,5,'group'), swap: 's3' },
  { id: 'n1', part: 'finishing', name: 'Lay-off and shoot in pairs', how: 'One lays the ball off, the other shoots first time. Swap after each shot, then switch sides.', players: { kind: 'pairs' } },
  { id: 'n2', part: 'finishing', name: 'Turn and shoot', how: 'Receive with your back to goal, turn past a passive defender and shoot within three touches.', players: { kind: 'any', min: 3 } },
  { id: 'n3', part: 'finishing', name: '1 v 1 against the keeper', how: 'Dribble from 30 m and beat the keeper. A defender chases from behind after one second.', players: { kind: 'any', min: 2 } },
  { id: 'n4', part: 'finishing', name: 'Volleys from a feed', how: 'Served from the side by hand, then by foot. Keep it down and strike through the middle of the ball.', players: { kind: 'pairs' } },
  { id: 'c1', part: 'cooldown', name: 'Easy jog and static stretches', how: 'Two easy laps, then hold each stretch for 20 seconds: calves, hamstrings, quads and hips.', players: { kind: 'any', min: 1 } },
  { id: 'c2', part: 'cooldown', name: 'Walking passes and team talk', how: 'Walk and pass in pairs for three minutes, then a circle: two things that went well today.', players: { kind: 'pairs' } },
  { id: 'c3', part: 'cooldown', name: 'Partner stretches', how: 'Gentle partner stretches for hamstrings, groin and quads. Twenty seconds each, then swap.', players: { kind: 'pairs' } },
]

export const shelfDrill = (id: string | null | undefined) => SHELF.find(d => d.id === id)

/** "Any number", "In pairs", "Two teams", "Groups of 6 · 4 v 2". */
export function playersShort(players: Players | null | undefined): string | null {
  if (!players) return null
  if (players.kind === 'any') return 'Any number'
  if (players.kind === 'pairs') return 'In pairs'
  if (players.kind === 'teams') return 'Two teams'
  return `Groups of ${players.g}${players.labels?.[players.g] ? ` · ${players.labels[players.g]}` : ''}`
}
