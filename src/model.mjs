// The learner model: for each skill, the probability that this student can explain it today.
//
// Two ideas, both old and well tested:
//  1. Bayesian knowledge tracing (Corbett & Anderson, 1994). Each skill is either known or not.
//     We never see that directly, only answers, and answers are noisy: a student who knows it
//     can slip, one who doesn't can guess. After each answer Bayes' rule updates the
//     probability of "known"; then there is a chance the attempt itself taught it.
//  2. A forgetting curve (Ebbinghaus; half-life regression, Settles & Meeder, 2016). Between
//     answers the probability decays, halving every `halfLife` days. Explaining something well
//     lengthens the half-life; missing it shortens it. That is what schedules the next ask.
//
// An answer is { when, skill, verdict: "explained" | "partial" | "missed" }.
//
// The four tracing numbers start as sensible defaults. fit() learns them from real answers
// once there are enough (it refuses below MIN_TO_FIT), by maximum likelihood over a grid.


// Speaking an explanation is hard to fake, so the chance of a lucky "explained" is low.
export const DEFAULTS = { init: 0.3, learn: 0.15, slip: 0.1, guess: 0.1 };
export const MIN_TO_FIT = 200;
const FIRST_HALF_LIFE = 3; // days
const DAY = 86_400_000;
const SCORE = { explained: 1, partial: 0.5, missed: 0 };

/** One name for a skill however it was written: lower case, letters and digits, single spaces. */
export const canon = (skill) => skill.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** What is left of `known` after `days` with this half-life. */
export const decay = (known, halfLife, days) => known * 2 ** (-Math.max(0, days) / halfLife);

/** The chance of an "explained" answer when the skill is known with probability `known`. */
const expectRight = (known, p) => known * (1 - p.slip) + (1 - known) * p.guess;

/** Bayes' rule on one answer, then the chance that the attempt taught it. A partial answer counts as half of each. */
export function update(known, score, p) {
  const right = (known * (1 - p.slip)) / expectRight(known, p);
  const wrong = (known * p.slip) / (1 - expectRight(known, p));
  const posterior = score * right + (1 - score) * wrong;
  return posterior + (1 - posterior) * p.learn;
}

/** Runs every answer through the model, oldest first, and returns each skill as it stands at `now`. */
export function trace(answers, now, p = DEFAULTS) {
  const skills = new Map();
  for (const a of [...answers].sort((x, y) => x.when.localeCompare(y.when))) {
    const name = canon(a.skill);
    if (!name || !(a.verdict in SCORE)) continue;
    const s = skills.get(name) ?? { skill: name, known: p.init, halfLife: FIRST_HALF_LIFE, last: a.when, answers: 0, missed: 0 };
    const faded = decay(s.known, s.halfLife, (Date.parse(a.when) - Date.parse(s.last)) / DAY);
    const score = SCORE[a.verdict];
    s.known = update(Math.max(faded, 0.001), score, p);
    s.halfLife = Math.min(180, Math.max(1, s.halfLife * (score === 1 ? 2 : score === 0 ? 0.5 : 1)));
    s.last = a.when;
    s.answers += 1;
    if (score === 0) s.missed += 1;
    skills.set(name, s);
  }
  return [...skills.values()]
    .map((s) => ({ ...s, known: decay(s.known, s.halfLife, (now.getTime() - Date.parse(s.last)) / DAY) }))
    .sort((a, b) => a.known - b.known);
}

/** The skills most worth asking about again: the least known first. */
export const weakest = (skills, n = 3) => skills.filter((s) => s.known < 0.6).slice(0, n);

/** How well the parameters predict a set of answers (higher is better). Forgetting is left out so the four tracing numbers are fitted on their own. */
export function logLikelihood(answers, p, sorted = false) {
  const known = new Map();
  let total = 0;
  for (const a of sorted ? answers : [...answers].sort((x, y) => x.when.localeCompare(y.when))) {
    const key = `${a.conversation ?? ""}|${a.skill}`;
    const k = known.get(key) ?? p.init;
    const right = expectRight(k, p);
    const score = SCORE[a.verdict];
    total += score * Math.log(right) + (1 - score) * Math.log(1 - right);
    known.set(key, update(k, score, p));
  }
  return total;
}

/** The parameters that best explain the answers, searched over a grid. Null until there are MIN_TO_FIT answers. */
export function fit(answers, min = MIN_TO_FIT) {
  if (answers.length < min) return null;
  const steps = (from, to, by) => Array.from({ length: Math.round((to - from) / by) + 1 }, (_, i) => +(from + i * by).toFixed(2));
  const inOrder = [...answers].sort((x, y) => x.when.localeCompare(y.when));
  let best = DEFAULTS;
  let bestScore = -Infinity;
  for (const init of steps(0.05, 0.8, 0.05)) for (const learn of steps(0.05, 0.5, 0.05)) for (const slip of steps(0.05, 0.3, 0.05)) for (const guess of steps(0.05, 0.3, 0.05)) {
    const p = { init, learn, slip, guess };
    const score = logLikelihood(inOrder, p, true);
    if (score > bestScore) [best, bestScore] = [p, score];
  }
  return best;
}
