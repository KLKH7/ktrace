// Serves the notebook on this machine only, so that a click on "I'm lost here" can be written
// down for the agent to pick up. It listens on 127.0.0.1, answers nothing but the notebook and
// two kinds of click (lost here, and how a review question went), and a click carries no words: only which check, which idea and which level,
// each looked up in the saved files. A page elsewhere on the web therefore cannot put text in
// front of the agent through it, and the token in the notebook keeps other pages from clicking.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { canon } from "./model.mjs";
import { notebook } from "./notebook.mjs";
import { append, home, lines } from "./store.mjs";

export const PORT = Number(process.env.KTRACE_PORT ?? 47815);

/** The secret the notebook sends back with a click, made once and kept in the ktrace folder. */
export function token() {
  const file = join(home(), "token");
  if (!existsSync(file)) {
    mkdirSync(home(), { recursive: true });
    writeFileSync(file, randomBytes(16).toString("hex"), { mode: 0o600 });
  }
  return readFileSync(file, "utf8").trim();
}

/** What a click points at, in words taken from the saved check: or null if it points at nothing. */
export function place({ check, idea, level }) {
  if (!/^c_[a-z0-9_]+$/.test(String(check)) || !Number.isInteger(idea) || !Number.isInteger(level)) return null;
  const file = join(home(), "checks", `${check}.json`);
  if (!existsSync(file)) return null;
  const saved = JSON.parse(readFileSync(file, "utf8"));
  const it = saved.ideas?.[idea];
  const at = level === 0 ? it : it?.deeper?.[level - 1];
  if (!at) return null;
  return { check, idea, level, project: saved.project, topic: saved.topic ?? saved.ideas[0].name, name: it.name, at: at.name };
}

/**
 * The notebook as it stands now, built from every saved check and every answer. It is built
 * afresh each time it is asked for, so what is due today is right on the day it is read.
 * `latest` is the entry to open on; without one, the most recent.
 */
export function build(latest) {
  const folder = join(home(), "checks");
  const all = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(folder, f), "utf8"))) : [];
  const newest = all.filter((c) => c.ideas?.length).sort((a, b) => a.when.localeCompare(b.when)).at(-1)?.id;
  return notebook(all, latest ?? newest, token(), lines("answers.jsonl"), new Date());
}

const VERDICTS = ["explained", "partial", "missed"];

function answer(req, res) {
  const local = /^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? ""); // a name that merely resolves here is refused
  const send = (status, body = "", type = "text/plain") => res.writeHead(status, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" }).end(body);
  if (!local) return send(403);
  if (req.method === "GET" && req.url === "/ping") return send(200, "ktrace");
  if (req.method === "GET" && req.url.split(/[?#]/)[0] === "/") {
    return send(200, build(), "text/html");
  }
  if (req.method === "POST" && req.url === "/stuck") {
    let body = "";
    req.on("data", (chunk) => (body.length < 2_000 ? (body += chunk) : req.destroy()));
    req.on("end", () => {
      try {
        const click = JSON.parse(body);
        const where = click.token === token() ? place(click) : null;
        if (!where) return send(403);
        append("stuck.jsonl", { when: new Date().toISOString(), ...where });
        send(204);
      } catch {
        send(400);
      }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/answer") {
    let body = "";
    req.on("data", (chunk) => (body.length < 2_000 ? (body += chunk) : req.destroy()));
    req.on("end", () => {
      try {
        const click = JSON.parse(body);
        const where = click.token === token() && VERDICTS.includes(click.verdict) ? place({ ...click, level: 0 }) : null;
        if (!where) return send(403);
        append("answers.jsonl", { when: new Date().toISOString(), skill: canon(where.name), verdict: click.verdict, track: "review", conversation: `review_${where.check}` });
        send(204);
      } catch {
        send(400);
      }
    });
    return;
  }
  send(404);
}

/** Starts listening; resolves to the server, or null when the port is taken. */
export const listen = (port = PORT) =>
  new Promise((done) => {
    const server = createServer(answer);
    server.once("error", () => done(null));
    server.listen(port, "127.0.0.1", () => done(server.unref()));
  });

let mine = null;

/**
 * The address the notebook can be opened at, or null if it cannot be served. Any running ktrace
 * may be the one serving, since they all read the same folder; this one takes over when none is.
 */
export async function address() {
  mine ??= await listen();
  if (mine) return `http://127.0.0.1:${mine.address().port}/`;
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/ping`, { signal: AbortSignal.timeout(1_000) });
    return (await r.text()) === "ktrace" ? `http://127.0.0.1:${PORT}/` : null;
  } catch {
    return null;
  }
}
