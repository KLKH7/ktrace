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

## How it compares

The model was benchmarked against [pyBKT](https://github.com/CAHLR/pyBKT), the reference library
for this kind of model, on the public ASSISTments 2009-2010 dataset (325,637 answers after
removing 121,207 repeated rows). Every model predicted the same 66,547 answers from 846 students
it had never seen: before each answer, the chance the student gets it right.

| Model | Correct calls | AUC (95% interval) | Log loss |
|---|---|---|---|
| Each skill's average | 65.5% | 0.626 (0.616 to 0.637) | 0.626 |
| ktrace, default settings | 67.3% | 0.665 (0.646 to 0.684) | 0.670 |
| ktrace, one fit for all skills | 70.0% | 0.685 (0.668 to 0.703) | 0.594 |
| ktrace, fitted per skill | 70.8% | 0.714 (0.699 to 0.730) | 0.577 |
| pyBKT | 70.7% | 0.718 (0.703 to 0.733) | 0.576 |
| pyBKT with forgetting | 70.8% | 0.721 (0.709 to 0.734) | 0.574 |

What this shows, and does not:

- Fitted per skill, ktrace is within half a point of the reference (AUC gap -0.0035, interval
  -0.0057 to -0.0012). It is the same model, so this is a check that the implementation is right.
- The default settings are poor: their probabilities are worse than the per-skill average (log
  loss 0.670 against 0.626). Fit the model on your own data before trusting its numbers.
- The forgetting curve is not tested. This dataset has no usable times between answers.
- pyBKT was run with one starting point, not its default five, to keep the run short.
- Before the repeated rows were removed, every model scored about 0.08 higher
  (`bench/results_uncleaned.json`). Those figures are inflated and should not be quoted.

To reproduce (seed 42; results in `bench/results.json` with the commit they came from):

```bash
uv run --with pandas bench/prepare.py --seed 42
node bench/ktrace_run.mjs
uv run --python 3.11 --with pybkt --with "numpy<2" --with "pandas<2.3" --with "scikit-learn<1.5" bench/pybkt_run.py --seed 42
uv run --with pandas --with numpy bench/score.py --seed 42
```

## Honest limits

- The model's four numbers are guesses, and the benchmark above shows they are poor ones. It can
  fit them from data, but refuses to until there are 200 answers.
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
