// The MCP server: five tools that let a coding agent keep the user's understanding up with the
// build, without slowing it. Everything is kept on this machine (see home() in store.mjs); the
// only network use is checking a suggested source at arXiv, YouTube or its own page.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { canon, trace } from "./model.mjs";
import { page } from "./page.mjs";
import { append, home, lines, reading, saveReading } from "./store.mjs";
import { verify } from "./verify.mjs";

const cwd = process.cwd();
const PER_DAY = 2; // suggestions kept per project per day: a short list gets read, a long one does not
const text = (t) => ({ content: [{ type: "text", text: t }] });
const percent = (p) => `${Math.round(p * 100)}%`;

/** Concepts the agent has noted that the student has never been asked about, newest first, one per name. */
function unasked(answers) {
  const asked = new Set(answers.map((a) => canon(a.skill)));
  const seen = new Set();
  return lines("concepts.jsonl").reverse().filter((c) => !asked.has(canon(c.name)) && !seen.has(canon(c.name)) && seen.add(canon(c.name)));
}

const server = new McpServer(
  { name: "ktrace", version: "0.1.0" },
  {
    instructions:
      "This server helps the user understand what you build for them, without slowing the build. " +
      "1) Whenever you use an idea the user may not know (an algorithm, a pattern, a protocol, a piece of maths, a library's key mechanism), call note_concept. Do it silently: do not mention it and do not stop work. " +
      "2) Before you explain something, or when deciding how much detail to give, call what_i_know and pitch the explanation to it: skip what they hold, slow down on what is weak. " +
      "3) When you finish a substantial piece of work, think about what lies ONE STEP BEYOND it: the paper, talk or post that the work is a small instance of, or that would change how the user builds the next thing. Call suggest_next for at most one or two. Aim at the level the user is working at (if they are building multi-agent systems, suggest research on agents, not introductory linear algebra); suggest a prerequisite only when what_i_know shows a real gap. Prefer primary sources and give an arXiv id whenever one exists. Only suggest what you are confident exists; the server checks every one against its source and refuses the rest. Then end your message with one line per accepted suggestion: its title, how long it takes, and why now. " +
      "4) If you ask the user to explain something in the chat and they answer, call record_answer with an honest verdict. Never record an answer they did not give. " +
      "5) When a message from ktrace asks you to explain a change before stopping, call explain_change once, then stop. You may also call it unasked when the user asks what you built or why. " +
      "Never interrupt the work to teach, and never quiz the user in the middle of a task unless they ask.",
  },
);

server.registerTool(
  "note_concept",
  {
    description: "Quietly log one non-obvious idea you just used in the user's project, so they can be asked about it later. Call it as you work; say nothing about it to the user.",
    inputSchema: {
      name: z.string().min(2).max(80).describe("The idea's standard name in two to five lower-case words, as a textbook would index it, e.g. 'debouncing', 'bayesian knowledge tracing', 'idempotent requests'."),
      why: z.string().max(300).describe("One sentence: what it does for this project."),
      where: z.string().max(200).optional().describe("File and function where it is used, e.g. 'learner/model.ts update()'."),
    },
  },
  async ({ name, why, where }) => {
    append("concepts.jsonl", { when: new Date().toISOString(), name: canon(name), why, where: where ?? null, project: basename(cwd), cwd });
    return text("Noted. Carry on; do not mention this to the user.");
  },
);

server.registerTool(
  "what_i_know",
  {
    description: "What the user can and cannot explain today, from every spoken session and check so far: each skill with the estimated chance they could explain it now, plus ideas used in their projects that they have never been asked about. Read it before explaining something, to pitch it right.",
    inputSchema: { topic: z.string().max(80).optional().describe("Only skills and ideas whose name contains this word.") },
  },
  async ({ topic }) => {
    const answers = lines("answers.jsonl");
    const has = (name) => !topic || canon(name).includes(canon(topic));
    const skills = trace(answers, new Date()).filter((s) => has(s.skill));
    const open = unasked(answers).filter((c) => has(c.name)).slice(0, 15);
    const unread = reading().filter((r) => !r.done && has(r.title)).slice(0, 8).map((r) => `- ${r.title} (${r.kind}, ${r.minutes} min)`);
    if (!skills.length && !open.length && !unread.length) return text(topic ? `Nothing recorded about "${topic}" yet. Assume no prior knowledge of it has been shown.` : "Nothing recorded yet. Assume nothing; explain plainly.");
    const rows = skills.map((s) => `- ${s.skill}: ${percent(s.known)} (${s.answers} answers, last ${s.last.slice(0, 10)})`);
    const ideas = open.map((c) => `- ${c.name}${c.where ? ` (${c.where})` : ""}: ${c.why}`);
    return text(
      [
        skills.length ? `Skills, weakest first (estimated chance they can explain it today):\n${rows.join("\n")}` : "No skills tested yet.",
        open.length ? `Used in their projects but never asked about:\n${ideas.join("\n")}` : "",
        unread.length ? `Already on their reading list, unread (do not suggest again):\n${unread.join("\n")}` : "",
      ].filter(Boolean).join("\n\n"),
    );
  },
);

