// Checking and drawing the formats an idea can be shown in.
import assert from "node:assert/strict";
import { test } from "node:test";
import { annotated, check, draw, layout } from "../src/formats.mjs";

const diagram = { nodes: [{ id: "a", label: "Request" }, { id: "b", label: "Refill" }, { id: "c", label: "Allow" }, { id: "d", label: "Refuse" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "b", to: "d" }, { from: "d", to: "a", label: "retry" }] };

test("one format is kept when it holds up, and refused with a reason when it does not", () => {
  assert.equal(check({}, "x"), null);
  assert.equal(check({ diagram }).kind, "diagram");
  assert.match(check({ diagram: { ...diagram, edges: [{ from: "a", to: "z" }] } }).reason, /not a box/);
  const notes = [{ code: "now = clock()", note: "Read the time." }, { code: "last  =  now", note: "Remember it." }];
  assert.equal(check({ annotations: notes }, "now = clock()\nlast = now").kind, "annotations");
  assert.match(check({ annotations: notes }, "something else").reason, /not in the snippet/);
  assert.match(check({ annotations: notes }).reason, /need a snippet/);
  assert.equal(check({ steps: { steps: [] }, diagram }).kind, "steps", "only the first of two formats is kept");
});

test("boxes run left to right after whatever points to them, and a loop does not break the order", () => {
  const { at, width } = layout(diagram);
  assert.ok(at.get("a").x < at.get("b").x && at.get("b").x < at.get("c").x);
  assert.equal(at.get("c").x, at.get("d").x);
  assert.notEqual(at.get("c").y, at.get("d").y);
  assert.ok(width < 900);
});

test("formats are drawn with their text escaped", () => {
  assert.match(draw({ diagram }), /<svg[\s\S]*Request[\s\S]*retry/);
  assert.match(draw({ steps: { given: "x < 3", steps: [{ label: "Take", detail: "3 -> 2" }, { label: "Wait", detail: "1 s" }] } }), /x &lt; 3[\s\S]*<li><b>Take<\/b>/);
  assert.match(draw({ contrast: { without: { title: "A timer", body: "Runs always." }, with: { title: "Lazy", body: "Runs when asked." } } }), /class="no"[\s\S]*class="yes"/);
  assert.match(annotated([{ code: "a<b", note: "Compare." }], "x.py"), /a&lt;b[\s\S]*Compare\./);
  assert.equal(draw({}), "");
});
