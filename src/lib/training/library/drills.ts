import type { DrillTypeName, Kind } from './kinds'

/* TRAK-385 (Drill Library 1/11, parent TRAK-384): the Library's drills. For now these are the 8 Nov mockup's 44 sample
   drills, written by Claude and not yet checked by Steve. TRAK-388 (Drill Library 10/11): the real library, from the
   pick list Kostas marked on 9 Nov. Trak's built-in shelf (../shelf.ts) and the useful FA sessions were pooled, merged
   and rewritten in our own words: the samples stay (two retired), 15 are new, Cool-down joins Get ready. Steve checks
   the wording after the pilot (Kostas, 9 Nov), so the pages don't say it's unchecked. Kostas, 6 Nov:
   a coach can never change a Trak drill, only bookmark it, so each one lives here, not in the database.

   Every id starts with `lib-`, so a saved plan's `trak_drill` from the old shelf (`w1`, `p1`, `r1`… in ../shelf.ts)
   never finds a Library drill. An id never changes once a plan can name it, even if the drill is renamed. */

/** How Trak sets a drill out for any number of players. One per drill; ./fit.ts holds the numbers. */
export type Template =
  | 'warm'    // everyone in one box, no ball
  | 'free'    // pairs moving anywhere, a ball each
  | 'pairs'   // partners facing each other
  | 'groups'  // groups of about five on the cones of a square
  | 'square'  // keep the ball in a square: attackers v defenders, in one or two grids
  | 'func'    // attackers v defenders at one goal, in turns
  | 'funcm'   // even teams at one goal with a keeper, in their positions
  | 'game'    // two teams towards targets
  | 'shoot'   // shots at goal, or serves to a keeper

/** Who the drill is for: the team, one player (also good with a private coach), or the keepers. */
export type Focus = 'team' | 'individual' | 'goalkeeping'

export type LibraryDrill = {
  id: string
  name: string
  kind: Kind
  /** Its drill type within the kind, from ./kinds.ts. */
  type: DrillTypeName
  focus: Focus
  template: Template
  /** The drill's own rule, the same at every level, or one per level (8, easiest first). */
  rule?: string | readonly string[]
  /** What the players aim for, when it isn't the template's usual one. */
  targets?: string
  /** For the pitch picture (TRAK-386): marks drawn on top of the template. */
  overlay?: 'quarters' | 'wide' | 'split' | 'endzones' | 'gates' | 'middle' | 'gate' | 'target'
  /** groups: the inside players shadow the passers rather than receive. */
  shadow?: boolean
  /** square: every attacker has a ball. */
  ballEach?: boolean
  /** square: always this many grids. */
  grids?: 2
  /** square: a third of the players hunt the ball. */
  third?: boolean
  /** game: no goals, keep the ball. */
  noGoals?: boolean
  /** game: one team has a keeper. */
  keeper?: boolean
  /** shoot: shots come from different angles. */
  angle?: boolean
  /** pairs: partners 20 to 40 m apart (long passes, a keeper's distribution). */
  long?: boolean
  /** free: a ball each and no partner. */
  solo?: boolean
  /** func: always this many attackers v defenders in each turn. */
  group?: readonly [attackers: number, defenders: number]
  why: string
  how: readonly string[]
  watch: readonly string[]
  /** Words a coach might search for that aren't in the drill's name or type. */
  topics: string
}

/** A rule that only sets the pace, easiest first. */
const PACE = ['Walking pace', 'Walking pace', 'Jogging', 'Jogging', 'Jogging', 'Running', 'Running', 'Running, change direction'] as const

