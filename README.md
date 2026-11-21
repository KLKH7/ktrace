# ktrace

Knowledge tracing for people who build with coding agents. A small server for [Claude Code](https://claude.com/claude-code) that keeps your
understanding up with the build.

When an agent writes your code, the project moves forward and you don't. This gives the agent
four tools so that changes, without slowing the work:

| Tool | What the agent does with it |
|---|---|
| `note_concept` | Quietly logs each non-obvious idea it uses in your project, and where. |
| `what_i_know` | Reads what you can and can't explain today, so it pitches explanations to you. |
| `record_answer` | When it asks you something in the chat and you answer, it keeps the result. |
| `suggest_next` | Proposes the one paper, talk or post just beyond what you built. |

Two things make it more than a notes file:

- **It models what you know.** Each answer updates a probability that you could explain that
  idea today (Bayesian knowledge tracing), and the probability fades with time on a forgetting
  curve. It is about a hundred lines, in [`src/model.mjs`](src/model.mjs), with the reasoning in
  comments.
- **It checks what it suggests.** Language models invent plausible papers. Every suggestion is
  looked up at its source (arXiv, YouTube, or the page itself) and refused if it does not exist
  or is a different work. See [`src/verify.mjs`](src/verify.mjs).

## Install

Needs Node 20 or later and Claude Code.

```bash
npx -y github:KLKH7/ktrace install
```

Start a new Claude Code session and build something. Later:

```bash
npx -y github:KLKH7/ktrace map
```

```text
What you can explain today, weakest first

  ██░░░░░░░░░░░░░░░░░░   9%  debouncing
  █████████████░░░░░░░  67%  bayesian knowledge tracing

Read next

  Deep Knowledge Tracing (25 min)
    The neural version of the learner model you just built.
    https://arxiv.org/abs/1506.05908
```

To remove it: `npx -y github:KLKH7/ktrace uninstall`.

## What it keeps, and where

Plain files in `~/.ktrace` on your machine: your answers, the ideas the agent
noted, and the reading list. Nothing is uploaded. The only network use is checking a suggested
source at arXiv, YouTube or its own page. There is no account and no telemetry.

## Honest limits

- The model's four numbers are sensible defaults. It can fit them from data, but refuses to
  until there are 200 answers.
- Ideas are matched by name, so "WACC" and "cost of capital" count as two.
- Whether the agent calls the tools is up to the agent. The server tells it when to, and never
  to interrupt work to teach.
- At most two reading suggestions per project per day. A short list gets read.

## Related work

The idea of resisting "it works but I can't explain it" is not new, and these are worth a look:
[learn-codebase](https://github.com/ktaletsk/learn-codebase) (a Socratic skill that makes you
predict before it reveals), [srs-mcp](https://github.com/klutometis/srs-mcp) (flashcard
scheduling as tools), and [pyBKT](https://github.com/CAHLR/pyBKT) (the reference library for
knowledge tracing). This project differs in running in the background as you build, in modelling
explanation rather than recall, and in checking sources.

## Use the model in your own code

```js
import { trace } from "ktrace-mcp/model";
trace([{ when: "2026-11-20T10:00:00Z", skill: "debouncing", verdict: "missed" }], new Date());
```

## Develop

```bash
npm install
npm test
```

MIT licence.
