// Finding the pictures in a source page, with no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { candidates, figure, pick } from "../src/figure.mjs";

const html = `<img src="/static/logo.png" alt="Site"><img src="tiny.png" width="16" height="16">
<figure><img src="x1.png" alt="Refer to caption"><figcaption>Figure 1: The <b>attention</b> weights.</figcaption></figure>
<img data-src="https://cdn.example.org/broadcasting_2.png" alt="Two arrays being broadcast"><img src="http://plain.example.org/a.png"><img src="https://localhost/a.png">`;

test("pictures are found with what the page says about them; page furniture and unsafe addresses are left out", () => {
  assert.deepEqual(candidates(html, "https://example.org/paper/"), [
    { url: "https://example.org/paper/x1.png", text: "Figure 1: The attention weights.", inFigure: true },
    { url: "https://cdn.example.org/broadcasting_2.png", text: "Two arrays being broadcast", inFigure: false },
  ]);
});

test("a picture is embedded only when the source serves a real image", async () => {
  const png = Buffer.alloc(4000, 1);
  const answer = (type) => async (url) => (url.endsWith(".png") ? new Response(png, { headers: { "content-type": type } }) : new Response(html));
  const got = await figure({ url: "https://example.org/paper/", wanted: "attention" }, answer("image/png"));
  assert.match(got.src, /^data:image\/png;base64,/);
  assert.equal(await figure({ url: "https://example.org/paper/", wanted: "attention" }, answer("text/html")), null);
});

test("the picture whose caption matches the idea is chosen, and none when nothing matches", () => {
  const found = [
    { url: "a", text: "Figure 1: The Transformer - model architecture.", inFigure: true },
    { url: "b", text: "Scaled dot-product attention", inFigure: false },
    { url: "c", text: "Figure 2: (left) Scaled Dot-Product Attention. (right) Multi-Head Attention.", inFigure: true },
  ];
  assert.equal(pick(found, "scaled dot-product attention").url, "c", "a captioned figure beats alt text that matches as well");
  assert.equal(pick(found, "token bucket algorithm"), null);
  assert.equal(pick([], "anything"), null);
});
