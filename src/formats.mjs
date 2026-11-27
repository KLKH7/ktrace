// The ways an idea can be shown besides prose. The agent picks at most one per idea and sends
// plain data (steps, notes, two cases, boxes and arrows); this file checks the data and draws
// it, so every explanation looks the same and none can show something the code does not hold.
//   steps        one example worked through with real numbers: for a procedure
//   annotations  the snippet with a note beside each group of lines: for an idea visible in lines
//   contrast     two cases that differ in one thing: for a design choice or a common mistake
//   diagram      boxes and arrows: for a system, a flow or a set of states
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const squash = (s) => String(s).replace(/\s+/g, " ").trim();

export const KINDS = ["steps", "annotations", "contrast", "diagram"];

/**
 * Keeps the one format an idea was given, if it holds up: `{ kind, data }`, or `{ reason }`
 * when it was given but cannot be shown, or null when none was given.
 */
export function check(idea, snippet) {
  const kind = KINDS.find((k) => idea[k]);
  if (!kind) return null;
  const data = idea[kind];
  if (kind === "annotations") {
    if (!snippet) return { reason: "annotations need a snippet that was found in the file" };
    const lost = data.find((a) => !squash(snippet).includes(squash(a.code)));
    if (lost) return { reason: `the annotated lines "${squash(lost.code).slice(0, 40)}" are not in the snippet` };
  }
  if (kind === "diagram") {
    const ids = new Set(data.nodes.map((n) => n.id));
    if (ids.size !== data.nodes.length) return { reason: "two boxes in the diagram share an id" };
    const loose = data.edges.find((e) => !ids.has(e.from) || !ids.has(e.to));
    if (loose) return { reason: `an arrow joins "${loose.from}" to "${loose.to}", and one of them is not a box` };
  }
  return { kind, data };
}

const steps = (d) => `<div class="show steps"><p class="tag">Worked example</p>
${d.given ? `<p class="given">${esc(d.given)}</p>` : ""}
<ol>${d.steps.map((s) => `<li><b>${esc(s.label)}</b><span>${esc(s.detail)}</span></li>`).join("")}</ol>
${d.result ? `<p class="result">${esc(d.result)}</p>` : ""}</div>`;

const contrast = (d) => `<div class="show contrast"><p class="tag">Side by side</p>
<div class="pair">${[d.without, d.with].map((c, k) => `<div class="${k ? "yes" : "no"}"><b>${esc(c.title)}</b><p>${esc(c.body)}</p>${c.code ? `<pre>${esc(c.code)}</pre>` : ""}</div>`).join("")}</div>
${d.point ? `<p class="result">${esc(d.point)}</p>` : ""}</div>`;

/** The snippet cut into the annotated groups of lines, each beside its note. Shown in place of the plain snippet. */
export const annotated = (notes, file) => `<figure class="code noted"><figcaption>${esc(file)}</figcaption>
${notes.map((a) => `<div class="row"><pre>${esc(dedent(a.code))}</pre><p>${esc(a.note)}</p></div>`).join("\n")}</figure>`;

/** Lines pulled back to the left edge together, keeping their indentation relative to each other. */
function dedent(code) {
  const [first, ...rest] = code.replace(/^\n+|\s+$/g, "").split("\n");
  const depth = (l) => l.match(/^\s*/)[0].length;
  const cut = Math.min(...rest.filter((l) => l.trim()).map(depth), depth(first) || Infinity);
  return [first.trimStart(), ...rest.map((l) => l.slice(Number.isFinite(cut) ? cut : 0))].join("\n");
}

const [W, H, GAP_X, GAP_Y, PAD] = [160, 46, 52, 14, 6];

/** Splits a label over at most two lines that fit a box. */
function wrap(label) {
  const words = String(label).split(/\s+/);
  const lines = [""];
  for (const w of words) {
    if ((lines.at(-1) + " " + w).trim().length > 20 && lines.at(-1) && lines.length < 2) lines.push(w);
    else lines[lines.length - 1] = (lines.at(-1) + " " + w).trim();
  }
  return lines.map((l) => (l.length > 23 ? l.slice(0, 22) + "…" : l));
}

/**
 * Where each box goes: columns left to right, a box one column after the last box that points
 * to it. An arrow that points back along a loop is left out of the ordering so loops still fit.
 */
export function layout({ nodes, edges }) {
  const out = new Map(nodes.map((n) => [n.id, edges.filter((e) => e.from === n.id)]));
  const state = new Map();
  const back = new Set();
  const visit = (id) => {
    state.set(id, "open");
    for (const e of out.get(id)) {
      if (state.get(e.to) === "open") back.add(e);
      else if (!state.has(e.to)) visit(e.to);
    }
    state.set(id, "done");
  };
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);
  const column = new Map(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass++) for (const e of edges) if (!back.has(e) && e.from !== e.to) column.set(e.to, Math.max(column.get(e.to), column.get(e.from) + 1));
  const columns = [];
  for (const n of nodes) (columns[column.get(n.id)] ??= []).push(n);
  const tallest = Math.max(...columns.filter(Boolean).map((c) => c.length));
  const height = tallest * H + (tallest - 1) * GAP_Y;
  const at = new Map();
  columns.forEach((list, c) => list?.forEach((n, r) => at.set(n.id, { x: PAD + c * (W + GAP_X), y: PAD + (height - (list.length * H + (list.length - 1) * GAP_Y)) / 2 + r * (H + GAP_Y) })));
  return { at, back, width: PAD * 2 + columns.length * W + (columns.length - 1) * GAP_X, height: height + PAD * 2 };
}

