/* TRAK-268: Play It Right's coach notes, from the old page's own notes. Its features that
   need its old connection (squad totals, settings, levels and recall) aren't here; the
   research is the old page's, with each source named in plain text, since nothing in the
   Library sends the coach to another website (Kostas, 22 Oct). */

export const HOW_IT_WORKS: [when: string, what: string][] = [
  ['Each week', 'Ten match moments, all on one part of the code. Week 1 is Commitment, week 2 Behaviour and attitude, and so on, so every six weeks cover the whole code and each part comes round three times in 18 weeks.'],
  ['Mon–Fri', 'Players aim for two moments a day, about five minutes.'],
  ['Any time', 'Players read a short strip, make their call, then see what the coach saw. Some moments ask them to rank three options instead.'],
  ['Huddle', 'Select a moment from this week’s part, ideally one the squad found hard, and talk it through together.'],
  ['All week', 'Catch teachable moments in training and name the part (“That was part 4”).'],
]

export const NO_SCORES = 'There are no points and no rankings between players. Safeguarding sits outside it all: players have “Need to talk to someone?” on every screen of their Play It Right.'

export const RESEARCH: { finding: string; detail: string; source: string }[] = [
  {
    finding: 'Values improve when they are taught on purpose, not just “caught”.',
    detail: 'A six-week sportsmanship programme with 126 footballers aged 10–12 improved courtesy towards opponents, care for injured players, and respect for referees, even when the referee got it wrong.',
    source: 'Redalyc study',
  },
  {
    finding: 'Responsibility-based coaching works with 14–16-year-old footballers.',
    detail: 'A nine-month programme built on Hellison’s Teaching Personal and Social Responsibility model raised responsibility, prosocial behaviour and self-efficacy compared with conventional coaching.',
    source: 'Frontiers in Psychology, 2021',
  },
  {
    finding: 'Sport-specific dilemmas matter.',
    detail: 'Bredemeier and Shields found that athletes often reason at a lower moral level about sport dilemmas than everyday ones (“game reasoning”). Every exercise here is set in football for that reason.',
    source: 'Bredemeier and Shields, divergence in moral reasoning about sport and everyday life',
  },
  {
    finding: 'Autonomy-supportive coaching builds life skills, including leadership.',
    detail: 'Explaining the why, offering choices and inviting player input is linked to life-skill development.',
    source: 'Self-determination theory and life skills in youth sport',
  },
  {
    finding: 'Separate codes for young and adult players.',
    detail: 'The FA’s Respect programme has a short, concrete code for young players and a separate adult code.',
    source: 'The FA Respect programme',
  },
]

export const BY_AGE: [what: string, young: string, older: string][] = [
  ['Format', 'A strip of a match moment, the player’s call, then what the coach saw.', 'Dilemma, the leader’s move and the outcome, then three quick calls.'],
  ['Moments', 'Academy life: reviews and releases, hidden injuries, playing up, scouts and agents, touchline parents, school.', 'Grey areas: simulation, gamesmanship, betting, discrimination, social media.'],
]
