// The page a check opens: what changed, then the ideas behind it, each in plain words with the
// lines that use it, one confirmed source and one question. One self-contained file, no
// scripts and nothing loaded from the network, so it opens anywhere and can be kept or sent.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const kind = (url) => (/youtube\.com|youtu\.be/.test(url) ? "Watch" : /arxiv\.org/.test(url) ? "Paper" : "Read");

const CSS = `
:root { color-scheme: light dark; --ink: #111; --soft: #666; --line: #e4e4e4; --well: #f5f5f5; --page: #fff; }
@media (prefers-color-scheme: dark) { :root { --ink: #eee; --soft: #999; --line: #2a2a2a; --well: #1b1b1b; --page: #111; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 680px; margin: 0 auto; padding: 64px 24px 96px; }
.eyebrow, h2, figcaption, .source, footer { font-size: 13px; color: var(--soft); }
.eyebrow { margin: 0; }
h1 { font-size: 32px; line-height: 1.2; letter-spacing: -0.025em; margin: 4px 0 16px; }
h2 { font-weight: 600; margin: 48px 0 0; }
ol { list-style: none; margin: 0; padding: 0; counter-reset: idea; }
li { counter-increment: idea; padding: 32px 0; border-bottom: 1px solid var(--line); }
li:last-child { border-bottom: 0; }
h3 { font-size: 20px; letter-spacing: -0.015em; margin: 0 0 8px; }
h3::before { content: counter(idea) "  "; color: var(--soft); font-weight: 400; }
p { margin: 0 0 12px; }
.here { color: var(--soft); }
figure { margin: 16px 0; }
pre { margin: 0; padding: 14px 16px; background: var(--well); border-radius: 8px; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
figcaption { margin-top: 6px; }
a { color: inherit; }
.ask { margin: 16px 0 0; padding-left: 14px; border-left: 2px solid var(--ink); font-weight: 500; }
footer { margin-top: 32px; padding-top: 24px; border-top: 1px solid var(--line); }
`;

/** The whole page for one check, as HTML. */
export function page(check) {
  const ideas = check.ideas
    .map(
      (i) => `<li>
<h3>${esc(i.name)}</h3>
<p>${esc(i.plain)}</p>
<p class="here">In this code: ${esc(i.here)}</p>
${i.snippet ? `<figure><pre>${esc(i.snippet)}</pre><figcaption>${esc(i.file)}</figcaption></figure>` : ""}
${i.source ? `<p class="source">${kind(i.source.url)}: <a href="${esc(i.source.url)}">${esc(i.source.title)}</a>${i.source.by ? `, ${esc(i.source.by)}` : ""}${i.source.year ? ` (${i.source.year})` : ""}</p>` : ""}
<p class="ask">${esc(i.question)}</p>
</li>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>What just changed in ${esc(check.project)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<p class="eyebrow">${esc(check.project)} · ${esc(check.when.slice(0, 10))}</p>
<h1>What just changed</h1>
<p>${esc(check.summary)}</p>
<h2>The ideas behind it</h2>
<ol>
${ideas}
</ol>
<footer>Try each question out loud before you move on. To be asked them, say "quiz me on this" to Claude: it keeps track of which ideas you can explain.</footer>
</main>
</body>
</html>
`;
}
