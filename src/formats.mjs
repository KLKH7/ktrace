// The ways an idea can be shown besides prose. The agent picks at most one per idea and sends
// plain data (steps, notes, two cases, boxes and arrows); this file checks the data and draws
// it, so every explanation looks the same and none can show something the code does not hold.
//   steps        one example worked through with real numbers: for a procedure
//   annotations  the snippet with a note beside each group of lines: for an idea visible in lines
//   contrast     two cases that differ in one thing: for a design choice or a common mistake
//   diagram      boxes and arrows: for a system, a flow or a set of states
//   walk         one picture shown a step at a time, values changing: for a process whose state moves
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const squash = (s) => String(s).replace(/\s+/g, " ").trim();

export const KINDS = ["steps", "annotations", "contrast", "diagram", "walk"];

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
  if (kind === "walk") {
    const boxes = new Set((data.nodes ?? []).map((n) => n.id));
    const bars = new Set((data.meters ?? []).map((m) => m.id));
    if (!boxes.size && !bars.size) return { reason: "a walk needs boxes or meters to show" };
    if (boxes.size !== (data.nodes ?? []).length) return { reason: "two boxes in the walk share an id" };
    const loose = (data.edges ?? []).find((e) => !boxes.has(e.from) || !boxes.has(e.to));
    if (loose) return { reason: `an arrow joins "${loose.from}" to "${loose.to}", and one of them is not a box` };
    for (const [k, f] of data.frames.entries()) {
      const stray = [...(f.focus ?? []), ...Object.keys(f.values ?? {})].find((id) => !boxes.has(id)) ?? Object.keys(f.meters ?? {}).find((id) => !bars.has(id));
      if (stray) return { reason: `step ${k + 1} of the walk names "${stray}", which is not one of its boxes or meters` };
    }
  }
  return { kind, data };
}

/** The map of a project's parts with the changed ones marked: the map if it holds up, else `{ reason }`. */
export function checkMap(map) {
  const ids = new Set(map.nodes.map((n) => n.id));
  if (ids.size !== map.nodes.length) return { reason: "two boxes in the map share an id" };
  const loose = (map.edges ?? []).find((e) => !ids.has(e.from) || !ids.has(e.to));
  if (loose) return { reason: `an arrow joins "${loose.from}" to "${loose.to}", and one of them is not a box` };
  const stray = (map.changed ?? []).find((id) => !ids.has(id));
  if (stray) return { reason: `it marks "${stray}" as changed, which is not one of its boxes` };
  return { map };
}

/** The map drawn, with the parts this change touched filled in. */
export const drawMap = (map) => `<div class="show diagram map">${picture({ nodes: map.nodes, edges: map.edges ?? [] }, false, map.changed ?? [])}</div>`;

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

const [W, BOX, GAP_X, GAP_Y, PAD] = [160, 46, 84, 14, 6];

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
export function layout({ nodes, edges }, H = BOX) {
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

/** Boxes and arrows as an SVG picture. With `live`, each box and arrow is named so a walk can light it and each box has room for a value. */
function picture(d, live = false, marked = []) {
  const H = live ? BOX + 20 : BOX;
  const { at, width, height } = layout(d, H);
  const low = height + 30; // room under the boxes for arrows that loop back
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
      return `<path d="${path}" marker-end="url(#tip)"${live ? ` data-from="${esc(e.from)}" data-to="${esc(e.to)}"` : ""}/>${e.label ? `<text class="on" x="${lx}" y="${ly}">${esc(e.label)}</text>` : ""}`;
    })
    .join("");
  const boxes = d.nodes
    .map((n) => {
      const { x, y } = at.get(n.id);
      const lines = wrap(n.label);
      const middle = y + (live ? BOX / 2 + 2 : H / 2);
      const label = lines.map((l, k) => `<text x="${x + W / 2}" y="${middle + 5 + (k - (lines.length - 1) / 2) * 16}">${esc(l)}</text>`).join("");
      return live ? `<g class="node" data-id="${esc(n.id)}"><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="8"/>${label}<text class="val" x="${x + W / 2}" y="${y + H - 9}"></text></g>` : `<rect${marked.includes(n.id) ? ' class="changed"' : ""} x="${x}" y="${y}" width="${W}" height="${H}" rx="8"/>${label}`;
    })
    .join("");
  const tall = loops ? low + 4 : height;
  return `<div class="scroll"><svg viewBox="0 0 ${width} ${tall}" width="${width}" height="${tall}" role="img" aria-label="${esc(d.nodes.map((n) => n.label).join(", "))}"><defs><marker id="tip" viewBox="0 0 8 8" refX="1" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path class="tip" d="M0,0 L8,4 L0,8z"/></marker></defs>${arrows}${boxes}</svg></div>`;
}

const diagram = (d) => `<div class="show diagram"><p class="tag">How it fits together</p>
${picture(d)}
${d.caption ? `<p class="result">${esc(d.caption)}</p>` : ""}</div>`;

/**
 * One picture and the steps it goes through. The steps travel in the page as data and its
 * script shows one at a time; without the script every step is listed under the picture.
 */
const walk = (d) => `<div class="show walk diagram" tabindex="0" data-frames="${esc(JSON.stringify(d.frames))}"><p class="tag">Step by step</p>
${d.nodes?.length ? picture({ nodes: d.nodes, edges: d.edges ?? [] }, true) : ""}
${(d.meters ?? []).map((m) => `<div class="meter" data-id="${esc(m.id)}" data-max="${m.max}"><span>${esc(m.label)}</span><div class="track"><i></i></div><b></b></div>`).join("")}
<div class="ctl"><button type="button" data-go="-1" aria-label="Previous step">‹</button><span class="count"></span><button type="button" data-go="1" aria-label="Next step">›</button><button type="button" data-go="play">Play</button><p class="say" aria-live="polite"></p></div>
<p class="pose"><mark></mark></p>
<ol class="frames">${d.frames.map((f) => `<li>${esc(f.say)}${f.ask ? ` <mark>${esc(f.ask)}</mark>` : ""}</li>`).join("")}</ol></div>`;

