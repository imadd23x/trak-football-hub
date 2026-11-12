/* TRAK-407: a saved trait or role ('Winger') stays as saved; these give the word shown for it, t(ROLE_WORD[role]).
   A coach's own role has no entry and is shown as written. Its words are in each language's coachSquad.json. */

import { i18n } from '@/lib/i18n'

type WordMap = Readonly<Record<string, string>>

/** The word for a saved value in the language showing, or the value itself when it has none (a coach's own role).
 *  Call it from a component that uses useTranslation(), so it is read again when the language changes. */
export const shown = (map: WordMap, value: string) => (map[value] ? i18n.t(map[value] as 'coachSquad:roles') : value)

export const TRAIT_WORD: WordMap = {
  "Gets forward whenever possible": 'coachSquad:traitGetsForwardWheneverPossible',
  "Stays back at all times": 'coachSquad:traitStaysBackAtAllTimes',
  "Comes deep to get the ball": 'coachSquad:traitComesDeepToGetTheBall',
  "Dribbles down left": 'coachSquad:traitDribblesDownLeft',
  "Dribbles down right": 'coachSquad:traitDribblesDownRight',
  "Dribbles down center": 'coachSquad:traitDribblesDownCenter',
  "Runs with ball often": 'coachSquad:traitRunsWithBallOften',
  "Runs with ball occasionally": 'coachSquad:traitRunsWithBallOccasionally',
  "Hugs touchline": 'coachSquad:traitHugsTouchline',
  "Cuts inside": 'coachSquad:traitCutsInside',
  "Gets into opposition area": 'coachSquad:traitGetsIntoOppositionArea',
  "Arrives late in opposition area": 'coachSquad:traitArrivesLateInOppositionArea',
  "Beats the offside trap": 'coachSquad:traitBeatsTheOffsideTrap',
  "Plays with back to goal": 'coachSquad:traitPlaysWithBackToGoal',
  "Stays inside penalty area": 'coachSquad:traitStaysInsidePenaltyArea',
  "Moves into channels": 'coachSquad:traitMovesIntoChannels',
  "Plays one-twos": 'coachSquad:traitPlaysOneTwos',
  "Tries to knock ball past opponent": 'coachSquad:traitTriesToKnockBallPastOpponent',
  "Tries killer balls often": 'coachSquad:traitTriesKillerBallsOften',
  "Does not try killer balls": 'coachSquad:traitDoesNotTryKillerBalls',
  "Tries long range passes": 'coachSquad:traitTriesLongRangePasses',
  "Plays short simple passes": 'coachSquad:traitPlaysShortSimplePasses',
  "Slows down pace": 'coachSquad:traitSlowsDownPace',
  "Dwells on ball": 'coachSquad:traitDwellsOnBall',
  "Looks for pass rather than finishing": 'coachSquad:traitLooksForPassRatherThanFinishing',
  "Dictates tempo": 'coachSquad:traitDictatesTempo',
  "Switches ball to wide areas": 'coachSquad:traitSwitchesBallToWideAreas',
  "Ball to feet": 'coachSquad:traitBallToFeet',
  "Shoots from distance": 'coachSquad:traitShootsFromDistance',
  "Refrains from long shots": 'coachSquad:traitRefrainsFromLongShots',
  "Lobs the keeper": 'coachSquad:traitLobsTheKeeper',
  "Rounds the keeper": 'coachSquad:traitRoundsTheKeeper',
  "Shoots with power": 'coachSquad:traitShootsWithPower',
  "Places shots": 'coachSquad:traitPlacesShots',
  "First time shots": 'coachSquad:traitFirstTimeShots',
  "Tries overhead kicks": 'coachSquad:traitTriesOverheadKicks',
  "Tries power free kicks": 'coachSquad:traitTriesPowerFreeKicks',
  "Tries long range free kicks": 'coachSquad:traitTriesLongRangeFreeKicks',
  "Dives into tackles": 'coachSquad:traitDivesIntoTackles',
  "Does not dive into tackles": 'coachSquad:traitDoesNotDiveIntoTackles',
  "Marks opponent tightly": 'coachSquad:traitMarksOpponentTightly',
  "Brings ball out of defense": 'coachSquad:traitBringsBallOutOfDefense',
  "Plays out of trouble": 'coachSquad:traitPlaysOutOfTrouble',
  "Tries tricks": 'coachSquad:traitTriesTricks',
  "Curls balls": 'coachSquad:traitCurlsBalls',
  "Uses outside of foot": 'coachSquad:traitUsesOutsideOfFoot',
  "Likes to beat opponent repeatedly": 'coachSquad:traitLikesToBeatOpponentRepeatedly',
  "Adjusts foot before attempting strike": 'coachSquad:traitAdjustsFootBeforeAttemptingStrike',
  "Avoids weaker foot": 'coachSquad:traitAvoidsWeakerFoot',
  "Uses weaker foot": 'coachSquad:traitUsesWeakerFoot',
  "Long flat throw": 'coachSquad:traitLongFlatThrow',
  "Uses long throw to start counter-attacks": 'coachSquad:traitUsesLongThrowToStartCounterAttacks',
}

export const TRAIT_GROUP_WORD: WordMap = {
  "Movement": 'coachSquad:traitGroupMovement',
  "Passing": 'coachSquad:traitGroupPassing',
  "Finishing and shooting": 'coachSquad:traitGroupFinishingAndShooting',
  "Defending and tackling": 'coachSquad:traitGroupDefendingAndTackling',
  "Technique and general": 'coachSquad:traitGroupTechniqueAndGeneral',
}

export const ROLE_WORD: WordMap = {
  "Sweeper-keeper": 'coachSquad:roleSweeperKeeper',
  "Shot-stopper": 'coachSquad:roleShotStopper',
  "Distributor": 'coachSquad:roleDistributor',
  "Ball-playing centre back": 'coachSquad:roleBallPlayingCentreBack',
  "Stopper": 'coachSquad:roleStopper',
  "Covering centre back": 'coachSquad:roleCoveringCentreBack',
  "Attacking full-back": 'coachSquad:roleAttackingFullBack',
  "Defensive full-back": 'coachSquad:roleDefensiveFullBack',
  "Inverted full-back": 'coachSquad:roleInvertedFullBack',
  "Controller": 'coachSquad:roleController',
  "Box-to-box": 'coachSquad:roleBoxToBox',
  "Ball-winner": 'coachSquad:roleBallWinner',
  "Wide midfielder": 'coachSquad:roleWideMidfielder',
  "Winger": 'coachSquad:roleWinger',
  "Inside forward": 'coachSquad:roleInsideForward',
  "Runner": 'coachSquad:roleRunner',
  "Target striker": 'coachSquad:roleTargetStriker',
  "False nine": 'coachSquad:roleFalseNine',
}

export const ROLE_HEADING_WORD: WordMap = {
  "As a goalkeeper": 'coachSquad:roleHeadingAsAGoalkeeper',
  "As a defender": 'coachSquad:roleHeadingAsADefender',
  "As a midfielder": 'coachSquad:roleHeadingAsAMidfielder',
  "As an attacker": 'coachSquad:roleHeadingAsAnAttacker',
  "Yours": 'coachSquad:roleHeadingYours',
}