server.registerTool(
  "record_answer",
  {
    description: "Keep the result of a question you asked the user in the chat and they answered. Be honest: 'explained' only if it was correct and complete without help.",
    inputSchema: {
      skill: z.string().min(2).max(80).describe("The idea's standard name, two to five lower-case words. Reuse a name from what_i_know when it is the same idea."),
      verdict: z.enum(["explained", "partial", "missed"]),
    },
  },
  async ({ skill, verdict }) => {
    append("answers.jsonl", { when: new Date().toISOString(), skill: canon(skill), verdict, track: "chat", conversation: `chat_${Date.now().toString(36)}` });
    const now = trace(lines("answers.jsonl"), new Date()).find((s) => s.skill === canon(skill));
    return text(`Recorded. Estimated chance they can explain "${canon(skill)}" today: ${now ? percent(now.known) : "unknown"}.`);
  },
);

server.registerTool(
  "suggest_next",
  {
    description: "Propose one resource that lies just beyond what you built with the user: the paper, talk or post most worth their time now. It is checked against its source (arXiv, YouTube or the page itself) and refused if it does not exist or is something else. At most two per finished piece of work.",
    inputSchema: {
      title: z.string().min(4).max(200).describe("The exact title of the paper, video or post."),
      url: z.string().min(4).max(400).describe("An arXiv id or address (preferred, e.g. 'arxiv:1706.03762'), a YouTube link, or a public https page."),
      kind: z.enum(["paper", "video", "post", "code"]),
      why_now: z.string().min(10).max(110).describe("Twelve words at most, tying it to what was just built, e.g. 'The neural version of the model you just wrote.'"),
      focus: z.string().max(200).optional().describe("The part worth their time, e.g. 'Sections 3 and 4; skip the experiments' or 'from 12:00 to 31:00'."),
      minutes: z.number().int().min(3).max(240).describe("An honest estimate of the time for the part named in focus."),
    },
  },
  async ({ title, url, kind, why_now, focus, minutes }) => {
    const list = reading();
    const today = new Date().toISOString().slice(0, 10);
    if (list.filter((r) => r.cwd === cwd && r.when.startsWith(today)).length >= PER_DAY) return text(`Not added: this project already has ${PER_DAY} suggestions today. A short list gets read.`);
    const checked = await verify({ title, url });
    if (!checked.ok) return text(`Refused: ${checked.reason}. Do not mention this resource to the user. Suggest something else only if you are sure it exists.`);
    if (list.some((r) => r.url === checked.url)) return text("Already on their list. Do not suggest it again.");
    const item = { id: `r_${Date.now().toString(36)}`, when: new Date().toISOString(), project: basename(cwd), cwd, kind, title: checked.title, by: checked.authors.join(", "), year: checked.year, url: checked.url, why: why_now, focus: focus ?? null, minutes, done: false };
    saveReading([item, ...list]);
    return text(`Added, confirmed at its source: "${item.title}"${item.by ? ` (${item.by}${item.year ? `, ${item.year}` : ""})` : ""}. Tell the user in one line: the title, ${minutes} minutes, and why now.`);
  },
);

const squash = (s) => s.replace(/\s+/g, " ").trim();

