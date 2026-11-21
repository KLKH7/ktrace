// Step 3: this project's model (src/model.mjs) on the same split. Three versions, decided before
// looking at any result:
//   ktrace_defaults   the four numbers as shipped, with nothing learned from the data
//   ktrace_fit        the four numbers fitted once on all training answers (what fit() does)
//   ktrace_per_skill  the four numbers fitted separately for each skill with at least 200
//                     training answers, as pyBKT does; other skills use the single fit
// and two yardsticks any model should beat:
//   base_overall      always predict the training set's share of right answers
//   base_skill        predict each skill's share of right answers in training
// The forgetting curve is not tested here: this dataset has no usable times between answers.
//   node bench/ktrace_run.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULTS, expectRight, fit, update } from "../src/model.mjs";

const DATA = new URL("data/", import.meta.url);

/** Reads train.csv or test.csv: row, order_id, user_id, skill_id, correct, then the skill's name (unused here). */
function read(name) {
  const [header, ...lines] = readFileSync(new URL(`${name}.csv`, DATA), "utf8").trim().split("\n");
  if (!header.startsWith("row,order_id,user_id,skill_id,correct,")) throw new Error(`unexpected columns in ${name}.csv: ${header}`);
  return lines.map((line) => {
    const [row, , user, skill, correct] = line.split(",", 5);
    return { row: Number(row), user, skill, correct: Number(correct) };
  });
}

const train = read("train");
const test = read("test");
// in the model's own terms: an answer is "explained" or "missed", and a student is a conversation
const asAnswers = (rows) => rows.map((r, i) => ({ when: String(i).padStart(9, "0"), skill: r.skill, verdict: r.correct ? "explained" : "missed", conversation: r.user }));

const mean = (rows) => rows.reduce((n, r) => n + r.correct, 0) / rows.length;
const overall = mean(train);
const bySkill = Map.groupBy(train, (r) => r.skill);

console.error("fitting on all training answers…");
const single = fit(asAnswers(train));
console.error("fitting per skill…");
const perSkill = new Map();
for (const [skill, rows] of bySkill) if (rows.length >= 200) perSkill.set(skill, fit(asAnswers(rows)));

/** Predicts each test answer before seeing it, then updates on it: the standard way these models are scored. */
function run(params) {
  const known = new Map();
  return test.map((r) => {
    const p = params(r.skill);
    const key = `${r.user}|${r.skill}`;
    const k = known.get(key) ?? p.init;
    known.set(key, update(k, r.correct, p));
    return expectRight(k, p);
  });
}

const variants = {
  base_overall: test.map(() => overall),
  base_skill: test.map((r) => (bySkill.has(r.skill) ? mean(bySkill.get(r.skill)) : overall)),
  ktrace_defaults: run(() => DEFAULTS),
  ktrace_fit: run(() => single),
  ktrace_per_skill: run((skill) => perSkill.get(skill) ?? single),
};
for (const [name, preds] of Object.entries(variants)) writeFileSync(new URL(`preds_${name}.csv`, DATA), "row,pred\n" + test.map((r, i) => `${r.row},${preds[i]}`).join("\n") + "\n");
writeFileSync(new URL("ktrace_params.json", DATA), JSON.stringify({ defaults: DEFAULTS, fit: single, skillsFittedSeparately: perSkill.size, skillsInTraining: bySkill.size }, null, 2));
console.log(JSON.stringify({ single, skillsFittedSeparately: perSkill.size, skillsInTraining: bySkill.size }));
