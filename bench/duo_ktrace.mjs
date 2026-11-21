// The forgetting curve, tested. Duolingo's public data has what the first benchmark lacked: for
// each review of a word, the time since that learner last practised it. Before each review this
// project's model says how likely the learner is to recall the word, after fading its belief by
// that time; then it sees what happened and updates. Same reviews and same split as the
// reference (bench/duo_reference.sh): the first 3,000,000, the last 10% of them scored.
// Five versions, decided before looking at any result:
//   ktrace_shipped   the model as shipped; a word is new the first time it appears in the file
//   ktrace_history   the same, but a word's earlier right and wrong answers (which the data
//                    counts but does not date) are replayed first: the wrong ones, then the right
//   ktrace_fit       as ktrace_history, with the four tracing numbers fitted on the first 500,000
//                    training reviews. The forgetting rule is left as shipped.
//   ktrace_forget_fit  as ktrace_fit, and the forgetting rule's three numbers (first half-life,
//                    growth after a right answer, shrinkage after a wrong one) are fitted on the
//                    training reviews (the first 2,700,000) by maximum likelihood
//   ktrace_all_fit   all seven numbers fitted together on the training reviews, within wide bounds
// Nothing is ever fitted on the 300,000 scored reviews.
// and one yardstick: always predict the training reviews' average recall.
//   gunzip -c bench/data/duo/traces.csv.gz | head -n 3000001 | node bench/duo_ktrace.mjs
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { DEFAULTS, FORGETTING, decay, expectRight, fit, fresh, step } from "../src/model.mjs";

const OUT = new URL("data/duo/results/", import.meta.url);
const TOTAL = 3_000_000;
const SPLIT = Math.floor(TOTAL * 0.9);
const FIT_ON = 500_000;
const clip = (p) => Math.min(0.9999, Math.max(0.0001, p)); // as the reference clips recall

const rows = [];
let header = true;
for await (const line of createInterface({ input: process.stdin })) {
  if (header) { header = false; continue; }
  // the word itself (8th column) can contain commas, so read the first seven from the left and the last four from the right
  const left = line.split(",", 7);
  const right = line.split(",").slice(-4).map(Number);
  rows.push({ p: Number(left[0]), days: Number(left[2]) / 86_400, user: left[3], key: `${left[3]}|${left[6]}`, seen: right[0], correct: right[1] });
}
if (rows.length !== TOTAL) throw new Error(`expected ${TOTAL} reviews, read ${rows.length}`);

const verdict = (p) => (p === 1 ? "explained" : p === 0 ? "missed" : "partial");
console.error("fitting…");
const fitted = fit(rows.slice(0, FIT_ON).map((r, i) => ({ when: String(i).padStart(9, "0"), skill: r.key, verdict: verdict(r.p), conversation: "" })));

/** Runs the model through every review in order and returns its prediction for each of the scored ones. */
function run(params, useHistory) {
  const states = new Map();
  const preds = [];
  rows.forEach((r, i) => {
    let s = states.get(r.key);
    if (!s) {
      s = fresh(params);
      if (useHistory) {
        for (let k = 0; k < r.seen - r.correct; k++) s = step(s, 0, 0, params);
        for (let k = 0; k < r.correct; k++) s = step(s, 1, 0, params);
      }
    }
    if (i >= SPLIT) preds.push(expectRight(decay(s.known, s.halfLife, r.days), params));
    states.set(r.key, step(s, r.p, r.days, params));
  });
  return preds;
}

/** How well the parameters predict the training reviews: the average log likelihood per review (higher is better). */
function likelihood(params) {
  const states = new Map();
  let total = 0;
  for (let i = 0; i < SPLIT; i++) {
    const r = rows[i];
    let s = states.get(r.key);
    if (!s) {
      s = fresh(params);
      for (let k = 0; k < r.seen - r.correct; k++) s = step(s, 0, 0, params);
      for (let k = 0; k < r.correct; k++) s = step(s, 1, 0, params);
    }
    const right = clip(expectRight(decay(s.known, s.halfLife, r.days), params));
    total += r.p * Math.log(right) + (1 - r.p) * Math.log(1 - right);
    states.set(r.key, step(s, r.p, r.days, params));
  }
  return total / SPLIT;
}

// each number's allowed range; the search reports any that end on a bound
const BOUNDS = { init: [0.01, 0.99], learn: [0, 0.99], slip: [0.001, 0.5], guess: [0.001, 0.95], first: [0.01, 365], grow: [1, 10], shrink: [0.05, 1] };

/** Climbs one number at a time, in multiplicative steps that halve whenever a full round finds nothing better. */
function search(start, names) {
  let best = { ...start };
  let bestScore = likelihood(best);
  for (let width = 0.5; width > 0.02; ) {
    let improved = false;
    for (const name of names) for (const factor of [1 + width, 1 / (1 + width)]) {
      const [low, high] = BOUNDS[name];
      const value = Math.min(high, Math.max(low, best[name] === 0 ? width * 0.1 : best[name] * factor));
      if (value === best[name]) continue;
      const tried = { ...best, [name]: value };
      const score = likelihood(tried);
      if (score > bestScore + 1e-5) [best, bestScore, improved] = [tried, score, true];
    }
    if (!improved) width /= 2;
    console.error(width.toFixed(3), bestScore.toFixed(5), JSON.stringify(best));
  }
  const atBound = names.filter((n) => BOUNDS[n].includes(best[n]));
  return { params: Object.fromEntries(Object.entries(best).map(([k, v]) => [k, +v.toPrecision(4)])), trainLogLikelihood: +bestScore.toFixed(5), atBound };
}

console.error("fitting the forgetting rule…");
const forgetFit = search({ ...fitted, ...FORGETTING }, ["first", "grow", "shrink"]);
const allFit = search(forgetFit.params, ["init", "learn", "slip", "guess", "first", "grow", "shrink"]);

const average = rows.slice(0, SPLIT).reduce((n, r) => n + r.p, 0) / SPLIT;
const test = rows.slice(SPLIT);
const variants = {
  constant: test.map(() => average),
  ktrace_shipped: run(DEFAULTS, false),
  ktrace_history: run(DEFAULTS, true),
  ktrace_fit: run(fitted, true),
  ktrace_forget_fit: run(forgetFit.params, true),
  ktrace_all_fit: run(allFit.params, true),
};
for (const [name, preds] of Object.entries(variants)) writeFileSync(new URL(`${name}.traces.3000000.preds`, OUT), "p\tpp\tuser_id\n" + test.map((r, i) => `${clip(r.p).toFixed(4)}\t${clip(preds[i]).toFixed(4)}\t${r.user}`).join("\n") + "\n");
writeFileSync(new URL("ktrace_params.json", OUT), JSON.stringify({ defaults: { ...DEFAULTS, ...FORGETTING }, fitted, forgetFit, allFit, trainAverageRecall: average }, null, 2));
console.log(JSON.stringify({ fitted, forgetFit, allFit, average: +average.toFixed(4), scored: test.length }));
