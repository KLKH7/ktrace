// The forgetting curve, tested. Duolingo's public data has what the first benchmark lacked: for
// each review of a word, the time since that learner last practised it. Before each review this
// project's model says how likely the learner is to recall the word, after fading its belief by
// that time; then it sees what happened and updates. Same reviews and same split as the
// reference (bench/duo_reference.sh): the first 3,000,000, the last 10% of them scored.
// Three versions, decided before looking at any result:
//   ktrace_shipped   the model as shipped; a word is new the first time it appears in the file
//   ktrace_history   the same, but a word's earlier right and wrong answers (which the data
//                    counts but does not date) are replayed first: the wrong ones, then the right
//   ktrace_fit       as ktrace_history, with the four tracing numbers fitted on the first 500,000
//                    training reviews. The forgetting rule itself is never tuned: it is under test.
// and one yardstick: always predict the training reviews' average recall.
//   gunzip -c bench/data/duo/traces.csv.gz | head -n 3000001 | node bench/duo_ktrace.mjs
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { DEFAULTS, decay, expectRight, fit, fresh, step } from "../src/model.mjs";

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

const average = rows.slice(0, SPLIT).reduce((n, r) => n + r.p, 0) / SPLIT;
const test = rows.slice(SPLIT);
const variants = {
  constant: test.map(() => average),
  ktrace_shipped: run(DEFAULTS, false),
  ktrace_history: run(DEFAULTS, true),
  ktrace_fit: run(fitted, true),
};
for (const [name, preds] of Object.entries(variants)) writeFileSync(new URL(`${name}.traces.3000000.preds`, OUT), "p\tpp\tuser_id\n" + test.map((r, i) => `${clip(r.p).toFixed(4)}\t${clip(preds[i]).toFixed(4)}\t${r.user}`).join("\n") + "\n");
writeFileSync(new URL("ktrace_params.json", OUT), JSON.stringify({ defaults: DEFAULTS, fitted, trainAverageRecall: average }, null, 2));
console.log(JSON.stringify({ fitted, average: +average.toFixed(4), scored: test.length }));