/** Library order: Get ready, Technical, Skill, Game related; each by its drill type, team drills before individual. */
export const LIBRARY: readonly LibraryDrill[] = [
  {
    id: 'lib-moving-warm-up', name: 'Moving warm-up', kind: 'warmup', type: 'Dry warm-up', focus: 'team', template: 'warm',
    rule: PACE,
    why: 'Moving through jogs, skips and leg swings gets the body ready before the ball comes out.',
    how: ['Line up along one side of the area.', 'Jog, high knees, heel flicks and skips across and back.', 'Finish with three short sprints.', 'Add hip in, hip out and shoulder-to-shoulder runs with a partner.'],
    watch: ['Good posture through every movement.', 'Short rests, so nobody cools down.'],
    topics: 'warm-up running dynamic warm-up FIFA 11+ shuttle runs 5-10-5',
  },
  {
    id: 'lib-tag-games', name: 'Tag games', kind: 'warmup', type: 'Dry warm-up', focus: 'team', template: 'warm',
    rule: PACE,
    why: 'A game gets players moving and laughing without them noticing the work.',
    how: ['Everyone inside the box. Pick two taggers.', 'A tagged player stands still until a teammate frees them.', 'Three rounds of 90 seconds.'],
    watch: ['Players look up and change direction.', 'Change the taggers every round.'],
    topics: 'warm-up tag fun stuck in the mud chain tag sharks and fish cat and mouse',
  },
  {
    id: 'lib-speed-circuit', name: 'Speed circuit', kind: 'warmup', type: 'Dry warm-up', focus: 'team', template: 'warm',
    rule: ['Walk through each station', 'Walk through each station', 'Half pace', 'Half pace', 'Three-quarter pace', 'Full pace', 'Full pace', 'Full pace, go on the coach’s call'],
    why: 'Short, sharp footwork wakes up the legs, so players are ready to move fast when the ball comes out.',
    how: ['Set out four stations: a ladder, low hurdles, poles to weave through and a 10 m sprint lane.', 'Groups spend two minutes at each station, then move on.', 'Finish with partner drives: one holds the other’s hips while they drive forward for 10 m.'],
    watch: ['Quick, light steps on the balls of the feet.', 'Quality before speed. Slow down if feet hit the kit.'],
    topics: 'warm-up speed agility quickness SAQ ladder hurdles poles resistance runs footwork',
  },
  {
    id: 'lib-easy-jog-and-stretch', name: 'Easy jog and stretch', kind: 'warmup', type: 'Cool-down', focus: 'team', template: 'warm',
    rule: ['Walk, short stretches', 'Walk, short stretches', 'Easy jog, 15-second stretches', 'Easy jog, 15-second stretches', 'Easy jog, 20-second stretches', 'Easy jog, 20-second stretches', 'Easy jog, 30-second stretches', 'Easy jog, 30-second stretches'],
    why: 'Slowing down gently helps the body recover, and is a calm moment to end the session.',
    how: ['Two easy laps of the area.', 'Stretch calves, hamstrings, thighs and hips. Hold each for 20 seconds.', 'Pair up for partner stretches if you like.'],
    watch: ['Slow, steady breathing.', 'Stretches feel gentle, never painful.'],
    topics: 'cool-down cool down warm down stretching static stretches partner stretches recovery',
  },
  {
    id: 'lib-walk-pass-and-talk', name: 'Walk, pass and talk', kind: 'warmup', type: 'Cool-down', focus: 'team', template: 'pairs',
    rule: 'Walking pace, two touches',
    why: 'An easy end with the ball, then a few words, helps players remember what they learnt.',
    how: ['Pairs walk and pass for three minutes.', 'Then everyone stands in a circle.', 'Each player says one thing that went well today.'],
    watch: ['Keep it calm and short.', 'Everyone gets a turn to speak.'],
    topics: 'cool-down cool down walking passes team talk reflection debrief',
  },
  {
    id: 'lib-pass-and-follow', name: 'Pass and follow', kind: 'technical', type: 'Passing', focus: 'team', template: 'groups',
    why: 'Moving straight after the pass is the habit that keeps a team’s ball moving.',
    how: ['Each group stands on the cones of a square.', 'Pass to the next cone, then follow your pass.', 'Keep the ball moving round the square.', 'For a change of angle, use a triangle or a diamond.'],
    watch: ['Players move as soon as the ball leaves their foot.', 'Passes go to the far foot of the next player.'],
    topics: 'pass and move triangle passing diamond passing passing square',
  },
  {
    id: 'lib-move-away-come-back', name: 'Move away, come back', kind: 'technical', type: 'Passing', focus: 'team', template: 'groups',
    why: 'A short run away from the ball makes room to come back and receive it.',
    how: ['Each group stands on the cones of a square.', 'Before each pass, the receiver takes two steps away.', 'Then they come back to the ball at an angle.'],
    watch: ['The run starts before the passer looks up.', 'Receivers arrive side-on, ready to turn.'],
    topics: 'movement check away getting free receiving',
  },
  {
    id: 'lib-y-shape-passing', name: 'Y-shape passing', kind: 'technical', type: 'Passing', focus: 'team', template: 'groups',
    why: 'A pass in, a pass back and a pass through is how teams get past a line of players.',
    how: ['Set cones in a Y inside each square.', 'Pass in, pass back, then play it through.', 'Follow your pass to the next cone.'],
    watch: ['The pass back is one touch where possible.', 'The third player times the run to meet the pass.'],
    topics: 'third man combination one-two wall pass lay off',
  },
  {
    id: 'lib-pass-through-the-gate', name: 'Pass through the gate', kind: 'technical', type: 'Passing', focus: 'individual', template: 'pairs',
    overlay: 'gate',
    why: 'A clean pass is the base of everything else, so it’s worth getting right without pressure first.',
    how: ['Partners face each other with a small gate between them.', 'Pass through the gate and back.', 'Keep count of how many in a row.'],
    watch: ['Standing foot points at the target.', 'Strike through the middle of the ball.'],
    topics: 'passing technique accuracy passing in pairs on the move',
  },
  {
    id: 'lib-first-touch-and-turn', name: 'First touch and turn', kind: 'technical', type: 'Passing', focus: 'individual', template: 'pairs',
    why: 'A good first touch that opens the body saves a whole second in a game.',
    how: ['Partners face each other. Put a cone a step behind each player.', 'Receive across your body with your back foot, so the first touch takes you round the cone.', 'Come back round it and pass to your partner, who does the same.'],
    watch: ['Look over the shoulder before the ball arrives.', 'Open the body: hips face where you want to go.'],
    topics: 'receiving first touch turning half turn back foot',
  },
  {
    id: 'lib-long-pass-and-control', name: 'Long pass and control', kind: 'technical', type: 'Passing', focus: 'individual', template: 'pairs',
    long: true, rule: ['Pass along the ground, stronger foot', 'Pass along the ground, stronger foot', 'Driven pass, stronger foot', 'Driven pass, either foot', 'Driven pass, either foot', 'Lofted pass, control in two touches', 'Lofted pass, control in one touch', 'Lofted pass, weaker foot only'],
    why: 'A long pass that arrives cleanly switches play in one go, and only works if the receiver can kill it.',
    how: ['Partners stand far apart, facing each other.', 'Strike a long pass to your partner.', 'Your partner controls it and plays it back the same way.'],
    watch: ['Lock the ankle and strike through the ball.', 'The receiver moves into line early and cushions the ball.'],
    topics: 'long passing driven pass lofted pass switch channels range of passing',
  },
  {
    id: 'lib-shift-with-the-ball', name: 'Shift with the ball', kind: 'technical', type: 'Pressing movement', focus: 'team', template: 'groups',
    rule: 'Movers don’t tackle', shadow: true,
    why: 'Players learn where to stand to block a pass before anyone tries to beat them.',
    how: ['Passers go round the outside of the square.', 'Movers shift towards the ball each time it moves.', 'Swap passers and movers after two minutes.'],
    watch: ['Movers shift while the ball travels, not after it lands.', 'They stay between the ball and the middle.'],
    topics: 'defending shape shifting',
  },
  {
    id: 'lib-step-up-together', name: 'Step up together', kind: 'technical', type: 'Pressing movement', focus: 'team', template: 'groups',
    rule: 'Movers step on the coach’s call', shadow: true,
    why: 'A group that moves on one call leaves less room between players.',
    how: ['Passers go round the outside of the square.', 'On a backward pass, the coach calls and movers step up as one.', 'On a forward pass, they drop back together.'],
    watch: ['Nobody steps early or stays behind.', 'Movers stay about five steps apart.'],
    topics: 'defensive line stepping up offside',
  },
  {
    id: 'lib-dribble-through-the-gates', name: 'Dribble through the gates', kind: 'technical', type: 'Follow and copy', focus: 'team', template: 'free',
    solo: true, overlay: 'gates', targets: 'Cone gates around the area',
    rule: ['Copy the coach’s move, walking pace', 'Copy the coach’s move, walking pace', 'Copy the coach’s move, jogging', 'Copy the coach’s move, jogging', 'A new move at every gate', 'A new move at every gate', 'Weaker foot only', 'As many gates as you can in 60 seconds'],
    why: 'Copying a move many times, with the head up between gates, turns it into one players use without thinking.',
    how: ['Put small cone gates all around the area. Everyone has a ball.', 'The coach shows a move. Players copy it as they dribble through any gate.', 'After a minute, the coach shows a new move.'],
    watch: ['Small touches, the ball close to the feet.', 'Heads up between gates to find the next free one.'],
    topics: 'dribbling skills moves ball mastery through the gates skills tunnel dare to dribble running with the ball',
  },
  {
    id: 'lib-look-and-call', name: 'Look and call', kind: 'technical', type: 'Repetition', focus: 'team', template: 'groups',
    rule: 'Movers call the next pass', shadow: true,
    why: 'Players who look around before the ball moves know what is coming.',
    how: ['Passers go round the outside of the square.', 'Before each pass, movers call the name of the next receiver.', 'A right call scores a point. Swap after two minutes.'],
    watch: ['Heads turn before the pass, not after it.', 'Movers watch the passer’s hips and eyes.'],
    topics: 'scanning awareness look over the shoulder',
  },
  {
    id: 'lib-dribble-and-swap', name: 'Dribble and swap', kind: 'technical', type: 'Repetition', focus: 'individual', template: 'pairs',
    rule: PACE,
    why: 'Keeping the ball close at speed gives players the confidence to run at people.',
    how: ['One partner dribbles across to the other.', 'Stop the ball with the sole and swap.', 'Use both feet.'],
    watch: ['Small touches, ball close to the feet.', 'Head up between touches.'],
    topics: 'dribbling ball control ball mastery',
  },
  {
    id: 'lib-shoot-from-the-line', name: 'Shoot from the line', kind: 'technical', type: 'Repetition', focus: 'individual', template: 'shoot',
    why: 'Repeating a clean strike builds the habit players need when a chance arrives.',
    how: ['Players queue at the shooting line.', 'One touch to set, then shoot.', 'Collect the ball and rejoin the queue.', 'Change the serve: a lay-off from a partner, or a feed to volley.'],
    watch: ['Look at the corner, then the ball.', 'Land on the shooting foot.'],
    topics: 'shooting finishing striking shooting finishing lay-off volleys edge of the box',
  },
  {
    id: 'lib-one-two-and-finish', name: 'One-two and finish', kind: 'technical', type: 'Repetition', focus: 'team', template: 'shoot',
    why: 'A quick one-two gets the shooter past a defender and into a clear shot.',
    how: ['A wall player stands at the edge of the box.', 'Pass into the wall player, run past and take the return.', 'Shoot first time, then swap with the wall player.'],
    watch: ['Pass firmly into the wall player’s front foot.', 'Run as soon as the pass goes.'],
    topics: 'shooting finishing one-two wall pass combine to finish',
  },
  {
    id: 'lib-turn-and-shoot', name: 'Turn and shoot', kind: 'technical', type: 'Repetition', focus: 'individual', template: 'shoot',
    angle: true,
    why: 'Strikers often get the ball with their back to goal, so the turn has to come before the shot.',
    how: ['Stand with your back to goal at the edge of the box.', 'A partner plays the ball in to your feet.', 'Turn and shoot within three touches.'],
    watch: ['Look over the shoulder before the ball arrives.', 'The first touch turns you, so the second can be the shot.'],
    topics: 'shooting finishing turning back to goal striker',
  },
  {
    id: 'lib-tackle-practice', name: 'Tackle practice', kind: 'technical', type: 'Repetition', focus: 'individual', template: 'pairs',
    rule: PACE,
    why: 'A tackle is mostly about timing and body shape, and both can be learnt slowly.',
    how: ['One partner dribbles towards the other.', 'The defender gets side-on and matches the pace.', 'Block the ball with the foot, without trying to win it yet.'],
    watch: ['Knees bent, side-on, on the toes.', 'Eyes stay on the ball, not the feet.'],
    topics: 'tackling defending 1v1 jockeying',
  },
  {
    id: 'lib-get-set-and-catch', name: 'Get set and catch', kind: 'technical', type: 'Repetition', focus: 'goalkeeping', template: 'shoot',
    why: 'Being set when the shot comes matters more than a big dive.',
    how: ['Keeper starts on the line and steps into position.', 'A server plays the ball at the keeper.', 'Keeper catches and returns it, then resets.'],
    watch: ['Feet still at the moment of the shot.', 'Hands form a W behind the ball.'],
    topics: 'goalkeeper gk keeper handling catching',
  },
  {
    id: 'lib-cover-the-angle', name: 'Cover the angle', kind: 'technical', type: 'Repetition', focus: 'goalkeeping', template: 'shoot',
    angle: true,
    why: 'Moving a step forward and across makes the goal look smaller to the shooter.',
    how: ['Servers stand at different angles.', 'Coach calls a name and that player shoots.', 'Keeper moves to cover the angle, then sets.'],
    watch: ['Keeper takes small steps across, not big ones.', 'Keeper is set before the shot, not during it.'],
    topics: 'goalkeeper gk keeper positioning angles',
  },
  {
    id: 'lib-save-and-get-up', name: 'Save and get up', kind: 'technical', type: 'Repetition', focus: 'goalkeeping', template: 'shoot',
    angle: true,
    why: 'A keeper who gets up fast is ready for the rebound or the next shot.',
    how: ['Servers stand in an arc in front of goal.', 'One shoots. The keeper saves, gets up and sets.', 'The next server shoots as soon as the keeper is set.'],
    watch: ['Hands go to the ball first, then the body behind it.', 'Up on the feet before looking for the next ball.'],
    topics: 'goalkeeping shot stopping diving rebounds recovery',
  },
  {
    id: 'lib-throw-and-roll-out', name: 'Throw and roll out', kind: 'technical', type: 'Repetition', focus: 'goalkeeping', template: 'pairs',
    long: true, rule: ['Roll to feet', 'Roll to feet', 'Bowl to feet', 'Throw to feet', 'Throw into space ahead', 'Side volley to a runner', 'Drop kick to a runner', 'Pass to whoever the coach calls'],
    why: 'Most attacks start with the keeper, so a quick, accurate release is worth practising.',
    how: ['The keeper holds the ball. A partner stands far away.', 'Release the ball to the partner the way the coach says.', 'The partner plays it back and moves to a new spot.'],
    watch: ['Step towards the target as the ball is released.', 'The ball arrives where the partner can use it.'],
    topics: 'goalkeeping distribution throwing kicking rolling out starting attacks',
  },
  {
    id: 'lib-sweep-behind-the-line', name: 'Sweep behind the line', kind: 'technical', type: 'Repetition', focus: 'goalkeeping', template: 'shoot',
    rule: ['Ball rolled through, no attacker', 'Ball rolled through, no attacker', 'Ball passed through, no attacker', 'Ball passed through, attacker 15 m away', 'Ball passed through, attacker 10 m away', 'Ball chipped through, attacker 10 m away', 'Ball chipped through, attacker 5 m away', 'Through ball from either side, attacker 5 m away'],
    why: 'A keeper who reads a ball played in behind can clear it before the striker gets there.',
    how: ['A server plays the ball into the space behind an imaginary back line.', 'The keeper reads it, comes off the line and clears or gathers it.', 'Back into the goal, ready for the next one.'],
    watch: ['Start a few steps off the line, not on it.', 'Decide early: come for it, or stay.'],
    topics: 'goalkeeping sweeper keeper space in behind through ball coming off the line',
  },
  {
    id: 'lib-keep-the-ball', name: 'Keep the ball', kind: 'skill', type: 'Rondos', focus: 'team', template: 'square',
    why: 'More players than defenders means the player on the ball should always have two people to pass to.',
    how: ['Attackers spread around the square, defenders start in the middle.', 'Attackers keep the ball for as long as they can.', 'If a defender wins it, they swap with the player who lost it.'],
    watch: ['Players move before the pass, not after it.', 'Body open, so they can see the next pass.'],
    topics: 'possession keep ball 3v1 4v1 4v2 5v2',
  },
  {
    id: 'lib-four-corners', name: 'Four corners', kind: 'skill', type: 'Rondos', focus: 'team', template: 'square',
    rule: 'One player in every quarter', overlay: 'quarters',
    why: 'When a team spreads out, every defender has more ground to cover and gaps appear.',
    how: ['Split the square into four quarters with cones.', 'Attackers keep the ball, with at least one player in every quarter.', 'Lose a quarter or lose the ball, and a defender swaps in.'],
    watch: ['Players check where teammates are before they move.', 'Nobody runs towards the ball just because it’s close.'],
    topics: 'width spread out space',
  },
  {
    id: 'lib-pass-between-defenders', name: 'Pass between defenders', kind: 'skill', type: 'Rondos', focus: 'team', template: 'square',
    rule: 'A pass between two defenders scores', targets: 'The gap between two defenders', overlay: 'split',
    why: 'A gap is only useful if someone spots it and plays through it.',
    how: ['Attackers keep the ball around the square.', 'A pass that goes between two defenders scores a point.', 'First to five points, then swap defenders.'],
    watch: ['Players look up before the ball arrives.', 'The receiver moves into the gap on the far side.'],
    topics: 'splitting pass through ball line breaking pass penetration target player breaking lines split pass',
  },
  {
    id: 'lib-block-the-gates', name: 'Block the gates', kind: 'skill', type: 'Rondos', focus: 'team', template: 'square',
    rule: 'A pass through a gate scores', targets: 'Small gates', overlay: 'gates',
    why: 'Good defenders stand where the pass wants to go, so it never gets played.',
    how: ['Put small gates of two cones in the middle of the square.', 'Attackers score by passing through a gate.', 'Defenders stay on their feet and block the gates by where they stand.'],
    watch: ['Defenders watch the ball and the gate at the same time.', 'They shuffle early and don’t dive in.'],
    topics: 'blocking defending cover shadow',
  },
  {
    id: 'lib-press-as-a-group', name: 'Press as a group', kind: 'skill', type: 'Rondos', focus: 'team', template: 'square',
    rule: 'Ball out of the square is a defenders’ point',
    why: 'Defenders who move as one group make the pitch feel small.',
    how: ['Attackers keep the ball in the square.', 'One defender goes to the ball, the others close the nearest passes.', 'A ball forced out of the square gives defenders a point.'],
    watch: ['Defenders move together when the ball moves.', 'They talk, so everyone knows who is going.'],
    topics: 'pressing press counter press',
  },
  {
    id: 'lib-intercept-the-pass', name: 'Intercept the pass', kind: 'skill', type: 'Rondos', focus: 'team', template: 'square',
    rule: 'Defenders score by intercepting',
    why: 'Players who read the passer’s body can arrive before the ball does.',
    how: ['Attackers keep the ball in the square.', 'Defenders only score by intercepting a pass, not by tackling.', 'Swap defenders after each interception.'],
    watch: ['Defenders watch the passer’s hips and eyes.', 'They hold their position, then go at the last moment.'],
    topics: 'interception anticipation reading the game',
  },
  {
    id: 'lib-overlap-and-finish', name: 'Overlap and finish', kind: 'skill', type: 'Attack in turns', focus: 'team', template: 'func',
    rule: 'One overlap before the shot',
    why: 'A run around the outside gives one defender two problems.',
    how: ['Groups attack the goal in turns.', 'A wide player must run round the player on the ball.', 'Cross or cut it back. The others attack the near post, the far post and the edge of the box.'],
    watch: ['The overlap starts as the ball arrives wide.', 'Runners arrive late and fast, not standing waiting.'],
    topics: 'overlap crossing wide play finishing overlap and cross crossing near post far post fox in the box cross and attack the box',
  },
  {
    id: 'lib-through-ball-and-finish', name: 'Through ball and finish', kind: 'skill', type: 'Attack in turns', focus: 'team', template: 'func',
    rule: 'Score from a pass behind the defenders',
    why: 'The space behind defenders is the most dangerous space on the pitch.',
    how: ['Attackers go at goal in a group.', 'Goals only count from a pass played behind the defenders.', 'The next group starts when the shot is taken.'],
    watch: ['The runner stays onside by bending the run.', 'The pass goes in front of the runner.'],
    topics: 'through ball runs in behind finishing 2v1 to goal getting in behind',
  },
  {
    id: 'lib-defend-each-attack', name: 'Defend each attack', kind: 'skill', type: 'Attack in turns', focus: 'team', template: 'func',
    rule: 'Defenders score by clearing past halfway',
    why: 'Defending one attack after another teaches players to get back into shape fast.',
    how: ['Attackers go at goal in a group.', 'Defenders protect the middle and force shots from wide.', 'A clearance past halfway scores for the defenders.'],
    watch: ['The nearest defender goes, the others cover.', 'Defenders get back into shape before the next attack.'],
    topics: 'defending recovery',
  },
  {
    id: 'lib-intercept-and-counter', name: 'Intercept and counter', kind: 'skill', type: 'Attack in turns', focus: 'team', template: 'func',
    rule: 'Defenders who intercept counter to a small goal',
    why: 'A read pass turns defending into a fast attack.',
    how: ['Attackers go at goal in a group.', 'Defenders look for the pass they can step in front of.', 'After an interception, they counter to a small goal.'],
    watch: ['Defenders hold their position, then go late.', 'First look after the interception is forward.'],
    topics: 'interception counter attack transition finishing waves counter-attack',
  },
  {
    id: 'lib-1v1-to-goal', name: '1 v 1 to goal', kind: 'skill', type: 'Attack in turns', focus: 'team', template: 'func',
    group: [1, 1], rule: 'Score within eight seconds',
    why: 'Beating a player one against one is the skill that breaks a game open.',
    how: ['Attackers and defenders queue at each side of the area.', 'The coach plays a ball in. The attacker goes at the defender and tries to score.', 'The defender wins it and dribbles over the halfway line. Next pair goes.'],
    watch: ['Attack the defender’s front foot at speed.', 'A change of pace after the move, not before.'],
    topics: 'dribbling 1v1 one against one beating a player take on escaping a defender recovery runs',
  },
  {
    id: 'lib-win-it-pass-it-out', name: 'Win it, pass it out', kind: 'skill', type: 'Win it and get out', focus: 'team', template: 'square',
    grids: 2, rule: 'Win it, pass it into the other grid. Lose it, five seconds to win it back',
    why: 'Transitions decide games: the team that wins the ball must get it out of the crowd, and the team that lost it must win it straight back.',
    how: ['Two grids side by side, a rondo in each.', 'Defenders who win the ball try to pass it into the other grid to score.', 'The attackers who lost it have five seconds to win it back before the pass goes.'],
    watch: ['After winning it, the first look is away from the pressure.', 'After losing it, the nearest player goes straight to the ball and the others close the passes.'],
    topics: 'transition double rondo 6v3 two boxes counter-pressing win it back in five gegenpressing',
  },
  {
    id: 'lib-keep-it-with-spare-players', name: 'Keep it with spare players', kind: 'skill', type: 'Possession', focus: 'team', template: 'game',
    rule: 'Ten passes in a row is a point', noGoals: true,
    why: 'Bigger numbers and more room make it feel like a match without the pressure of goals.',
    how: ['Two teams in one area, with no goals.', 'The team with the ball uses any spare players.', 'Ten passes in a row scores a point.'],
    watch: ['Players spread out as soon as their team wins the ball.', 'Passes go away from the pressure.'],
    topics: 'possession keep ball 10 passes',
  },
  {
    id: 'lib-switch-the-play', name: 'Switch the play', kind: 'skill', type: 'Possession', focus: 'team', template: 'game',
    rule: 'Moving the ball from one wide lane to the other is a point', targets: 'The far wide lane', overlay: 'wide', noGoals: true,
    why: 'Moving the ball quickly from side to side stretches the other team until a gap opens.',
    how: ['Mark a lane down each side of the area.', 'Two teams keep the ball, with no goals.', 'Get the ball from one lane to the other for a point.'],
    watch: ['Wide players stay wide and ready.', 'Middle players look for the far side first.'],
    topics: 'switch play switching width',
  },
  {
    id: 'lib-three-team-keep-ball', name: 'Three-team keep ball', kind: 'skill', type: 'Whole squad', focus: 'team', template: 'square',
    rule: 'The team that loses it swaps with the defenders', third: true,
    why: 'The whole squad works at once, and two teams have to find each other in a crowd.',
    how: ['Split the squad into three teams.', 'Two teams keep the ball together. The third team hunts it.', 'The team that loses the ball becomes the hunters.'],
    watch: ['Players spread out as soon as they get the ball back.', 'Hunters press together, not one at a time.'],
    topics: 'possession pressing',
  },
  {
    id: 'lib-protect-your-ball', name: 'Protect your ball', kind: 'skill', type: 'Whole squad', focus: 'individual', template: 'square',
    ballEach: true,
    rule: ['Defenders knock balls out', 'Defenders knock balls out', 'Defenders knock balls out', 'Defenders knock balls out', 'Defenders win a ball and keep it', 'Defenders win a ball and keep it', 'Defenders win a ball and keep it', 'Defenders win a ball and keep it'],
    why: 'Dribbling only counts when someone is trying to take the ball, and tackling only counts against someone who wants to keep it.',
    how: ['Attackers each have a ball inside the area. A few defenders start without one.', 'Defenders try to knock balls out. At the harder levels they must win a ball and keep it.', 'Lose your ball and you swap with the defender.'],
    watch: ['Attackers shield the ball with their body and change speed to escape.', 'Defenders slow down as they get close, then tackle when the ball leaves the attacker’s foot.'],
    topics: 'dribbling shielding tackling 1v1 steal the ball bib tag stay on the ball',
  },
  {
    id: 'lib-pass-then-score', name: 'Pass then score', kind: 'game', type: 'Small-sided games', focus: 'team', template: 'game',
    rule: ['3 passes before a shot', '3 passes before a shot', '4 passes before a shot', '4 passes before a shot', '5 passes before a shot', '5 passes before a shot', '6 passes before a shot', '6 passes before a shot'],
    why: 'Teams that stay patient get better chances, because the other team gets tired of chasing.',
    how: ['Two teams, two goals.', 'A team must complete the passes before it can shoot.', 'Any spare players join whichever team has the ball.'],
    watch: ['Nobody rushes a shot to get it over with.', 'Players offer an easy pass when a teammate is under pressure.'],
    topics: 'patience possession build up two touch',
  },
  {
    id: 'lib-go-wide-first', name: 'Go wide first', kind: 'game', type: 'Small-sided games', focus: 'team', template: 'game',
    rule: 'One pass into a wide lane before a shot', overlay: 'wide',
    why: 'Using the width of the pitch pulls defenders apart and opens the middle.',
    how: ['Mark a lane down each side of the pitch.', 'A team must play one pass into a wide lane before it can shoot.', 'Any spare players join whichever team has the ball.'],
    watch: ['Wide players stay wide until the ball arrives.', 'The team looks for the gap the defenders left.'],
    topics: 'width wingers crossing wide play goals from crosses count double',
  },
  {
    id: 'lib-end-zone-game', name: 'End-zone game', kind: 'game', type: 'Small-sided games', focus: 'team', template: 'game',
    rule: 'Score by receiving in the end zone', targets: 'End zones', overlay: 'endzones',
    why: 'Scoring by receiving in a zone rewards the run into space behind the defence.',
    how: ['Mark an end zone at each end of the pitch.', 'A team scores when a player receives a pass inside the zone.', 'Runners can’t wait in the zone. They time the run.'],
    watch: ['Runs start when the passer looks up.', 'The pass goes into space, in front of the runner.'],
    topics: 'runs in behind through ball end zone',
  },
  {
    id: 'lib-protect-the-middle', name: 'Protect the middle', kind: 'game', type: 'Small-sided games', focus: 'team', template: 'game',
    rule: 'Win it in the middle for a bonus point', overlay: 'middle',
    why: 'If the middle is closed, the other team has to go the long way around.',
    how: ['Mark a zone in the centre of the pitch.', 'Normal game with two goals.', 'Win the ball inside the zone and your team gets a bonus point.'],
    watch: ['Players turn the attacker away from the middle.', 'The nearest player goes, the others tuck in.'],
    topics: 'defending compact central',
  },
  {
    id: 'lib-push-them-wide', name: 'Push them wide', kind: 'game', type: 'Small-sided games', focus: 'team', template: 'game',
    rule: 'Win it in a wide lane for two points', overlay: 'wide',
    why: 'The sideline works like an extra defender, so pushing play wide makes it easier to win the ball.',
    how: ['Mark a lane down each side of the pitch.', 'Normal game with two goals.', 'Win the ball in a wide lane and your team gets two points.'],
    watch: ['The first defender shows the attacker the outside.', 'Teammates step across to trap the ball there.'],
    topics: 'pressing show outside defending wide',
  },
  {
    id: 'lib-win-it-and-go', name: 'Win it and go', kind: 'game', type: 'Small-sided games', focus: 'team', template: 'game',
    rule: 'Goal after an interception counts double',
    why: 'Reading a pass does two jobs: it stops their attack and starts yours.',
    how: ['Normal game with two goals.', 'A goal scored within six seconds of an interception counts double.', 'Coach counts out loud so everyone hears it.'],
    watch: ['Players look around before the pass is played.', 'After the interception, the first look is forward.'],
    topics: 'interception transition counter attack',
  },
  {
    id: 'lib-shoot-early', name: 'Shoot early', kind: 'game', type: 'Small-sided games', focus: 'team', template: 'game',
    rule: 'Shot on target 1 point, goal 3',
    why: 'Rewarding every shot on target teaches players to take the chance.',
    how: ['Normal game with two goals.', 'A shot on target scores one point.', 'A goal scores three.'],
    watch: ['Players shoot early, without an extra touch.', 'Teammates follow the shot in.'],
    topics: 'shooting finishing',
  },
  {
    id: 'lib-just-play', name: 'Just play', kind: 'game', type: 'Small-sided games', focus: 'team', template: 'game',
    why: 'Players learn the game by playing it, so let them play and watch what they do.',
    how: ['Split into small teams on small pitches with goals.', 'Play with as few rules as you can.', 'For a festival, run short games and swap opponents each round.'],
    watch: ['Who looks for the ball and who hides.', 'Save the coaching for the break, not during play.'],
    topics: 'free play small sided games mini goals tournament festival scrimmage',
  },
  {
    id: 'lib-attack-down-the-side', name: 'Attack down the side', kind: 'game', type: 'Position practice', focus: 'team', template: 'funcm',
    rule: 'A goal from a cross counts double', overlay: 'wide',
    why: 'Two players on one side learn when to overlap and when to stay, in the positions they play.',
    how: ['Two even teams, one goal and a keeper.', 'Attackers try to get a wide player in behind.', 'Defenders win it and play out past halfway.'],
    watch: ['The wide player times the run off the ball carrier.', 'Other attackers get into the box early.'],
    topics: 'wing play crossing overlaps full back',
  },
  {
    id: 'lib-hold-the-line', name: 'Hold the line', kind: 'game', type: 'Position practice', focus: 'team', template: 'funcm',
    rule: 'Defenders score by clearing past halfway',
    why: 'A back line that moves as one group leaves no gaps to run into.',
    how: ['Two even teams, one goal and a keeper.', 'The defending line steps up and drops together.', 'A clearance past halfway scores for the defenders.'],
    watch: ['The nearest defender goes, the others cover.', 'The line talks, so nobody is left behind.'],
    topics: 'defending back line back four offside line',
  },
  {
    id: 'lib-build-through-midfield', name: 'Build through midfield', kind: 'game', type: 'Position practice', focus: 'team', template: 'funcm',
    overlay: 'middle', rule: 'A goal after a pass through the middle zone counts double',
    why: 'Midfielders who can receive and turn in the middle take the ball past the other team’s lines.',
    how: ['Two even teams in their positions, one goal and a keeper.', 'Attackers build from the back through a zone in the middle.', 'Defenders win it and play out past halfway.'],
    watch: ['Midfielders open their body to see forward before the ball arrives.', 'Players move off the ball to make space in the middle.'],
    topics: 'midfield build-up playing through the lines central areas building the attack',
  },
  {
    id: 'lib-play-out-from-the-keeper', name: 'Play out from the keeper', kind: 'game', type: 'Attack v defence', focus: 'team', template: 'game',
    rule: 'Stop the ball on the target line to score', targets: 'Full-width line at the far end', overlay: 'target', keeper: true,
    why: 'A wide target rewards playing through the thirds, not just down the middle.',
    how: ['The keeper starts every attack from the goal.', 'Their team plays out and scores by stopping the ball on the target line.', 'If the other team wins it, they go straight at the goal.'],
    watch: ['Players spread wide before the keeper plays.', 'The first pass goes to the player with most time.'],
    topics: 'playing out from the back build up goalkeeper distribution playing out from the back 6v4',
  },
  {
    id: 'lib-press-from-the-front', name: 'Press from the front', kind: 'game', type: 'Attack v defence', focus: 'team', template: 'game',
    rule: 'Win it in their half for two points', targets: 'Full-width line, or the goal after a win', overlay: 'target', keeper: true,
    why: 'Winning the ball high up means the goal is already close.',
    how: ['One team plays out from its own goal.', 'The other team presses as a group.', 'Win it in their half and go straight at goal.'],
    watch: ['The first player runs in a curve to block one pass.', 'Teammates close the next pass together.'],
    topics: 'high press pressing press from the front',
  },
]

