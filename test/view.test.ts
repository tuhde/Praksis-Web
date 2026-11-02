// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { formatBytes, formatValue, renderComponents, safeImage, safeLink, type Action, type Component, type Handlers, type Select } from "../src/view.js";

function draw(parts: Component[]) {
  const dom = new JSDOM("<!doctype html><div id=r></div>");
  const root = dom.window.document.getElementById("r") as unknown as HTMLElement;
  const selected: { select: Select; typed?: string }[] = [];
  const ran: Action[] = [];
  const h: Handlers = {
    select: (select, typed) => selected.push(typed === undefined ? { select } : { select, typed }),
    run: (a) => ran.push(a),
    form: (f, into) => { into.textContent = `form ${f.command}`; },
  };
  renderComponents(root, parts, h);
  return { root, selected, ran, window: dom.window };
}

test("links and pictures are checked again here", () => {
  assert.equal(safeLink("https://example.org/a"), "https://example.org/a");
  assert.equal(safeLink("mailto:a@b.c"), "mailto:a@b.c");
  assert.equal(safeLink("javascript:alert(1)"), null);
  assert.equal(safeLink("data:text/html,x"), null);
  assert.equal(safeLink("//evil"), null);
  assert.equal(safeImage("https://x/y.png"), "https://x/y.png");
  assert.equal(safeImage("http://x/y.png"), null);
  assert.equal(safeImage("data:image/png;base64,AA"), null);
});

test("values are formatted for a person", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatValue(2048, "bytes"), "2.0 KB");
  assert.equal(formatValue(null, "text"), "");
  assert.equal(formatValue("not a date", "datetime"), "not a date");
  assert.equal(formatValue({ a: 1 }), '{"a":1}');
});

test("text from the daemon is text, never markup", () => {
  const evil = "<img src=x onerror=alert(1)><script>alert(2)</script>";
  const { root } = draw([
    { type: "text", text: evil },
    { type: "table", columns: [{ title: evil }], rows: [{ cells: [evil] }] },
    { type: "detail", fields: [{ label: evil, value: evil }] },
    { type: "button", label: evil },
  ]);
  assert.equal(root.querySelector("script"), null);
  assert.equal(root.querySelector("img"), null);
  assert.ok(root.textContent?.includes(evil));
});

test("a row with a selection sets the parameter when clicked or entered", () => {
  const sel: Select = { param: "mail", value: 7, clear: ["page"] };
  const { root, selected, window } = draw([
    { type: "table", columns: [{ title: "Subject" }], rows: [{ cells: ["Hello"], select: sel }, { cells: ["Other"] }] },
  ]);
  const rows = root.querySelectorAll("tbody tr");
  (rows[0] as HTMLElement).click();
  (rows[0] as HTMLElement).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" }));
  (rows[1] as HTMLElement).click();
  assert.equal(selected.length, 2);
  assert.deepEqual(selected[0]?.select, sel);
});

test("an input hands over what was typed", () => {
  const { root, selected, window } = draw([{ type: "input", text: "", label: "Search", select: { param: "q", value: null } }]);
  const i = root.querySelector("input") as HTMLInputElement;
  assert.equal(i.placeholder, "Search");
  i.value = "invoice";
  i.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" }));
  assert.equal(selected[0]?.typed, "invoice");
});

test("buttons start their command, a disabled one does nothing", () => {
  const act: Action = { label: "Archive", command: "mail.archive" };
  const { root, ran } = draw([
    { type: "button", label: "Archive", actions: [act] },
    { type: "button", label: "Off", enabled: false, actions: [act] },
  ]);
  const [a, b] = Array.from(root.querySelectorAll("button"));
  a?.click();
  b?.click();
  assert.deepEqual(ran, [act]);
});

test("rich text keeps to text, safe links and allowed pictures", () => {
  const { root, selected } = draw([
    {
      type: "richtext",
      rich: {
        blocks: [
          { kind: "heading", level: 2, runs: [{ text: "Title" }] },
          { kind: "paragraph", runs: [
            { text: "go", link: "https://example.org" },
            { text: "bad", link: "javascript:alert(1)" },
            { text: "pic", image: "https://x/y.png" },
            { text: "http pic", image: "http://x/y.png" },
          ] },
          { kind: "list", ordered: true, children: [{ kind: "item", runs: [{ text: "one", bold: true }] }] },
        ],
        blocked: 2,
        imagesParam: "images",
      },
    },
  ]);
  const links = Array.from(root.querySelectorAll("a"));
  assert.equal(links.length, 1);
  assert.equal(links[0]?.getAttribute("href"), "https://example.org/");
  assert.match(links[0]?.getAttribute("rel") ?? "", /noopener/);
  const imgs = Array.from(root.querySelectorAll("img"));
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0]?.getAttribute("src"), "https://x/y.png");
  assert.ok(root.querySelector("h2"));
  assert.ok(root.querySelector("ol li"));
  Array.from(root.querySelectorAll("button")).find((b) => /Load 2/.test(b.textContent ?? ""))?.click();
  assert.deepEqual(selected[0]?.select, { param: "images", value: true });
});

test("a part with an error or an unknown type shows that, and containers nest", () => {
  const { root } = draw([
    { type: "text", error: "source failed" },
    { type: "hologram" },
    { type: "row", children: [{ type: "column", children: [{ type: "text", text: "deep" }] }] },
    { type: "form", form: { command: "mail.send" } },
  ]);
  assert.match(root.textContent ?? "", /source failed/);
  assert.match(root.textContent ?? "", /does not know/);
  assert.ok(root.querySelector(".row .column p"));
  assert.match(root.textContent ?? "", /form mail\.send/);
});
