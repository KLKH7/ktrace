# ktrace

Knowledge tracing for people who build with coding agents. A small server for [Claude Code](https://claude.com/claude-code) that keeps your
understanding up with the build.

When an agent writes your code, the project moves forward and you don't. This gives the agent
five tools so that changes, without slowing the work:

| Tool | What the agent does with it |
|---|---|
| `note_concept` | Quietly logs each non-obvious idea it uses in your project, and where. |
| `what_i_know` | Reads what you can and can't explain today, so it pitches explanations to you. |
| `record_answer` | When it asks you something in the chat and you answer, it keeps the result. |
| `suggest_next` | Proposes the one paper, talk or post just beyond what you built. |
| `explain_change` | Adds the two or three ideas behind what it just wrote to your notebook, and opens it. |

**After a change, your notebook opens.** Once the agent has written about forty lines, it is
asked to explain them before it stops. The notebook has a section for each project and a page
for each topic; a change on a topic you already have is added to that page. Each entry starts
with where the change sits: what you were trying to do, what was there before, what is there
now, and a small map of the project with the changed parts filled in. Each idea then comes in
the order it is best met: the problem that calls for it, one thing to predict, the picture that
settles it, and only then the idea in plain words with one example, the lines of your code
that use it, one source with a diagram taken from inside it, and a question to try out loud
with an answer hidden until you ask. The agent can also show an idea in the one format that suits
it: a worked example in numbered steps, the code with a note beside each group of lines, two
cases side by side, a diagram of boxes and arrows that ktrace draws from a list, or a walk:
one picture you step through or play, with boxes lighting up and values and bars changing at
each step.

**When you are lost, you click instead of asking again.** Under each idea is the chain it rests
on, folded shut: open it one level at a time until it makes sense. Every level has an "I'm lost
here" link. Click it and, at the end of its next turn, the agent explains only that point, from
one level further back, on the same page. For this the notebook is served from your own machine
(`127.0.0.1`, nowhere else); opened as a file, the link copies the question for you to paste.

**You choose how much is on screen.** A Detail button cycles Brief, Normal and Full, and
remembers. Normal shows each idea's problem, a prediction, its picture and a short explanation,
with the code and closing question folded under one line; Brief shows one idea and no
explanation; Full opens everything. Older entries on a page are one line each until opened.

**Questions come back.** A "Due today" page lists a few questions from earlier entries: each
idea a day after it was explained, and again whenever it has had time to fade. Answer out loud,
then mark Got it, Partly or Missed; that feeds the same model `what_i_know` reads, which sets
when it comes round next.

**A video source plays inside the notebook.** When the best source for an idea is a YouTube
video, it is shown as its still frame; click it and it plays in place, from the minute that
matters when the agent gave one. Nothing is fetched from YouTube until you click. It
has a day and a night mode. The agent writes it in the session you already have, so there is no second sign-in
and no API key. It happens at most once every twenty minutes.

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

This adds the server, and a hook that runs when the agent finishes a turn
([`src/hook.mjs`](src/hook.mjs)). It works the same in the terminal and in the desktop app.
Your Claude Code settings file is backed up beside itself first.

Start a new Claude Code session and build something. Your notebook opens after the first substantial
change. To pause the pages, `touch ~/.ktrace/off`; delete that file to resume. Later:

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
noted, the reading list, each explanation (`checks/`) and the notebook built from them
(`notebook.html`). Nothing is uploaded. The only network use is checking a suggested
source at arXiv, YouTube or its own page, and fetching one diagram from it. There is no account and no telemetry.

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
- The forgetting curve is not tested by this dataset, which has no usable times between
  answers. It is tested separately, below.
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

### Forgetting

The forgetting rule was tested on Duolingo's public review data (Settles & Meeder, 2016), which
records the time since each word was last practised, against Duolingo's own published code. The
first 3,000,000 reviews were used: the first 90% to learn from, and the last 300,000 (6,597
learners) scored. MAE is the average gap between predicted and actual recall, lower is better;
AUC is how well risky reviews are ranked below safe ones, where 0.5 is chance.

| Model | MAE (95% interval) | AUC (95% interval) |
|---|---|---|
| Always predict the average recall | 0.175 (0.172 to 0.178) | 0.500 |
| ktrace as shipped | 0.528 (0.521 to 0.535) | 0.547 (0.540 to 0.555) |
| ktrace, earlier answers replayed | 0.250 (0.246 to 0.254) | 0.566 (0.559 to 0.572) |
| ktrace, replayed and four numbers fitted | 0.193 (0.190 to 0.197) | 0.566 (0.559 to 0.573) |
| ktrace, forgetting rule fitted as well | 0.154 (0.150 to 0.157) | 0.571 (0.562 to 0.578) |
| ktrace, all seven numbers fitted together | 0.173 (0.170 to 0.176) | 0.584 (0.575 to 0.593) |
| Pimsleur | 0.437 (0.428 to 0.446) | 0.518 (0.510 to 0.527) |
| Leitner | 0.228 (0.222 to 0.234) | 0.546 (0.538 to 0.553) |
| Logistic regression | 0.216 (0.212 to 0.219) | 0.496 (0.487 to 0.505) |
| Half-life regression (Duolingo) | 0.125 (0.121 to 0.129) | 0.538 (0.531 to 0.547) |

What this shows:

- **As shipped, the forgetting rule is badly wrong on this data.** It is the worst model in the
  table on MAE, worse than predicting the average. Learners recalled about 90% of words; the
  model, starting from a three-day half-life and a low starting belief, expected far less.
- **It ranks well.** With earlier answers replayed, its AUC is the highest in the table, above
  half-life regression. It knows which reviews are riskier; its probabilities are too low.
- **Fitting only the four tracing numbers is not enough.** With the forgetting rule left as
  shipped (first half-life of three days, doubling, halving), it does not beat the average on MAE.
- **Fitting the forgetting rule fixes the worst of it.** Its three numbers were fitted on the
  2,700,000 training reviews by maximum likelihood and scored once on the held-out reviews. MAE
  falls to 0.154, better than the average (0.175) and still worse than half-life regression
  (0.125). The fit moved the first half-life from 3 days to about 23, the growth after a right
  answer from 2 to 10, and the shrinkage after a wrong answer from 0.5 to 1 (none). The last two
  stopped at the limits the search allowed, so their best values may lie beyond them.
- **Fitting all seven together ranks best and predicts worse.** AUC rises to 0.584, the highest
  in the table, but MAE is 0.173. The chance of learning from an attempt goes to almost zero and
  the chance of a lucky guess to 0.76: the model is using "guess" as a floor on recall. That is
  a sign this kind of model suits vocabulary review poorly, not a finding about guessing.
- **The fitted values are loosely pinned down.** An earlier run with a stricter stopping rule
  put the first half-life at the 365-day limit with almost the same likelihood. They come from
  vocabulary flashcards and are not shipped as defaults.
- The reference numbers match the paper's (for example half-life regression at about 0.128
  MAE and 0.538 AUC), which is a check that the setup is right.
- Only the first 3,000,000 of 12.9 million reviews were used, to fit in memory and time.

To reproduce: `sh bench/duo_reference.sh`, then
`gunzip -c bench/data/duo/traces.csv.gz | head -n 3000001 | node bench/duo_ktrace.mjs`, then
`uv run --with pandas --with numpy bench/duo_score.py --seed 42`. The data is licensed CC BY-NC 4.0.

## Honest limits

- The model's numbers are guesses, and the benchmarks above show they are poor ones: the
  shipped three-day first half-life forgets about eight times too fast on Duolingo's data. It can
  fit them from data, but refuses to until there are 200 answers.
- Ideas are matched by name, so "WACC" and "cost of capital" count as two.
- Whether the agent calls the tools is up to the agent. The server tells it when to, and never
  to interrupt work to teach.
- At most two reading suggestions per project per day. A short list gets read.
- The page is written by the same agent that wrote the code. Its sources are confirmed and its
  snippets are checked against your files, but the explanation itself is not checked by anything.
- Writing the page costs the agent one extra step at the end of a turn.

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
