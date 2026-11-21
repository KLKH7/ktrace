#!/usr/bin/env node
// ktrace <command>   (run as: npx -y github:KLKH7/ktrace <command>)
//   install     add the server to Claude Code, for every project
//   uninstall   take it out again
//   map         print what you can explain today, and what to read next
//   serve       run the MCP server (this is what Claude Code starts)
import { spawnSync } from "node:child_process";
import { trace } from "../src/model.mjs";
import { home, lines, reading } from "../src/store.mjs";

const SOURCE = "github:KLKH7/ktrace";
const command = process.argv[2] ?? "help";
const claude = (...args) => spawnSync("claude", args, { stdio: "inherit" }).status ?? 1;

if (command === "serve") {
  const { serve } = await import("../src/server.mjs");
  await serve();
} else if (command === "install") {
  const status = claude("mcp", "add", "--scope", "user", "ktrace", "--", "npx", "-y", SOURCE, "serve");
  if (status === 0) console.log("\nDone. Start a new Claude Code session and build something; later, run `map` to see what it has kept.");
  else console.error("\nThat needs Claude Code's `claude` command on your PATH: https://claude.com/claude-code");
  process.exit(status);
} else if (command === "uninstall") {
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
  console.log("ktrace: understand what your coding agent builds for you.\n\n  install     add it to Claude Code\n  uninstall   remove it\n  map         what you can explain today, and what to read next\n  serve       run the MCP server");
}
