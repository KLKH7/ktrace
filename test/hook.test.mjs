// The hook, run as Claude Code runs it: JSON in, a decision (or nothing) out.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const hook = new URL("../src/hook.mjs", import.meta.url).pathname;
const edit = (name, input) => JSON.stringify({ type: "assistant", cwd: "/work/app", message: { content: [{ type: "tool_use", name, input }] } });
const code = (n) => Array.from({ length: n }, (_, i) => `const x${i} = ${i};`).join("\n");

test("asks for an explanation once enough has been written, and only once", () => {
  const home = mkdtempSync(join(tmpdir(), "ktrace-"));
  const transcript = join(home, "session.jsonl");
  const run = (extra = {}) => {
    const r = spawnSync(process.execPath, [hook], { input: JSON.stringify({ session_id: "s1", transcript_path: transcript, cwd: "/work/app", ...extra }), env: { ...process.env, KTRACE_HOME: home }, encoding: "utf8" });
    return r.stdout ? JSON.parse(r.stdout) : null;
  };

  writeFileSync(transcript, edit("Write", { file_path: "/work/app/src/a.js", content: code(10) }) + "\n");
  assert.equal(run(), null, "ten lines is not enough");

  writeFileSync(transcript, [
    edit("Write", { file_path: "/work/app/src/a.js", content: code(10) }),
    edit("Edit", { file_path: "/work/app/src/b.js", new_string: code(25) }),
    edit("Write", { file_path: "/work/app/.env.local", content: code(500) }),
    edit("Bash", { command: `cat > lib/c.js <<'EOF'\n${code(12)}\nEOF` }),
    "",
  ].join("\n"));
  assert.equal(run({ stop_hook_active: true }), null, "never asks while Claude is finishing an earlier request");
  const asked = run();
  assert.equal(asked.decision, "block");
  assert.match(asked.reason, /written 47 lines here \(src\/b\.js, lib\/c\.js, src\/a\.js\)/);
  assert.match(asked.reason, /Pass a topic of two to four words/, "no pages yet, so it asks for a new topic");
  const id = asked.reason.match(/check "(c_[a-z0-9]+)"/)[1];
  const check = JSON.parse(readFileSync(join(home, "checks", `${id}.json`), "utf8"));
  assert.deepEqual(check.files.map((f) => f.path), ["src/b.js", "lib/c.js", "src/a.js"], "the secrets file is left out");

  assert.equal(run(), null, "the same work is not asked about twice");
  assert.equal(existsSync(join(home, "state.json")), true);

  // a click on "I'm lost here" is passed on at the next stop, once, without waiting for new code
  writeFileSync(join(home, "stuck.jsonl"), JSON.stringify({ when: new Date().toISOString(), check: "c_old", idea: 0, level: 1, project: "app", topic: "Rate limiting", name: "Token bucket", at: "A rate" }) + "\n");
  const lost = run();
  assert.match(lost.reason, /clicked "I'm lost here" on "A rate", part of "Token bucket"[\s\S]*topic "Rate limiting"/);
  const next = JSON.parse(readFileSync(join(home, "checks", `${lost.reason.match(/check "(c_[a-z0-9]+)"/)[1]}.json`), "utf8"));
  assert.deepEqual([next.project, next.topic, next.follows], ["app", "Rate limiting", "c_old"]);
  assert.equal(run(), null, "the same click is not passed on twice");
});
