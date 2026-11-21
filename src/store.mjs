// Where everything is kept: plain files in one folder on this machine, readable by hand.
//   answers.jsonl   one line per answer: when, skill, verdict
//   concepts.jsonl  one line per idea the agent noted: name, why, where, project
//   reading.json    what to read next, each confirmed at its source
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const home = () => process.env.LEARN_HOME ?? join(homedir(), ".learn-while-it-builds");

export const lines = (file) => (existsSync(join(home(), file)) ? readFileSync(join(home(), file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

export function append(file, row) {
  mkdirSync(home(), { recursive: true });
  appendFileSync(join(home(), file), JSON.stringify(row) + "\n");
}

export const reading = () => (existsSync(join(home(), "reading.json")) ? JSON.parse(readFileSync(join(home(), "reading.json"), "utf8")) : []);

export function saveReading(list) {
  mkdirSync(home(), { recursive: true });
  writeFileSync(join(home(), "reading.json"), JSON.stringify(list, null, 2));
}
