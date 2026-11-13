const MESSAGES = [
  "The players who make it are not always the most talented. They are the most consistent. Show up today.",
  "After a bad match the temptation is to forget it. Do not. Sit with it for ten minutes. Then move on.",
  "Your coach notices more than you think. The way you react to being substituted. The way you treat a teammate after a mistake.",
  "Progress in football is not linear. Two steps forward, one step back is still forward. Trust the process.",
  "Coachability is the most underrated quality in a young player. The ones who listen and apply are the ones who develop fastest.",
  "A bad game does not define you. How you prepare for the next one does.",
  "Scouts do not just watch what you do with the ball. They watch what you do without it.",
  "Your passport is being written every time you step on a pitch. Make sure what gets written is something you are proud of.",
  "Hard matches are gifts. They reveal what you need to work on in a way training never can.",
  "You are building something here. Not just a career. A version of yourself that is worth becoming.",
  "Talent gets you noticed. Attitude gets you signed. Remember which one you control.",
  "The best players in the world train the basics every single day. The pass. The first touch. The body shape. Never outgrow them.",
  "Your warm-up tells a coach more than your first ten minutes do. Take it seriously.",
  "You will play badly sometimes. Every great player has. What separates them is they do not hide afterwards.",
  "The hardest yard in football is the one back into your own half when you have lost the ball. Run it anyway.",
  "Compare yourself to who you were last month. Not to the player next to you. Their journey is not yours.",
  "When training feels boring you are usually one session away from a breakthrough. Stay with it.",
  "Asking a question is not a weakness. Pretending you understood when you did not is.",
  "Your body is the equipment. Sleep, food, recovery. These are not extras. They are the work.",
  "Before every match decide one thing you will do well no matter what. A first touch. A press. A header. Own it.",
  "You will be dropped. You will be doubted. The players who come back are the ones who do not argue, they answer.",
  "Watch how the senior players warm down. How they speak to staff. How they leave the changing room. That is the standard.",
  "If you only train hard when you feel like it you will be average. The work on the days you do not feel like it is the difference.",
  "A teammate's good game is not your bad day. Their level lifts yours if you let it.",
  "The players around you are reading you constantly. Your body language is a tactic. Use it well.",
  "Mistakes in matches are tuition fees. Pay them, learn from them, do not pay the same one twice.",
  "The pitch is honest. Whatever you have not done in training will show up here. Let that motivate you, not scare you.",
  "Look up before you receive the ball. The half second you save is the difference between Sunday football and a contract.",
  "You do not need to be the loudest in the dressing room. You need to be the one others can rely on.",
  "Every session is a chance to make tomorrow's version of you a little harder to drop.",
];

export function getDailyMessage(): string {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const diff = Date.now() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  return MESSAGES[dayOfYear % MESSAGES.length];
}

const TIPS = [
  "This week after every training session spend five minutes on your weaker foot. Not during — after. The small habits nobody sees are the ones that compound over a season.",
  "Watch one professional who plays your position this week. Not their highlights — a full match. Watch what they do without the ball.",
  "Talk to your coach this week. Ask them one thing you should be working on. Then work on it.",
  "Select one teammate this week and make them better. A word before kick-off. A run that opens space for them. The best players lift others.",
  "This week, log every match honestly within an hour of the final whistle. Memory is generous and it lies. Capture the truth while it is sharp.",
  "Spend ten minutes this week studying the formation your team plays. Know where you should be when the ball is on the opposite flank. Most players never learn this.",
  "Before each session this week, select one technical detail to focus on. First touch direction. Body shape when receiving. Keep it small. Stay narrow.",
  "This week, lose your phone for thirty minutes before bed. Your sleep is part of your training. Protect it like a starting place.",
  "Ask a parent or teammate to film one moment of you in a match this week. Watch it twice. Once for what you did well. Once for what you would change.",
  "This week, write down three things you want a coach to say about you in six months. Then ask yourself if today's behaviour matches that player.",
  "Run a proper cool-down after every session this week. Two minutes of stretching after training is worth more than the extra two minutes you stayed on your phone.",
  "This week, arrive at every session ten minutes early. Use the time to think about what you want to get out of it. Players who drift in, drift out of squads.",
];

export function getWeeklyTip(): string {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const diff = Date.now() - start.getTime();
  const week = Math.floor(diff / (1000 * 60 * 60 * 24 * 7));
  return TIPS[week % TIPS.length];
}