// Shows each walk one step at a time. What a box or meter holds at a step is the last value any step up to it gave.
// A step that asks something stops the playing there, so the reader answers before going on.
export const SCRIPT = `(function(){[].forEach.call(document.querySelectorAll(".walk"),function(w){
var fr=JSON.parse(w.dataset.frames),i=0,timer=null,pose=w.querySelector(".pose mark"),say=w.querySelector(".say"),count=w.querySelector(".count"),play=w.querySelector("[data-go=play]");
function held(key,id){var v=null;for(var k=0;k<=i;k++)if(fr[k][key]&&fr[k][key][id]!=null)v=fr[k][key][id];return v}
function show(){var f=fr[i],focus=f.focus||[];
[].forEach.call(w.querySelectorAll(".node"),function(g){var id=g.dataset.id,on=focus.indexOf(id)>=0,v=held("values",id);g.classList.toggle("lit",on);g.classList.toggle("dim",focus.length>0&&!on);g.querySelector(".val").textContent=v==null?"":v});
[].forEach.call(w.querySelectorAll("path[data-from]"),function(p){p.classList.toggle("lit",focus.indexOf(p.dataset.from)>=0&&focus.indexOf(p.dataset.to)>=0)});
[].forEach.call(w.querySelectorAll(".meter"),function(m){var v=held("meters",m.dataset.id);m.querySelector("i").style.width=Math.max(0,Math.min(100,100*(v||0)/m.dataset.max))+"%";m.querySelector("b").textContent=v==null?"":v});
say.textContent=f.say;pose.textContent=f.ask||"";pose.parentNode.hidden=!f.ask;count.textContent=(i+1)+" / "+fr.length;
w.querySelector("[data-go='-1']").disabled=i===0;w.querySelector("[data-go='1']").disabled=i===fr.length-1}
function stop(){clearInterval(timer);timer=null;play.textContent="Play"}
function go(by){i=Math.max(0,Math.min(fr.length-1,i+by));show();if(i===fr.length-1||fr[i].ask)stop()}
w.addEventListener("click",function(e){var b=e.target.closest("[data-go]");if(!b)return;
if(b.dataset.go!=="play"){stop();return go(+b.dataset.go)}
if(timer)return stop();if(i===fr.length-1){i=0;show()}play.textContent="Pause";timer=setInterval(function(){go(1)},1900)});
w.addEventListener("keydown",function(e){if(e.key==="ArrowRight"){stop();go(1)}if(e.key==="ArrowLeft"){stop();go(-1)}});
show()})})()`;

/** The format drawn as HTML to sit under the idea's prose; nothing for annotations, which replace the snippet. */
export function draw(idea) {
  if (idea.steps) return steps(idea.steps);
  if (idea.contrast) return contrast(idea.contrast);
  if (idea.diagram) return diagram(idea.diagram);
  if (idea.walk) return walk(idea.walk);
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
.walk { outline: 0; }
.pose { margin-top: 2px; font-weight: 600; } .pose mark, .frames mark { background: var(--mark); color: var(--mark-ink); padding: 1px 4px; }
.map rect.changed { fill: color-mix(in srgb, var(--hue) 24%, var(--canvas)); stroke-width: 2.5; }
.walk .node rect, .walk .node, .walk svg > path { transition: fill 0.35s, stroke 0.35s, stroke-width 0.35s, opacity 0.35s; }
.walk .node.lit rect { fill: color-mix(in srgb, var(--hue) 20%, var(--canvas)); stroke-width: 2.5; }
.walk .node.dim { opacity: 0.4; }
.walk .val { fill: var(--hue); font-size: 14px; font-weight: 700; }
.walk svg > path.lit { stroke: var(--hue); stroke-width: 2.5; }
.meter { display: grid; grid-template-columns: minmax(0, 18ch) minmax(0, 360px) 5ch; gap: 10px; align-items: center; margin-top: 4px; font-size: 14px; }
.meter .track { height: 14px; border: 1px solid var(--line); border-radius: 3px; overflow: hidden; }
.meter i { display: block; height: 100%; width: 0; background: var(--hue); transition: width 0.5s; }
.meter b { color: var(--hue); font-variant-numeric: tabular-nums; }
.ctl { display: flex; align-items: baseline; gap: 6px; margin-top: 6px; }
.ctl button { padding: 0 9px; border: 1px solid var(--line); border-radius: 4px; background: var(--pick); cursor: pointer; line-height: 1.6; }
.ctl button:disabled { opacity: 0.35; cursor: default; }
.ctl .count { color: var(--soft); font-size: 13px; font-variant-numeric: tabular-nums; min-width: 5ch; text-align: center; }
.ctl .say { margin-left: 8px; font-weight: 600; }
.frames { margin: 4px 0 0; padding-left: 22px; }
.js .frames, html:not(.js) .ctl { display: none; }
.noted .row { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); border-top: 1px solid #ffffff1f; }
.noted .row:first-of-type { border-top: 0; }
.noted .row p { padding: 8px 10px; font-size: 13px; line-height: 1.45; border-left: 2px solid var(--hue); background: #ffffff12; }
@media (max-width: 860px) { .steps li { grid-template-columns: 18px minmax(0, 1fr); } .steps li span { grid-column: 2; } .noted .row { grid-template-columns: 1fr; } .noted .row p { border-left: 0; border-top: 2px solid var(--hue); } }
`;