function diagram(d) {
  const { at, width, height } = layout(d);
  const low = height + 34; // room under the boxes for arrows that loop back
  let loops = false;
  const arrows = d.edges
    .map((e) => {
      const [a, b] = [at.get(e.from), at.get(e.to)];
      let path, lx, ly;
      if (b.x > a.x) {
        const [x1, y1, x2, y2] = [a.x + W, a.y + H / 2, b.x - 7, b.y + H / 2];
        const mid = (x1 + x2) / 2;
        path = `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
        [lx, ly] = [mid, (y1 + y2) / 2 - 7];
      } else {
        loops = true;
        const [x1, x2] = [a.x + W / 2 + 14, b.x + W / 2 - 14];
        path = `M${x1},${a.y + H} C${x1},${low} ${x2},${low} ${x2},${b.y + H + 7}`;
        [lx, ly] = [(x1 + x2) / 2, low - 14];
      }
      return `<path d="${path}" marker-end="url(#tip)"/>${e.label ? `<text class="on" x="${lx}" y="${ly}">${esc(e.label)}</text>` : ""}`;
    })
    .join("");
  const boxes = d.nodes
    .map((n) => {
      const { x, y } = at.get(n.id);
      const lines = wrap(n.label);
      return `<rect x="${x}" y="${y}" width="${W}" height="${H}" rx="8"/>${lines.map((l, k) => `<text x="${x + W / 2}" y="${y + H / 2 + 5 + (k - (lines.length - 1) / 2) * 17}">${esc(l)}</text>`).join("")}`;
    })
    .join("");
  const tall = loops ? low + 4 : height;
  return `<div class="show diagram"><p class="tag">How it fits together</p>
<div class="scroll"><svg viewBox="0 0 ${width} ${tall}" width="${width}" height="${tall}" role="img" aria-label="${esc(d.nodes.map((n) => n.label).join(", "))}"><defs><marker id="tip" viewBox="0 0 8 8" refX="1" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path class="tip" d="M0,0 L8,4 L0,8z"/></marker></defs>${arrows}${boxes}</svg></div>
${d.caption ? `<p class="result">${esc(d.caption)}</p>` : ""}</div>`;
}

/** The format drawn as HTML to sit under the idea's prose; nothing for annotations, which replace the snippet. */
export function draw(idea) {
  if (idea.steps) return steps(idea.steps);
  if (idea.contrast) return contrast(idea.contrast);
  if (idea.diagram) return diagram(idea.diagram);
  return "";
}

export const CSS = `
.show { max-width: 1100px; }
.show .given { color: var(--soft); }
.show .result { margin-top: 4px; font-weight: 600; }
.steps ol { list-style: none; margin: 2px 0 0; padding: 0; counter-reset: step; }
.steps li { counter-increment: step; display: grid; grid-template-columns: 18px minmax(0, 20ch) minmax(0, 1fr); gap: 0 10px; padding: 2px 0; border-top: 1px solid var(--line); }
.steps li::before { content: counter(step); color: var(--hue); font-weight: 600; }
.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-top: 2px; }
.pair > div { padding: 2px 14px 4px 0; min-width: 0; }
.pair .yes { padding-left: 14px; border-left: 2px solid var(--hue); } .pair .yes b { color: var(--hue); }
.pair .no b { color: var(--soft); }
.pair pre { margin-top: 4px; border-radius: 4px; background: var(--code); color: var(--code-ink); }
.diagram .scroll { overflow-x: auto; } .diagram svg { display: block; }
.diagram rect { fill: var(--canvas); stroke: var(--hue); stroke-width: 1.5; }
.diagram text { fill: var(--ink); font-size: 13px; text-anchor: middle; }
.diagram text.on { fill: var(--soft); font-size: 12px; paint-order: stroke; stroke: var(--canvas); stroke-width: 5px; }
.diagram svg > path { fill: none; stroke: var(--soft); stroke-width: 1.5; }
.diagram .tip { fill: var(--soft); }
.noted .row { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); border-top: 1px solid #ffffff1f; }
.noted .row:first-of-type { border-top: 0; }
.noted .row p { padding: 8px 10px; font-size: 13px; line-height: 1.45; border-left: 2px solid var(--hue); background: #ffffff12; }
@media (max-width: 860px) { .steps li { grid-template-columns: 18px minmax(0, 1fr); } .steps li span { grid-column: 2; } .noted .row { grid-template-columns: 1fr; } .noted .row p { border-left: 0; border-top: 2px solid var(--hue); } }
`;
