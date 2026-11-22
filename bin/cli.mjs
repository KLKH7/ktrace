#!/usr/bin/env node
// ktrace <command>   (run as: npx -y github:KLKH7/ktrace <command>)
//   install     add the server and the hook to Claude Code, for every project
//   uninstall   take both out again
//   map         print what you can explain today, and what to read next
//   serve       run the MCP server (this is what Claude Code starts)
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { trace } from "../src/model.mjs";
import { home, lines, reading } from "../src/store.mjs";

const SOURCE = "github:KLKH7/ktrace";
const command = process.argv[2] ?? "help";
const claude = (...args) => spawnSync("claude", args, { stdio: "inherit" }).status ?? 1;

/**
 * Puts the Stop hook into Claude Code's settings for every project, or takes it out. The hook
 * is copied into the ktrace folder first, so it keeps working whatever happens to this copy.
 * The settings file is backed up beside itself, and everything else in it is left as it is.
 */
function hook(add) {
  const settings = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "settings.json");
  const script = join(home(), "hook.mjs");
  const json = existsSync(settings) ? JSON.parse(readFileSync(settings, "utf8")) : {};
  const stop = (json.hooks?.Stop ?? []).filter((group) => !group.hooks?.some((h) => h.command?.includes(script)));
  if (add) {
    mkdirSync(home(), { recursive: true });
    copyFileSync(new URL("../src/hook.mjs", import.meta.url), script);
    // node by its full path, because the desktop app does not run hooks with a shell's PATH; the
    // link found on PATH rather than the versioned file it points to, so upgrades don't break it
    const node = (process.env.PATH ?? "").split(":").map((d) => join(d, "node")).find((f) => existsSync(f)) ?? process.execPath;
    stop.push({ hooks: [{ type: "command", command: `"${node}" "${script}"`, timeout: 20 }] });
  } else rmSync(script, { force: true });
  json.hooks = { ...json.hooks, Stop: stop };
  if (!stop.length) delete json.hooks.Stop;
  if (!Object.keys(json.hooks).length) delete json.hooks;
  if (existsSync(settings)) copyFileSync(settings, `${settings}.before-ktrace`);
  else mkdirSync(join(settings, ".."), { recursive: true });
  writeFileSync(settings, JSON.stringify(json, null, 2) + "\n");
}

if (command === "serve") {
  const { serve } = await import("../src/server.mjs");
  await serve();
} else if (command === "install") {
  const status = claude("mcp", "add", "--scope", "user", "ktrace", "--", "npx", "-y", SOURCE, "serve");
  if (status !== 0) {
    console.error("\nThat needs Claude Code's `claude` command on your PATH: https://claude.com/claude-code");
    process.exit(status);
  }
  hook(true);
  console.log("\nDone. Start a new Claude Code session and build something. Once Claude has written about forty lines, a page opens with the ideas behind them.\nPause it with `touch ~/.ktrace/off`; run `map` to see what it has kept.");
} else if (command === "uninstall") {
  hook(false);
  process.exit(claude("mcp", "remove", "--scope", "user", "ktrace"));
} else if (command === "map") {
  const skills = trace(lines("answers.jsonl"), new Date());
  const unread = reading().filter((r) => !r.done);
  if (!skills.length && !unread.length) {
    console.log(`Nothing yet. It fills in as you build with Claude Code. (Kept in ${home()})`);
  } else {
    if (skills.length) console.log("What you can explain today, weakest first\n");
    for (const s of skills) {
      const filled = Math.round(s.known * 20);
      console.log(`  ${"█".repeat(filled)}${"░".repeat(20 - filled)} ${String(Math.round(s.known * 100)).padStart(3)}%  ${s.skill}`);
    }
    if (unread.length) console.log(`${skills.length ? "\n" : ""}Read next\n`);
    for (const r of unread) console.log(`  ${r.title} (${r.minutes} min)\n    ${r.why}\n    ${r.url}`);
  }
} else {
  console.log("ktrace: understand what your coding agent builds for you.\n\n  install     add it to Claude Code (the server, and the hook that opens a page after a change)\n  uninstall   remove it\n  map         what you can explain today, and what to read next\n  serve       run the MCP server");
}
