// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { Client } from "../src/api.js";
import { describe, runCommand, succeeded, typedValue } from "../src/commands.js";
import { renderForm, type FormEnv } from "../src/forms.js";

test("typed values follow the type, and mistakes say what is wrong", () => {
  const f = (type: string, required = false) => ({ name: "x", type, required });
  assert.equal(typedValue(f("int"), " 42 "), 42);
  assert.throws(() => typedValue(f("int"), "4.2"), /whole number/);
  assert.equal(typedValue(f("double"), "1.5"), 1.5);
  assert.throws(() => typedValue(f("double"), "abc"), /number/);
  assert.equal(typedValue(f("timestamp"), "2026-01-31T10:00:00Z"), "2026-01-31T10:00:00.000Z");
  assert.throws(() => typedValue(f("timestamp"), "yesterday"), /time like/);
  assert.equal(typedValue(f("bytes"), "AAAA"), "AAAA");
  assert.throws(() => typedValue(f("bytes"), "A"), /Base64/);
  assert.deepEqual(typedValue(f("list"), '["a"]'), ["a"]);
  assert.throws(() => typedValue(f("list"), "{}"), /list/);
  assert.deepEqual(typedValue(f("map"), '{"k":1}'), { k: 1 });
  assert.throws(() => typedValue(f("map"), "[]"), /map/);
  assert.throws(() => typedValue(f("map"), "{"), /JSON/);
  assert.equal(typedValue(f("string"), "  hi "), "hi");
  assert.equal(typedValue(f("string"), "  "), null);
  assert.throws(() => typedValue(f("string", true), ""), /needed/);
});

test("a step left out by its condition is no failure, a failed step is", () => {
  assert.ok(succeeded({ done: true, lines: [{ outcome: "OK", message: "m" }, { outcome: "SKIPPED", actionId: "a", message: "m" }] }));
  assert.ok(!succeeded({ done: true, lines: [{ outcome: "SKIPPED", message: "rule disabled" }] }));
  assert.ok(!succeeded({ done: true, lines: [{ outcome: "FAILED", actionId: "a", message: "m" }] }));
  assert.deepEqual(describe({ done: true, lines: [] }), ["(nothing was done)"]);
});

function fake(answers: unknown[]): { client: Client; sent: unknown[] } {
  const sent: unknown[] = [];
  const client = new Client("http://x", "t", async (_u, init) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(answers.shift()), { status: 200 });
  });
  return { client, sent };
}

test("a command is started and followed until it is done", async () => {
  const { client, sent } = fake([
    { type: "command-started", event: "e1" },
    { type: "outcome", done: false, lines: [] },
    { type: "outcome", done: true, lines: [{ outcome: "OK", actionId: "a", message: "done" }] },
  ]);
  const o = await runCommand(client, "mail.archive", { id: 3 }, 5000, 1);
  assert.ok(succeeded(o));
  assert.deepEqual(sent[0], { op: "run-command", command: "mail.archive", args: { id: 3 }, client: "praksis-web" });
  assert.deepEqual(sent[1], { op: "outcome", event: "e1" });
});

test("a command that does not finish ends with a message", async () => {
  const answers: unknown[] = [{ type: "command-started", event: "e" }];
  for (let i = 0; i < 50; i++) answers.push({ type: "outcome", done: false, lines: [] });
  await assert.rejects(runCommand(fake(answers).client, "c", {}, 5, 1), /still running/);
});

function form(env: Partial<FormEnv>, spec: object) {
  const dom = new JSDOM("<!doctype html><div id=r></div>");
  const into = dom.window.document.getElementById("r") as unknown as HTMLElement;
  const full: FormEnv = { submit: async () => null, fieldsOf: () => null, suggest: async () => [], ...env };
  renderForm(into, spec as never, full);
  return { into, window: dom.window };
}

const mailForm = {
  command: "mail.send",
  title: "Write",
  submit: "Send",
  done: "inbox",
  fields: [
    { name: "to", type: "string", required: true, label: "To", widget: "recipients" },
    { name: "body", type: "string", required: false, label: "Text", widget: "multiline" },
    { name: "thread", type: "string", required: false, value: "t-1", widget: "hidden" },
    { name: "files", type: "list", required: false, widget: "files" },
  ],
  others: [{ label: "Save draft", command: "mail.draft" }],
};

test("a form checks its fields before it sends, and shows what is wrong", async () => {
  const calls: unknown[] = [];
  const { into, window } = form({ submit: async (...a) => { calls.push(a); return null; } }, mailForm);
  const send = into.querySelector("button[type=submit]") as HTMLButtonElement;
  into.querySelector("form")?.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 5));
  assert.match(into.querySelector(".error")?.textContent ?? "", /To is needed/);
  assert.equal(calls.length, 0);
  (into.querySelector("input[type=text]") as HTMLInputElement).value = "a@b.c";
  (into.querySelector("textarea") as HTMLTextAreaElement).value = "line 1\n  line 2";
  into.querySelector("form")?.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls[0], ["mail.send", { to: "a@b.c", body: "line 1\n  line 2", thread: "t-1" }, "inbox"]);
  assert.ok(send);
});

test("another button sends only the fields its command has and does not leave", async () => {
  const calls: unknown[] = [];
  const { into } = form({ fieldsOf: () => ["to", "body"], submit: async (...a) => { calls.push(a); return null; } }, mailForm);
  (into.querySelector("input[type=text]") as HTMLInputElement).value = "a@b.c";
  (Array.from(into.querySelectorAll("button")).find((b) => b.textContent === "Save draft") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(calls[0], ["mail.draft", { to: "a@b.c" }, null]);
});

test("a problem the daemon reports is shown in the form", async () => {
  const { into, window } = form({ submit: async () => "no grant" }, mailForm);
  (into.querySelector("input[type=text]") as HTMLInputElement).value = "a@b.c";
  into.querySelector("form")?.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(into.querySelector(".error")?.textContent, "no grant");
});

test("files are not offered, and labels are text", () => {
  const evil = "<b onclick=x>";
  const { into } = form({}, { ...mailForm, title: evil });
  assert.match(into.textContent ?? "", /not offered over the web/);
  assert.equal(into.querySelector("b"), null);
});
