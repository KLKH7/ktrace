// The notebook served on this machine, and the one click it accepts.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("a click on \"I'm lost here\" is written down only with the token, and only for a place that exists", async () => {
  const home = (process.env.KTRACE_HOME = mkdtempSync(join(tmpdir(), "ktrace-")));
  const { listen, token } = await import("../src/web.mjs");
  mkdirSync(join(home, "checks"));
  writeFileSync(join(home, "checks", "c_one.json"), JSON.stringify({ id: "c_one", when: "2026-01-01T00:00:00.000Z", project: "app", topic: "Rate limiting", summary: "A limiter.", ideas: [{ name: "Token bucket", plain: "A bucket of tokens.", here: "Limits calls.", question: "Why can a burst get through?", deeper: [{ name: "A rate", plain: "How much per second." }] }] }));
  const server = await listen(0);
  const at = `http://127.0.0.1:${server.address().port}`;
  const click = (body) => fetch(`${at}/stuck`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.status);
  try {
    const page = () => fetch(at).then((r) => r.text());
    assert.match(await page(), /Due today[\s\S]*1 of 1 due[\s\S]*Why can a burst get through\?[\s\S]*never asked since/, "an idea explained long ago and never asked about is due");
    assert.equal(await click({ token: "wrong", check: "c_one", idea: 0, level: 1 }), 403);
    assert.equal(await click({ token: token(), check: "c_none", idea: 0, level: 0 }), 403);
    assert.equal(await click({ token: token(), check: "c_one", idea: 0, level: 5 }), 403);
    assert.equal(await click({ token: token(), check: "c_one", idea: 0, level: 1, at: "words from the page are ignored" }), 204);
    const [row] = readFileSync(join(home, "stuck.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual([row.project, row.topic, row.name, row.at], ["app", "Rate limiting", "Token bucket", "A rate"]);
    // how a review question went: only a known verdict, with the token, for an idea that exists
    const grade = (body) => fetch(`${at}/answer`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.status);
    assert.equal(await grade({ token: token(), check: "c_one", idea: 0, verdict: "brilliant" }), 403);
    assert.equal(await grade({ token: "wrong", check: "c_one", idea: 0, verdict: "explained" }), 403);
    assert.equal(await grade({ token: token(), check: "c_one", idea: 0, verdict: "explained" }), 204);
    const kept = JSON.parse(readFileSync(join(home, "answers.jsonl"), "utf8").trim());
    assert.deepEqual([kept.skill, kept.verdict, kept.track], ["token bucket", "explained", "review"]);
    assert.match(await page(), /nothing due[\s\S]*Coming up: Token bucket/, "once answered it is no longer due today");
    const named = await new Promise((done) => request(`${at}/ping`, { headers: { host: "evil.example" } }, (r) => done(r.statusCode)).end());
    assert.equal(named, 403, "a name that only resolves here is refused");
  } finally {
    server.close();
  }
});
