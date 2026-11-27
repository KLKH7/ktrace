// node --test test/
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, decay, fit, trace, update, weakest } from "../src/model.mjs";

const at = (day) => new Date(Date.UTC(2026, 0, 1 + day)).toISOString();

test("an explained answer raises the estimate and a missed one lowers it", () => {
  assert.ok(update(0.3, 1, DEFAULTS) > 0.3);
  assert.ok(update(0.6, 0, DEFAULTS) < 0.6);
  const partial = update(0.5, 0.5, DEFAULTS);
  assert.ok(partial < update(0.5, 1, DEFAULTS) && partial > update(0.5, 0, DEFAULTS));
});

test("the estimate halves after one half-life", () => {
  assert.equal(decay(0.8, 3, 3), 0.4);
  assert.equal(decay(0.8, 3, 0), 0.8);
});

test("a skill explained twice fades more slowly than one explained once", () => {
  const once = trace([{ when: at(0), skill: "DCF", verdict: "explained" }], new Date(at(10)))[0];
  const same = trace([{ when: at(0), skill: "dcf", verdict: "explained" }, { when: at(1), skill: "DCF", verdict: "explained" }], new Date(at(11)))[0];
  assert.ok(same.halfLife > once.halfLife && same.known > once.known);
});

test("missed skills come first and well-known ones are not asked again", () => {
  const skills = trace(
    [
      { when: at(0), skill: "wacc", verdict: "missed" },
      { when: at(0), skill: "ebitda", verdict: "explained" },
      { when: at(1), skill: "ebitda", verdict: "explained" },
    ],
    new Date(at(1)),
  );
  assert.equal(skills[0].skill, "wacc");
  assert.deepEqual(weakest(skills).map((s) => s.skill), ["wacc"]);
});

test("the same answers always give the same result", () => {
  const answers = [{ when: at(0), skill: "a", verdict: "partial" }, { when: at(2), skill: "a", verdict: "missed" }];
  assert.deepEqual(trace(answers, new Date(at(5))), trace([...answers].reverse(), new Date(at(5))));
});

test("fitting refuses on too little data and recovers known parameters from simulated students", () => {
  assert.equal(fit([{ when: at(0), skill: "a", verdict: "missed" }]), null);
  const truth = { init: 0.2, learn: 0.3, slip: 0.1, guess: 0.15 };
  let seed = 7;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const answers = [];
  for (let student = 0; student < 1500; student++) {
    let knows = random() < truth.init;
    for (let i = 0; i < 6; i++) {
      const right = random() < (knows ? 1 - truth.slip : truth.guess);
      answers.push({ when: at(i), skill: "s", verdict: right ? "explained" : "missed", conversation: `c${student}` });
      if (!knows) knows = random() < truth.learn;
    }
  }
  const found = fit(answers);
  for (const k of ["init", "learn", "slip", "guess"]) assert.ok(Math.abs(found[k] - truth[k]) <= 0.1, `${k}: ${found[k]} vs ${truth[k]}`);
});

test("an idea is due a day after it is explained, and after an answer once it has had time to fade", async () => {
  const { due } = await import("../src/model.mjs");
  const at = (d) => new Date(Date.UTC(2026, 0, 1) + d * 86_400_000).toISOString();
  const ideas = [{ skill: "Fresh", first: at(9.5) }, { skill: "Old", first: at(0) }, { skill: "Known", first: at(0) }, { skill: "Missed", first: at(0) }];
  const answers = [{ when: at(9), skill: "known", verdict: "explained" }, { when: at(8), skill: "known", verdict: "explained" }, { when: at(7), skill: "missed", verdict: "missed" }];
  const { today, later } = due(ideas, answers, new Date(at(10)));
  assert.deepEqual(today.map((q) => q.key), ["old", "missed"], "never asked comes first, then the weakest");
  assert.deepEqual(later.map((q) => q.key), ["fresh", "known"], "explained half a day ago is due tomorrow; well known waits longer");
  assert.ok(later[0].inDays > 0.4 && later[0].inDays < 0.6 && later[1].inDays > 1);
});