/** TRAK-388 (Kostas, 9 Nov) and the 10 Nov read-through (merged into another drill): drills taken out of the Library. A saved plan can still name them, so they stay findable
 *  by id; they're never listed, searched or offered. */
const RETIRED: readonly LibraryDrill[] = [
  {
    id: 'lib-steal-the-ball', name: 'Steal the ball', kind: 'skill', type: 'Whole squad', focus: 'individual', template: 'square',
    rule: 'Win the ball and keep it', ballEach: true,
    why: 'Real tackles happen against someone who doesn’t want to lose the ball.',
    how: ['Attackers each have a ball inside the area.', 'Defenders try to win a ball and keep it.', 'Whoever loses a ball becomes a defender.'],
    watch: ['Defenders slow down as they get close.', 'They tackle when the ball leaves the attacker’s foot.'],
    topics: 'tackling 1v1 defending winning the ball',
  },
  {
    id: 'lib-win-it-back-in-five', name: 'Win it back in five', kind: 'skill', type: 'Win it and get out', focus: 'team', template: 'square',
    rule: 'Lose it? Win it back within five seconds', targets: 'Keep the ball. Defenders score by passing out of the square',
    why: 'The best moment to win the ball back is straight after losing it, before the other team is organised.',
    how: ['Attackers keep the ball in the square against the defenders.', 'When defenders win it, they try to pass it out of the square to score.', 'The attackers who lost it have five seconds to win it back.'],
    watch: ['The nearest player goes straight to the ball.', 'Teammates close the passes around it.'],
    topics: 'counter-pressing gegenpressing transition win it back pressing after losing the ball',
  },
  {
    id: 'lib-cross-and-attack-the-box', name: 'Cross and attack the box', kind: 'skill', type: 'Attack in turns', focus: 'team', template: 'func',
    overlay: 'wide', rule: 'Goals from a cross or a cut-back only',
    why: 'Crosses only work when runners arrive in the right spaces at the right time.',
    how: ['A wide player dribbles down the side and crosses.', 'Attackers run to the near post, the far post and the edge of the box.', 'Defenders try to clear it. Next group goes.'],
    watch: ['Runners arrive late and fast, not standing waiting.', 'The cross goes behind the defenders, in front of the keeper.'],
    topics: 'crossing finishing near post far post fox in the box wing play',
  },
  {
    id: 'lib-copy-your-partner', name: 'Copy your partner', kind: 'warmup', type: 'Dry warm-up', focus: 'team', template: 'warm',
    rule: PACE,
    why: 'Copying a partner wakes up quick feet and the eyes at the same time.',
    how: ['Stand opposite a partner.', 'One leads with side steps, turns and stops. The other copies.', 'Swap every 30 seconds.'],
    watch: ['Knees bent, on the toes.', 'Eyes on the partner’s hips.'],
    topics: 'warm-up agility footwork',
  },

  {
    id: 'lib-follow-and-copy', name: 'Follow and copy', kind: 'technical', type: 'Follow and copy', focus: 'team', template: 'free',
    rule: PACE,
    why: 'Following a partner forces players to look up and react while the ball stays close.',
    how: ['Pair up inside the area, a ball each.', 'The leader dribbles anywhere. The follower copies every move.', 'Swap roles every 30 seconds.'],
    watch: ['Head up between touches.', 'Small touches when the leader changes direction.'],
    topics: 'dribbling ball control awareness',
  },
]

const byId = new Map([...LIBRARY, ...RETIRED].map(d => [d.id, d]))

/** A Library drill by its id, retired ones included, or undefined (an old shelf id). */
export const libraryDrill = (id: string | null | undefined) => (id ? byId.get(id) : undefined)

/** Another drill (TRAK-389): the next one of the same drill type, round to the first; when the type has only this one,
 *  the next of the same kind. Null when it's alone in its kind. */
export function anotherDrill(d: Pick<LibraryDrill, 'id' | 'kind' | 'type'>): LibraryDrill | null {
  let pool = LIBRARY.filter(x => x.kind === d.kind && x.type === d.type)
  if (pool.length < 2) pool = LIBRARY.filter(x => x.kind === d.kind)
  if (pool.length < 2) return null
  return pool[(pool.findIndex(x => x.id === d.id) + 1) % pool.length]
}
