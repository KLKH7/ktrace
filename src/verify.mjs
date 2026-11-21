// Checks that a resource an AI suggested really exists before it reaches the student. Language
// models invent plausible papers and links; nothing goes on the reading list unless the source
// itself confirms it. Returns the title, authors and year as the source gives them.
const words = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 2));

/** How much of the claimed title's wording appears in the real one, from 0 to 1. */
export function overlap(claimed, real) {
  const a = words(claimed);
  const b = words(real);
  if (!a.size) return 0;
  return [...a].filter((w) => b.has(w)).length / a.size;
}

const text = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1].replace(/\s+/g, " ").trim());
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.(local|internal)$)/i;
const no = (reason) => ({ ok: false, reason });

/**
 * Confirms one resource. `url` may be an arXiv address or id, a YouTube link, or any public https page.
 * `get` is fetch, passed in so tests need no network.
 */
export async function verify({ title, url }, get = fetch) {
  const arxiv = url.match(/(?:arxiv\.org\/(?:abs|pdf)\/|^arxiv:|^)(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/i)?.[1];
  const opts = { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "reading-list-checker" } };
  try {
    if (arxiv) {
      const r = await get(`https://export.arxiv.org/api/query?id_list=${arxiv}`, opts);
      if (!r.ok) return no(`arXiv answered ${r.status}`);
      const entry = (await r.text()).split("<entry>")[1];
      const real = entry ? text(entry, "title")[0] : null;
      if (!real || real === "Error") return no(`there is no arXiv paper ${arxiv}`);
      if (overlap(title, real) < 0.5) return no(`arXiv ${arxiv} is a different paper: "${real}"`);
      return { ok: true, title: real, authors: text(entry, "name").slice(0, 4), year: Number(text(entry, "published")[0]?.slice(0, 4)) || null, url: `https://arxiv.org/abs/${arxiv}` };
    }
    let u;
    try {
      u = new URL(url);
    } catch {
      return no("that is not a web address or an arXiv id");
    }
    if (u.protocol !== "https:" || PRIVATE.test(u.hostname)) return no("only public https addresses are accepted");
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname)) {
      const r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u.href)}`, opts);
      if (!r.ok) return no("YouTube has no video at that address");
      const v = await r.json();
      if (overlap(title, v.title) < 0.4) return no(`that video is "${v.title}" by ${v.author_name}, not what was claimed`);
      return { ok: true, title: v.title, authors: [v.author_name], year: null, url: u.href };
    }
    const r = await get(u.href, opts);
    if (!r.ok) return no(`the page answered ${r.status}`);
    const real = text((await r.text()).slice(0, 200_000), "title")[0];
    if (!real) return no("the page has no title to check against");
    if (overlap(title, real) < 0.4) return no(`the page is titled "${real.slice(0, 120)}", not what was claimed`);
    return { ok: true, title: title.trim(), authors: [], year: null, url: u.href };
  } catch (e) {
    return no(`it could not be reached (${e.name})`);
  }
}
