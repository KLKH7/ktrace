// Goes inside a confirmed source and brings back one diagram from it, so the page can show the
// idea as its source draws it. The picture is returned as a data: address and embedded, which
// keeps the page one file. Nothing is returned unless the source itself serves a real image.
import { PRIVATE, overlap } from "./verify.mjs";

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(1).find((v) => v != null)?.replace(/&amp;/g, "&") ?? "";
const plain = (html) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
const CHROME = /logo|icon|avatar|badge|sprite|favicon|emoji|button|banner|spinner|pixel|gravatar|shield/i;
const TYPES = /^image\/(png|jpeg|gif|webp|svg\+xml)/;

/**
 * Every picture in a page that could be a diagram, in page order: `{ url, text, inFigure }`.
 * `text` is whatever the page says about the picture (its caption and alt text, or failing those its file name).
 */
export function candidates(html, base) {
  const found = new Map();
  const add = (tag, caption, inFigure) => {
    const raw = attr(tag, "src") || attr(tag, "data-src");
    if (!raw || raw.startsWith("data:")) return;
    let url;
    try {
      url = new URL(raw, base);
    } catch {
      return;
    }
    const [w, h] = [Number(attr(tag, "width")), Number(attr(tag, "height"))];
    if (url.protocol !== "https:" || PRIVATE.test(url.hostname) || (w && w < 120) || (h && h < 80)) return;
    const name = decodeURIComponent(url.pathname.split("/").pop() ?? "").replace(/\.\w+$/, "").replace(/[-_]+/g, " ");
    const said = [caption, attr(tag, "alt"), attr(tag, "title")].filter((t) => t && !/^refer to caption$/i.test(t));
    const text = (said.length ? said.join(" ") : name).trim();
    if (CHROME.test(url.pathname) || CHROME.test(attr(tag, "class"))) return;
    if (!found.has(url.href)) found.set(url.href, { url: url.href, text, inFigure });
  };
  for (const [block] of html.matchAll(/<figure\b[\s\S]*?<\/figure>/gi)) {
    const caption = plain(block.match(/<figcaption\b[\s\S]*?<\/figcaption>/i)?.[0] ?? "");
    for (const [tag] of block.matchAll(/<img\b[^>]*>/gi)) add(tag, caption, true);
  }
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) add(tag, "", false);
  return [...found.values()];
}

/**
 * Chooses the picture that best shows the idea, or null when none is worth showing.
 * `wanted` is a few words: the diagram the agent asked for and the idea's name.
 */
export function pick(found, wanted) {
  // A picture earns its place by what the page says about it: the share of the wanted words in
  // its caption, with a little extra for a real captioned figure. Below a third, a wrong
  // picture is more likely than a right one, and none is better. Ties go to the earliest.
  let best = null;
  for (const c of found) {
    const match = overlap(wanted, c.text);
    const score = match + (c.inFigure ? 0.1 : 0);
    if (match >= 1 / 3 && (!best || score > best.score)) best = { ...c, score };
  }
  return best;
}

/** Where to look for pictures: the page itself, or for arXiv the paper's HTML edition. */
const reading = (url) => {
  const arxiv = url.match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/)?.[1];
  return arxiv ? `https://arxiv.org/html/${arxiv}` : url;
};

/**
 * One diagram from inside a source: `{ src, caption, from }`, or null. `url` must already be
 * confirmed by verify(). `get` is fetch, passed in so tests need no network.
 */
export async function figure({ url, wanted }, get = fetch) {
  const opts = () => ({ signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "reading-list-checker" } });
  try {
    let chosen;
    const video = url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/)?.[1];
    if (/youtube\.com|youtu\.be/.test(url)) {
      if (!video) return null;
      chosen = { url: `https://i.ytimg.com/vi/${video}/hqdefault.jpg`, text: "" };
    } else {
      const r = await get(reading(url), opts());
      if (!r.ok) return null;
      chosen = pick(candidates((await r.text()).slice(0, 2_000_000), r.url || reading(url)), wanted);
    }
    if (!chosen) return null;
    const r = await get(chosen.url, opts());
    const type = r.headers.get("content-type")?.match(TYPES)?.[0];
    if (!r.ok || !type) return null;
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length < 2_000 || bytes.length > 1_500_000) return null;
    return { src: `data:${type};base64,${bytes.toString("base64")}`, caption: chosen.text.slice(0, 240), from: chosen.url };
  } catch {
    return null;
  }
}
