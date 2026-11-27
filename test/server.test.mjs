// Drives the real server over stdio, in a temporary home.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    topic: "Forgetting",
    summary: "The server can now open a page that teaches the ideas behind a change. It was needed because a list of files explains nothing.",
    ideas: [
      { ...idea, name: "Half-life", file: "src/store.mjs", snippet: 'export const home = () => process.env.KTRACE_HOME ?? join(homedir(), ".ktrace");' },
      { ...idea, name: "A <made-up> idea", file: "src/store.mjs", snippet: "this line is not in the file", source: { title: "A paper", url: "http://insecure.example/x" } },
    ],
  });
  assert.match(told, /Left out[\s\S]*snippet for "A <made-up> idea"[\s\S]*source for "A <made-up> idea"/);
  assert.match(told, /on a new page, "Forgetting"/);
  const html = () => readFileSync(told.match(/\((\/.*?\.html)\)/)[1], "utf8");
  assert.match(html(), /<h1>Forgetting<\/h1>[\s\S]*<\/span>Half-life<\/h2>[\s\S]*<figcaption>src\/store.mjs<\/figcaption><pre>[^<]*KTRACE_HOME/);
  // the same topic again, written differently, is added to the page it already has
  assert.match(await call("explain_change", { topic: "forgetting.", summary: "A second change on the same subject, which belongs on the same page.", ideas: [{ ...idea, name: "Decay" }] }), /added to the page "Forgetting", which now has 2 entries/);
  assert.equal(html().match(/<article class="page" id="page-/g).length, 1);
  assert.match(html(), /A &lt;made-up&gt; idea/);
  for (const [, script] of html().matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(script); // the page's scripts at least parse
  assert.doesNotMatch(html(), /this line is not in the file|insecure\.example/);
  // a snippet's file may be named from the folder the agent was working in, or from a project root above it
  const src = new URL("../src", import.meta.url).pathname;
  writeFileSync(join(home, "checks", "c_deep.json"), JSON.stringify({ id: "c_deep", when: new Date().toISOString(), project: "src", cwd: join(src, "nowhere", "deeper") }));
  const line = "export const home = () => process.env.KTRACE_HOME";
  assert.doesNotMatch(await call("explain_change", { check: "c_deep", summary: "A change explained from a folder below the one the server started in.", ideas: [{ ...idea, name: "Paths", file: "store.mjs", snippet: line }] }), /Left out/);
  assert.match(await call("explain_change", { check: "c_deep", summary: "A file outside every folder the agent worked in is never read.", ideas: [{ ...idea, name: "Paths", file: "../../../../etc/hosts", snippet: "localhost" }] }), /Left out/);
  // a format is drawn when it holds up and left out, with the reason, when it does not
  const shown = await call("explain_change", { topic: "Formats", goal: "Remember what was learned for longer.", before: "Every idea was forgotten at the same speed.", map: { nodes: [{ id: "m", label: "Memory model" }, { id: "q", label: "Questions" }], edges: [{ from: "q", to: "m" }], changed: ["m"] }, summary: "An idea can be shown as worked steps, and a diagram with a loose arrow is refused.", ideas: [
    { ...idea, name: "Steps", problem: "Some things are forgotten in a day and others last a year, and one number has to say which.", predict: { ask: "After two half-lives, what chance is left?", answer: "A quarter." }, deeper: [{ name: "Exponential decay", plain: "Something that loses the same share in each equal stretch of time. Half, then half of that." }], answer: "Because each success is evidence the memory is stronger.", steps: { steps: [{ label: "Day 0", detail: "Chance 100%." }, { label: "Day 3", detail: "Chance 50%." }] } },
    { ...idea, name: "Loose", diagram: { nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "nowhere" }] } },
  ] });
  assert.match(shown, /Left out[\s\S]*the diagram for "Loose"/);
  assert.match(html(), /<dt>Goal<\/dt>[\s\S]*<dt>Before<\/dt>[\s\S]*<dt>Now<\/dt>[\s\S]*class="changed"[\s\S]*class="problem"[\s\S]*class="predict"[\s\S]*Worked example[\s\S]*class="plain"/, "context first, then problem, a guess, the picture, and only then the explanation");
  assert.match(html(), /Worked example[\s\S]*<b>Day 3<\/b>[\s\S]*This rests on: <b>Exponential decay<\/b>[\s\S]*data-level="1"[\s\S]*<details>/);
  assert.match(await call("what_i_know"), /never asked about:[\s\S]*half life/);
  } finally {
    await client.close(); // or a failed check leaves the server running and the test hanging
  }
});