/** Opens a file in the user's browser, on any system. */
function show(path) {
  if (process.env.KTRACE_NO_OPEN) return;
  const [command, ...args] = process.platform === "darwin" ? ["open", path] : process.platform === "win32" ? ["cmd", "/c", "start", "", path] : ["xdg-open", path];
  spawn(command, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
}

server.registerTool(
  "explain_change",
  {
    description:
      "Open a page that teaches the user the ideas behind code you just wrote for them. They did not write it and may not know the ideas in it. " +
      "Write for a bright second-year university student: simple words, short sentences, no unexplained jargon, no praise, no waste. " +
      "Each source is checked where it claims to live and dropped if it does not match; each snippet is checked against the file and dropped if it is not there.",
    inputSchema: {
      check: z.string().max(40).optional().describe("The check id, when a ktrace message gave you one."),
      summary: z.string().min(20).max(500).describe("Two sentences. What did this change create that didn't exist before? Why was it necessary? Don't list files."),
      ideas: z
        .array(
          z.object({
            name: z.string().min(2).max(80).describe("What this idea is usually called, in a few words."),
            plain: z.string().min(40).max(900).describe("Three or four sentences explaining the idea itself. Explain it from nothing and give one concrete example (real life or numerical). Do not talk about the code here."),
            here: z.string().min(10).max(400).describe("One or two sentences explaining what this idea is used for in this code."),
            file: z.string().max(200).optional().describe("The file where this idea is most visible, relative to the project."),
            snippet: z.string().max(1200).optional().describe("Up to ten consecutive lines from that file, copied exactly."),
            question: z.string().min(10).max(300).describe("A question that can only be answered by someone who understands the idea, and cannot be answered by someone who has only memorised the code. Answerable out loud in less than a minute."),
            source: z
              .object({ title: z.string().max(200).describe("The title exactly as the source displays it."), url: z.string().max(400).describe("An arxiv.org/abs address, a YouTube link, or the canonical documentation page.") })
              .optional()
              .describe("The single best source for understanding this idea: the original paper, a widely known explainer video or lecture, or the canonical documentation page. Only name one you are sure exists at that address; leave it out if unsure."),
          }),
        )
        .min(1)
        .max(3)
        .describe("The two or three ideas that need to be understood to really understand this change. Things that exist outside this code (an algorithm, a statistical method, a protocol, a pattern, a piece of maths), not a description of a file. Most important first."),
    },
  },
  async ({ check, summary, ideas }) => {
    const folder = join(home(), "checks");
    mkdirSync(folder, { recursive: true });
    const id = check && /^c_[a-z0-9]+$/.test(check) ? check : `c_${Date.now().toString(36)}`;
    const saved = existsSync(join(folder, `${id}.json`)) ? JSON.parse(readFileSync(join(folder, `${id}.json`), "utf8")) : { id, when: new Date().toISOString(), project: basename(cwd), cwd };
    const dropped = [];
    const kept = await Promise.all(
      ideas.map(async ({ source, file, snippet, ...idea }) => {
        const out = { ...idea };
        const path = file ? resolve(cwd, file) : null;
        if (snippet && path?.startsWith(cwd) && existsSync(path) && squash(readFileSync(path, "utf8")).includes(squash(snippet))) Object.assign(out, { file, snippet });
        else if (snippet) dropped.push(`the snippet for "${idea.name}" (not found in ${file ?? "any file"})`);
        const checked = source ? await verify(source) : null;
        if (checked?.ok) out.source = { title: checked.title, url: checked.url, by: checked.authors.slice(0, 2).join(", "), year: checked.year };
        else if (source) dropped.push(`the source for "${idea.name}" (${checked.reason})`);
        return out;
      }),
    );
    const done = { ...saved, summary, ideas: kept };
    writeFileSync(join(folder, `${id}.json`), JSON.stringify(done, null, 2));
    writeFileSync(join(folder, `${id}.html`), page(done));
    for (const idea of kept) append("concepts.jsonl", { when: new Date().toISOString(), name: canon(idea.name), why: idea.here, where: idea.file ?? null, project: basename(cwd), cwd });
    show(join(folder, `${id}.html`));
    return text(`The page is open in their browser (${join(folder, `${id}.html`)}).${dropped.length ? ` Left out because they did not check out: ${dropped.join("; ")}.` : ""} Tell the user in one short line that the ideas behind this change are open in their browser. Do not repeat the explanation.`);
  },
);

export const serve = () => server.connect(new StdioServerTransport());
