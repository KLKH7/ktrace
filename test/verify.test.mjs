// node --test test/   No network: the source's answers are canned.
import assert from "node:assert/strict";
import { test } from "node:test";
import { overlap, verify } from "../src/verify.mjs";

const answer = (body, ok = true, status = 200) => async () => ({ ok, status, text: async () => body, json: async () => JSON.parse(body) });
const ATOM = `<feed><title>query</title><entry><published>2017-06-12T17:57:34Z</published><title>Attention Is All
 You Need</title><author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author></entry></feed>`;

test("a real arXiv paper is confirmed with the source's own title, authors and year", async () => {
  const got = await verify({ title: "Attention is all you need", url: "https://arxiv.org/abs/1706.03762v7" }, answer(ATOM));
  assert.deepEqual(got, { ok: true, title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, url: "https://arxiv.org/abs/1706.03762" });
  assert.equal((await verify({ title: "Attention is all you need", url: "1706.03762" }, answer(ATOM))).ok, true);
});

test("a wrong id, a missing paper and an invented title are refused", async () => {
  assert.match((await verify({ title: "Deep Knowledge Tracing", url: "arxiv:1706.03762" }, answer(ATOM))).reason, /different paper: "Attention Is All You Need"/);
  assert.match((await verify({ title: "Anything", url: "arxiv:9999.99999" }, answer("<feed><title>q</title></feed>"))).reason, /no arXiv paper/);
});

test("videos are checked against YouTube and pages against their own title", async () => {
  const video = answer(JSON.stringify({ title: "Let's build GPT: from scratch, in code, spelled out.", author_name: "Andrej Karpathy" }));
  assert.deepEqual((await verify({ title: "Let's build GPT from scratch", url: "https://www.youtube.com/watch?v=kCc8FmEb1nY" }, video)).authors, ["Andrej Karpathy"]);
  assert.match((await verify({ title: "Fourier transforms explained", url: "https://youtu.be/kCc8FmEb1nY" }, video)).reason, /not what was claimed/);
  assert.equal((await verify({ title: "The Illustrated Transformer", url: "https://example.org/t" }, answer("<html><title>The Illustrated Transformer – A Blog</title>"))).ok, true);
  assert.match((await verify({ title: "The Illustrated Transformer", url: "https://example.org/t" }, answer("", false, 404))).reason, /answered 404/);
});

test("private and non-https addresses are never fetched", async () => {
  const never = async () => assert.fail("fetched");
  for (const url of ["http://example.org/a", "https://localhost/a", "https://192.168.1.4/a", "file:///etc/passwd", "not a link"]) assert.equal((await verify({ title: "x", url }, never)).ok, false);
});

test("overlap counts the claimed words found in the real title", () => {
  assert.equal(overlap("attention is all you need", "Attention Is All You Need"), 1);
  assert.equal(overlap("deep knowledge tracing", "Attention Is All You Need"), 0);
});
