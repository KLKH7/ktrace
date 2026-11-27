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
  writeFileSync(join(home, "notebook.html"), "<p>the notebook</p>");
  writeFileSync(join(home, "checks", "c_one.json"), JSON.stringify({ id: "c_one", project: "app", topic: "Rate limiting", ideas: [{ name: "Token bucket", deeper: [{ name: "A rate", plain: "How much per second." }] }] }));
  const server = await listen(0);
  const at = `http://127.0.0.1:${server.address().port}`;
  const click = (body) => fetch(`${at}/stuck`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.status);
  try {
    assert.equal(await (await fetch(at)).text(), "<p>the notebook</p>");
    assert.equal(await click({ token: "wrong", check: "c_one", idea: 0, level: 1 }), 403);
    assert.equal(await click({ token: token(), check: "c_none", idea: 0, level: 0 }), 403);
    assert.equal(await click({ token: token(), check: "c_one", idea: 0, level: 5 }), 403);
    assert.equal(await click({ token: token(), check: "c_one", idea: 0, level: 1, at: "words from the page are ignored" }), 204);
    const [row] = readFileSync(join(home, "stuck.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual([row.project, row.topic, row.name, row.at], ["app", "Rate limiting", "Token bucket", "A rate"]);
    const named = await new Promise((done) => request(`${at}/ping`, { headers: { host: "evil.example" } }, (r) => done(r.statusCode)).end());
    assert.equal(named, 403, "a name that only resolves here is refused");
  } finally {
    server.close();
  }
});
