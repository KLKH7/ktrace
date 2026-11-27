// The notebook: every explained change, kept in one place and laid out like a note-taking app.
// Sections are projects, pages are topics, and each change is an entry added to its topic's
// page, so a topic that comes up again grows one page instead of starting another. One
// self-contained file with nothing loaded from the network; its script only switches pages,
// remembers the day or night choice, sends an "I'm lost here" click to ktrace and plays a
// source video in place when asked (the one thing that then comes from the network), and without it every page is shown one after another.
import { CSS as FORMATS, annotated, draw } from "./formats.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const kind = (url) => (/youtube\.com|youtu\.be/.test(url) ? "Watch" : /arxiv\.org/.test(url) ? "Paper" : "Read");
const host = (url) => url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** The page a check belongs on: the topic it was given, or failing that its first idea. */
export const topic = (check) => check.topic?.trim() || check.ideas?.[0]?.name || "Notes";

/**
 * Sorts checks into sections (projects) and pages (topics), most recently touched first.
 * A topic matches an existing page whatever its capitals or punctuation.
 */
export function shelve(checks) {
  const sections = new Map();
  for (const check of [...checks].filter((c) => c.ideas?.length).sort((a, b) => a.when.localeCompare(b.when))) {
    if (!sections.has(check.project)) sections.set(check.project, { name: check.project, pages: new Map(), touched: "" });
    const section = sections.get(check.project);
    const k = key(topic(check));
    if (!section.pages.has(k)) section.pages.set(k, { title: topic(check), entries: [], touched: "" });
    const page = section.pages.get(k);
    page.entries.push(check);
    page.touched = section.touched = check.when;
  }
  const recent = (a, b) => b.touched.localeCompare(a.touched);
  return [...sections.values()].sort(recent).map((s) => ({ ...s, pages: [...s.pages.values()].sort(recent) }));
}

const NIGHT = `--canvas: #1c1c1e; --pane: #131314; --pane2: #232326; --ink: #f5f5f5; --soft: #a8a8ad; --line: #37373c; --pick: #2f2f34; --mark: #4a3b12; --mark-ink: #ffe9a8; --code: #0b0b0c; --code-ink: #e8e8ea; --lift: 45%; color-scheme: dark;`;
const HUES = ["#7a2bbf", "#0f6cbd", "#0e7a0d", "#c43501", "#b4269f", "#038387", "#8a6a00", "#c4262d"];

