#!/usr/bin/env node
// Claude Code "Stop" hook. When Claude finishes a turn, this adds up what it has written in the
// session since the last check. Once that is enough to be worth understanding, it asks Claude
// to do one more thing before stopping: explain the change through the explain_change tool,
// which opens a page of the ideas behind it. Claude writes the explanation itself, in the
// session it already has, so nothing else has to be signed in or paid for.
//
// This file uses only Node's own modules, because `install` copies it to ~/.ktrace/hook.mjs.
//   pause: touch ~/.ktrace/off      tune: KTRACE_MIN_LINES (40), KTRACE_COOLDOWN_MIN (20)
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = process.env.KTRACE_HOME ?? join(homedir(), ".ktrace");
const MIN_LINES = Number(process.env.KTRACE_MIN_LINES ?? 40);
const COOLDOWN_MS = Number(process.env.KTRACE_COOLDOWN_MIN ?? 20) * 60_000;
const FIRST_READ = 20 * 1024 * 1024; // a session seen for the first time: only its last 20 MB
const SKIP = /(^|\/)(\.env[^/]*|[^/]*\.(pem|key|p12|lock)|id_rsa[^/]*|package-lock\.json)$|secret|credential|\/node_modules\/|\/\.claude\/|\/\.ktrace\/|\/tmp\/|(^|\/)private\//i;

/** Text an edit added, by tool. */
function added(name, input) {
  if (name === "Write") return input.content ?? "";
  if (name === "Edit") return input.new_string ?? "";
  if (name === "MultiEdit") return (input.edits ?? []).map((e) => e.new_string ?? "").join("\n");
  if (name === "NotebookEdit") return input.new_source ?? "";
  return null;
}

/** Files written from the shell with a heredoc (cat > path <<'EOF' … EOF), which Claude often does. */
function heredocs(command, cwd) {
  const cd = command.match(/^\s*cd\s+("[^"]+"|\S+)\s*&&/)?.[1]?.replace(/"/g, "").replace(/^~/, homedir());
  const base = cd ? resolve(cwd, cd) : cwd;
  const out = [];
  for (const m of command.matchAll(/cat\s*>{1,2}\s*("[^"]+"|[^\s<]+)\s*<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\2\b/g)) {
    const path = m[1].replace(/"/g, "").replace(/^~/, homedir());
    if (!path.includes("$")) out.push({ path: resolve(base, path), lines: count(m[3]) });
  }
  return out;
}

const count = (text) => text.split("\n").filter((l) => l.trim()).length;

/** The files Claude wrote, with the lines it added to each, from one stretch of a session transcript. */
export function collect(text) {
  const files = new Map();
  for (const line of text.split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue; // a partial first or last line
    }
    const content = j.message?.content;
    if (j.isSidechain || j.type !== "assistant" || !Array.isArray(content)) continue;
    for (const c of content) {
      if (c.type !== "tool_use") continue;
      const text = added(c.name, c.input ?? {});
      const path = c.input?.file_path ?? c.input?.notebook_path;
      const writes = c.name === "Bash" ? heredocs(c.input?.command ?? "", j.cwd ?? "/") : text === null || !path ? [] : [{ path, lines: count(text) }];
      for (const w of writes) if (!SKIP.test(w.path)) files.set(w.path, (files.get(w.path) ?? 0) + w.lines);
    }
  }
  return [...files].map(([path, lines]) => ({ path, lines })).sort((a, b) => b.lines - a.lines);
}

function readFrom(path, start, end) {
  const buf = Buffer.alloc(end - start);
  const fd = openSync(path, "r");
  readSync(fd, buf, 0, buf.length, start);
  closeSync(fd);
  return buf.toString("utf8");
}

/** What to print for Claude Code: nothing, or the request that keeps Claude going for one more step. */
export function decide(input, now = Date.now()) {
  const { session_id: session, transcript_path: transcript, cwd = process.cwd() } = input;
  // stop_hook_active: Claude is already finishing the step this hook asked for
  if (!session || !transcript || input.stop_hook_active || !existsSync(transcript) || existsSync(join(HOME, "off")) || process.env.KTRACE_OFF) return null;
  mkdirSync(join(HOME, "checks"), { recursive: true });
  const statePath = join(HOME, "state.json");
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { sessions: {}, lastAsked: 0 };
  const size = statSync(transcript).size;
  const from = Math.min(state.sessions[session] ?? Math.max(0, size - FIRST_READ), size);
  const files = collect(readFrom(transcript, from, size));
  const lines = files.reduce((n, f) => n + f.lines, 0);
  // not enough yet, or asked too recently: leave the mark where it is so the work accumulates
  if (lines < MIN_LINES || now - state.lastAsked < COOLDOWN_MS) return null;

  const id = `c_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const shown = files.slice(0, 12).map((f) => ({ path: f.path.startsWith(cwd + "/") ? relative(cwd, f.path) : f.path.replace(homedir(), "~"), lines: f.lines }));
  writeFileSync(join(HOME, "checks", `${id}.json`), JSON.stringify({ id, when: new Date(now).toISOString(), project: basename(cwd), cwd, lines, files: shown }, null, 2));
  writeFileSync(statePath, JSON.stringify({ sessions: { ...state.sessions, [session]: size }, lastAsked: now }));
  return {
    decision: "block",
    reason:
      `ktrace: you have written ${lines} lines here (${shown.slice(0, 4).map((f) => f.path).join(", ")}) and the user has not been shown the ideas behind them. ` +
      `Before you stop, call the ktrace tool explain_change once, with check "${id}". It opens a page for them. ` +
      "Then end with one short line telling them the page is open, and stop. Do not repeat the explanation in the chat. If you do not have that tool, just stop.",
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const out = decide(JSON.parse(readFileSync(0, "utf8") || "{}"));
    if (out) console.log(JSON.stringify(out));
  } catch {
    /* a hook must never get in Claude's way */
  }
}
