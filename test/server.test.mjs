// Drives the real server over stdio, in a temporary home.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("the tools work together", async () => {
  const home = mkdtempSync(join(tmpdir(), "ktrace-"));
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL("../bin/cli.mjs", import.meta.url).pathname, "serve"], env: { ...process.env, KTRACE_HOME: home, KTRACE_NO_OPEN: "1" } }));
  const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;
  try {

  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), ["explain_change", "note_concept", "record_answer", "suggest_next", "what_i_know"]);
  assert.match(client.getInstructions(), /silently/);
  assert.match(await call("what_i_know"), /Nothing recorded yet/);

  await call("note_concept", { name: "Bayesian Knowledge Tracing", why: "Estimates what the student knows from noisy answers.", where: "learner/model.ts update()" });
  await call("note_concept", { name: "debouncing", why: "Stops the hook firing on every turn." });
  assert.match(await call("what_i_know"), /never asked about:\n- debouncing[\s\S]*- bayesian knowledge tracing \(learner\/model.ts update\(\)\)/);

  assert.match(await call("record_answer", { skill: "Debouncing", verdict: "missed" }), /"debouncing" today: \d+%/);
  const known = await call("what_i_know");
  assert.match(known, /- debouncing: \d+% \(1 answers/);
  assert.doesNotMatch(known.split("never asked about")[1], /debouncing/);
  assert.match(await call("what_i_know", { topic: "bayes" }), /bayesian/);

  // a suggestion that cannot be checked never reaches the list (no network needed: it is refused before any fetch)
  assert.match(await call("suggest_next", { title: "A paper", url: "http://insecure.example/x", kind: "paper", why_now: "It explains the model.", minutes: 20 }), /Refused: only public https/);
  assert.equal(existsSync(join(home, "reading.json")), false);

  // the page: a snippet that is in the file is kept, one that is not is dropped, and so is a source that cannot be checked
  const idea = { plain: "A half-life is the time it takes for something to fall to half. If a memory has a half-life of three days, the chance you still hold it is one half after three days.", here: "It sets how fast an idea fades between answers.", question: "Why does a correct answer lengthen the half-life?" };
  const told = await call("explain_change", {
    summary: "The server can now open a page that teaches the ideas behind a change. It was needed because a list of files explains nothing.",
    ideas: [
      { ...idea, name: "Half-life", file: "src/store.mjs", snippet: 'export const home = () => process.env.KTRACE_HOME ?? join(homedir(), ".ktrace");' },
      { ...idea, name: "A <made-up> idea", file: "src/store.mjs", snippet: "this line is not in the file", source: { title: "A paper", url: "http://insecure.example/x" } },
    ],
  });
  assert.match(told, /Left out[\s\S]*snippet for "A <made-up> idea"[\s\S]*source for "A <made-up> idea"/);
  const html = readFileSync(told.match(/\((\/.*?\.html)\)/)[1], "utf8");
  assert.match(html, /<h3>Half-life<\/h3>[\s\S]*KTRACE_HOME[\s\S]*<figcaption>src\/store.mjs/);
  assert.match(html, /A &lt;made-up&gt; idea/);
  assert.doesNotMatch(html, /this line is not in the file|insecure\.example/);
  assert.match(await call("what_i_know"), /never asked about:[\s\S]*half life/);
  } finally {
    await client.close(); // or a failed check leaves the server running and the test hanging
  }
});