const CSS = `
:root { --canvas: #fff; --pane: #f0f0f2; --pane2: #f8f8f9; --ink: #1f1f21; --soft: #5f5f66; --line: #dedee2; --pick: #fff; --mark: #fff0a8; --mark-ink: #1f1f21; --code: #1f1f21; --code-ink: #f1f1f3; --lift: 0%; color-scheme: light;
--mono: ui-monospace, SFMono-Regular, Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${NIGHT} } }
:root[data-theme="dark"] { ${NIGHT} }
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--canvas); color: var(--ink); font: 15px/1.55 "Segoe UI", -apple-system, BlinkMacSystemFont, Inter, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
a { color: inherit; } p { margin: 0; } figure { margin: 0; } button { font: inherit; color: inherit; }
[data-hue] { --hue: color-mix(in srgb, var(--raw), #fff var(--lift)); }
${HUES.map((h, i) => `[data-hue="${i}"] { --raw: ${h}; }`).join(" ")}

.app { display: grid; grid-template: "bar bar bar" auto "sections pages canvas" minmax(0, 1fr) / 180px 220px minmax(0, 1fr); height: 100%; }
.bar { grid-area: bar; display: flex; align-items: center; gap: 10px; padding: 6px 14px; background: var(--pane); border-bottom: 1px solid var(--line); font-size: 13px; }
.bar span { color: var(--soft); }
#mode { margin-left: auto; padding: 2px 10px; border-radius: 4px; border: 1px solid var(--line); background: var(--pick); cursor: pointer; }
.sections, .pages { overflow-y: auto; padding: 8px 6px; border-right: 1px solid var(--line); font-size: 14px; }
.sections { grid-area: sections; background: var(--pane); } .pages { grid-area: pages; background: var(--pane2); }
.pane-title { margin: 2px 8px 4px; font-size: 11px; font-weight: 600; color: var(--soft); }
.tab { display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 8px; border-radius: 4px; text-decoration: none; }
.tab:hover { background: color-mix(in srgb, var(--ink) 7%, transparent); }
.tab[aria-current="true"] { background: var(--pick); box-shadow: 0 0 0 1px var(--line); font-weight: 600; }
.sections .tab::before { content: ""; flex: none; width: 4px; height: 16px; border-radius: 2px; background: var(--hue); }
.tab small { margin-left: auto; color: var(--soft); font-weight: 400; font-size: 11px; }
.pages .tab { display: block; padding: 5px 9px; line-height: 1.35; } .pages .tab[aria-current="true"] { box-shadow: inset 3px 0 0 var(--hue), 0 0 0 1px var(--line); }
.pages .tab em { display: block; font-style: normal; font-weight: 400; font-size: 11px; color: var(--soft); }

.canvas { grid-area: canvas; overflow-y: auto; }
.page { padding: 18px 28px 60px; }
.page > header { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; padding-bottom: 6px; border-bottom: 2px solid var(--hue); }
.page h1 { margin: 0; font-size: 24px; line-height: 1.2; font-weight: 600; letter-spacing: -0.01em; }
.page > header p, .stamp { font-size: 12px; color: var(--soft); }
.entry { padding-top: 12px; scroll-margin-top: 8px; }
.entry + .entry { border-top: 1px dashed var(--line); margin-top: 18px; }
.stamp b { color: var(--hue); }
.summary { max-width: 90ch; font-size: 16px; }
.idea { display: grid; gap: 8px 28px; margin-top: 14px; align-items: start; }
.idea > * { min-width: 0; }
.idea h2 { margin: 0 0 2px; font-size: 17px; line-height: 1.35; font-weight: 600; }
.idea h2 span { margin-right: 8px; color: var(--hue); }
.plain, .ask, .deeper p { max-width: 76ch; }
.ask { font-weight: 600; } .ask mark { background: var(--mark); color: var(--mark-ink); padding: 1px 4px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
details { margin-top: 4px; } summary { cursor: pointer; color: var(--soft); font-size: 13px; font-weight: 400; } details[open] > summary { color: var(--ink); }
.ask details p { font-weight: 400; }
.deeper { margin-left: 2px; padding-left: 12px; border-left: 2px dotted var(--line); }
.deeper summary b { font-weight: 600; color: var(--ink); }
.stuck { margin-left: 8px; padding: 0; border: 0; background: none; cursor: pointer; font-size: 12px; color: var(--soft); text-decoration: underline dotted; white-space: nowrap; }
.stuck:hover { color: var(--hue); } .stuck[disabled] { color: var(--hue); text-decoration: none; cursor: default; white-space: normal; }
.here { padding-left: 12px; border-left: 2px solid var(--hue); }
.tag { font-size: 12px; font-weight: 600; color: var(--hue); }
.code { margin-top: 6px; border-radius: 4px; overflow: hidden; background: var(--code); color: var(--code-ink); }
.code figcaption { padding: 3px 10px; font: 11px var(--mono); opacity: 0.6; border-bottom: 1px solid #ffffff26; overflow-wrap: anywhere; }
pre { margin: 0; padding: 8px 10px; font: 12.5px/1.5 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.source { display: flex; gap: 10px; align-items: center; font-size: 14px; text-decoration: none; }
.source:hover b { text-decoration: underline; }
.source img { flex: none; width: 96px; max-height: 64px; object-fit: contain; background: #fff; border: 1px solid var(--line); border-radius: 3px; }
.source small { color: var(--soft); }
.video { display: block; max-width: 560px; }
.video .still { position: relative; display: block; aspect-ratio: 16 / 9; margin-bottom: 4px; border-radius: 4px; overflow: hidden; background: #000; }
.video .still img { width: 100%; height: 100%; max-height: none; object-fit: cover; border: 0; border-radius: 0; }
.video .still::after { content: ""; position: absolute; inset: 0; margin: auto; width: 0; height: 0; border-style: solid; border-width: 16px 0 16px 28px; border-color: transparent transparent transparent #fff; filter: drop-shadow(0 0 6px #000); }
.video iframe { display: block; width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: 4px; margin-bottom: 4px; }
.empty { padding: 48px; color: var(--soft); }

.js .page:not(.on), .js .pages .tab:not(.in) { display: none; }
${FORMATS}
@media (min-width: 1280px) {
  .idea { grid-template-columns: minmax(0, 6fr) minmax(0, 5fr); }
  .what { grid-area: 1 / 1; } .here { grid-area: 1 / 2; } .show { grid-area: 2 / 1 / auto / -1; } .ask { grid-area: 3 / 1; } .source { grid-area: 3 / 2; }
  .idea.stack > * { grid-area: auto / 1 / auto / -1; }
}
@media (max-width: 860px) {
  html, body { height: auto; }
  .app { display: block; } .bar { position: sticky; top: 0; z-index: 1; }
  .sections, .pages { display: flex; gap: 4px; overflow-x: auto; padding: 6px 10px; border-right: 0; border-bottom: 1px solid var(--line); }
  .pane-title { display: none; } .tab { width: auto; flex: none; white-space: nowrap; } .tab small, .pages .tab em { display: none; }
  .page { padding: 14px 14px 48px; }
}
@media print { .bar, .sections, .pages, .stuck { display: none; } .app { display: block; } .js .page:not(.on) { display: block; } }
`;

const EARLY = `document.documentElement.classList.add("js");try{var t=localStorage.getItem("ktrace-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;
// Shows the page named in the address (a page id, or an entry id on it), else the first page.
const SCRIPT = `(function(){var r=document.documentElement,b=document.getElementById("mode"),all=function(s){return [].slice.call(document.querySelectorAll(s))};
function now(){return r.dataset.theme||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}
function label(){b.textContent=now()==="dark"?"\\u2600 Day":"\\u263E Night"}
b.hidden=false;b.onclick=function(){var n=now()==="dark"?"light":"dark";r.dataset.theme=n;try{localStorage.setItem("ktrace-theme",n)}catch(e){}label()};label();
function go(){var at=document.getElementById(location.hash.slice(1))||(location.hash?null:document.querySelector(".entry.new")),page=at&&at.closest(".page")||document.querySelector(".page");if(!page)return;
all(".page").forEach(function(p){p.classList.toggle("on",p===page)});
all(".sections .tab").forEach(function(t){t.setAttribute("aria-current",t.dataset.section===page.dataset.section)});
all(".pages .tab").forEach(function(t){t.classList.toggle("in",t.dataset.section===page.dataset.section);t.setAttribute("aria-current",t.getAttribute("href")==="#"+page.id)});
if(at&&at!==page)at.scrollIntoView();else document.querySelector(".canvas").scrollTop=0}
addEventListener("hashchange",go);go();
var token=document.querySelector("meta[name=ktrace-token]").content,served=/^http/.test(location.protocol);
function said(b,t){b.disabled=true;b.textContent=t}
function copy(b){var t='I am lost on "'+b.dataset.at+'" (part of "'+b.dataset.name+'"). Explain only that, one level more basic, with one worked example.';
(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){said(b,"Copied a question for Claude: paste it in the chat.")},function(){prompt("Paste this to Claude:",t)})}
document.addEventListener("click",function(e){var v=e.target.closest(".video .still");
if(v&&served){e.preventDefault();var a=v.parentNode,f=document.createElement("iframe");f.src="https://www.youtube-nocookie.com/embed/"+a.dataset.video+"?autoplay=1&start="+a.dataset.start;f.allow="autoplay; encrypted-media; picture-in-picture; fullscreen";f.title="Video";a.replaceChild(f,v);return}
var b=e.target.closest(".stuck");if(!b)return;
if(!served)return copy(b);
fetch("/stuck",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:token,check:b.dataset.check,idea:+b.dataset.idea,level:+b.dataset.level})}).then(function(r){r.ok?said(b,"Noted. Claude will go deeper on this at the end of its next turn."):copy(b)},function(){copy(b)})})})()`;

const video = (url) => url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/)?.[1];
const minutes = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;

/**
 * The source of an idea. A video is shown as its still with a play mark: a click plays it in
 * place from the moment that matters, when the notebook is served; as a file it opens YouTube.
 */
function source(s) {
  if (!s) return "";
  const by = [s.by, s.year, host(s.url)].filter(Boolean).join(" · ");
  const id = video(s.url);
  const said = `<span><span class="tag">${kind(s.url)} next</span> <b>${esc(s.title)}</b> <small>${esc(by)}${id && s.start ? ` · from ${minutes(s.start)}` : ""}</small></span>`;
  if (id) {
    const href = `https://www.youtube.com/watch?v=${id}${s.start ? `&t=${s.start}s` : ""}`;
    return `<a class="source video" href="${esc(href)}" data-video="${id}" data-start="${s.start ?? 0}"><span class="still">${s.figure?.src ? `<img src="${esc(s.figure.src)}" alt="">` : ""}</span>${said}</a>`;
  }
  return `<a class="source" href="${esc(s.url)}">${s.figure?.src ? `<img src="${esc(s.figure.src)}" alt="${esc(s.figure.caption || "")}">` : ""}${said}</a>`;
}

const lost = (id, k, level, name, at) => `<button class="stuck" type="button" data-check="${esc(id)}" data-idea="${k}" data-level="${level}" data-name="${esc(name)}" data-at="${esc(at)}">I'm lost here</button>`;

/** The chain an idea rests on, each level folded inside the one before, so it is opened only as far as needed. */
const ladder = (id, k, i, level = 1) => {
  const d = i.deeper?.[level - 1];
  return d ? `<details class="deeper"><summary>This rests on: <b>${esc(d.name)}</b></summary><p>${esc(d.plain)}${lost(id, k, level, i.name, d.name)}</p>${ladder(id, k, i, level + 1)}</details>` : "";
};

const idea = (i, k, id) => `<section class="idea${i.snippet && i.annotations ? " stack" : ""}">
<div class="what"><h2><span>${k + 1}</span>${esc(i.name)}</h2>
<p class="plain">${esc(i.plain)}${lost(id, k, 0, i.name, i.name)}</p>
${ladder(id, k, i)}</div>
${draw(i)}
<div class="here"><p><span class="tag">In this code</span> ${esc(i.here)}</p>
${i.snippet ? (i.annotations ? annotated(i.annotations, i.file) : `<figure class="code"><figcaption>${esc(i.file)}</figcaption><pre>${esc(i.snippet)}</pre></figure>`) : ""}</div>
<div class="ask"><p><mark>${esc(i.question)}</mark></p>${i.answer ? `<details><summary>Say your answer first, then check</summary><p>${esc(i.answer)}</p></details>` : ""}</div>
${source(i.source)}
</section>`;

/** The whole notebook for these checks, as HTML. `latest` is the id of the entry just added; `token` goes back with each "I'm lost here" click. */
export function notebook(checks, latest, token = "") {
  const sections = shelve(checks);
  let n = 0;
  for (const s of sections) for (const p of s.pages) p.id = `page-${++n}`;
  const count = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  const tabs = sections.map((s, i) => `<a class="tab" data-hue="${i % HUES.length}" data-section="${i}" href="#${s.pages[0].id}">${esc(s.name)}<small>${s.pages.length}</small></a>`).join("\n");
  const pages = sections
    .flatMap((s, i) => s.pages.map((p) => `<a class="tab" data-hue="${i % HUES.length}" data-section="${i}" href="#${p.id}">${esc(p.title)}<em>${day(p.touched)} · ${count(p.entries.length, "entry").replace("entrys", "entries")}</em></a>`))
    .join("\n");
  const body = sections
    .flatMap((s, i) =>
      s.pages.map(
        (p) => `<article class="page" id="${p.id}" data-hue="${i % HUES.length}" data-section="${i}">
<header><h1>${esc(p.title)}</h1><p>${esc(s.name)} · started ${day(p.entries[0].when)} · ${count(p.entries.reduce((k, e) => k + e.ideas.length, 0), "idea")}</p></header>
${p.entries
  .map(
    (e) => `<section class="entry${e.id === latest ? " new" : ""}" id="${esc(e.id)}">
<p class="stamp">${e.id === latest ? "<b>New</b> · " : ""}${day(e.when)}, ${clock(e.when)}${e.lines ? ` · ${e.lines} lines` : ""}</p>
<p class="summary">${esc(e.summary)}</p>
${e.ideas.map((x, k) => idea(x, k, e.id)).join("\n")}
</section>`,
  )
  .join("\n")}
</article>`,
      ),
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ktrace notebook</title>
<meta name="ktrace-token" content="${esc(token)}">
<script>${EARLY}</script>
<style>${CSS}</style>
</head>
<body>
<div class="app">
<header class="bar"><b>ktrace notebook</b><span>${count(sections.length, "project")} · ${count(n, "page")}</span><button id="mode" type="button" hidden>Night</button></header>
<nav class="sections" aria-label="Projects"><p class="pane-title">Projects</p>
${tabs}
</nav>
<nav class="pages" aria-label="Pages"><p class="pane-title">Pages</p>
${pages}
</nav>
<main class="canvas">
${body || `<p class="empty">Nothing here yet. Pages appear as Claude explains the changes it makes for you.</p>`}
</main>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
