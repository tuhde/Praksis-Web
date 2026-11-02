// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { ApiError, Client, normaliseBase } from "../src/api.js";

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

test("a call sends the token as a bearer and the request as json", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const c = new Client("http://127.0.0.1:8484", "pwt_x", async (url, init) => {
    seen = { url, init };
    return reply(200, { type: "status", rules: 3 });
  });
  const r = await c.call({ op: "status" });
  assert.equal(r["rules"], 3);
  assert.equal(seen?.url, "http://127.0.0.1:8484/api");
  const headers = seen?.init.headers as Record<string, string>;
  assert.equal(headers["Authorization"], "Bearer pwt_x");
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(seen?.init.credentials, "omit");
  assert.equal(seen?.init.body, '{"op":"status"}');
});

test("an error reply and a refusal both become an ApiError", async () => {
  const c = new Client("http://x", "t", async () => reply(401, { type: "error", message: "a valid token is needed" }));
  await assert.rejects(c.call({ op: "status" }), (e: unknown) => e instanceof ApiError && e.status === 401 && /token/.test(e.message));
  const d = new Client("http://x", "t", async () => reply(200, { type: "error", message: "no" }));
  await assert.rejects(d.call({ op: "x" }), /no/);
});

test("an unreachable daemon and a strange answer are told apart", async () => {
  const down = new Client("http://x", "t", async () => { throw new TypeError("failed"); });
  await assert.rejects(down.call({ op: "status" }), /cannot reach/);
  const odd = new Client("http://x", "t", async () => reply(200, "<html>"));
  await assert.rejects(odd.call({ op: "status" }), /without a reply/);
  const arr = new Client("http://x", "t", async () => reply(200, [1]));
  await assert.rejects(arr.call({ op: "status" }), /not a reply/);
});

test("the address is reduced to its origin and must be http or https", () => {
  assert.equal(normaliseBase(" http://127.0.0.1:8484/some/path?x=1 "), "http://127.0.0.1:8484");
  assert.throws(() => normaliseBase("javascript:alert(1)"));
  assert.throws(() => normaliseBase("ftp://host"));
  assert.throws(() => normaliseBase("http://user:pw@host"));
  assert.throws(() => normaliseBase("nonsense"));
});

test("no source file puts data in as markup or runs strings as code", () => {
  for (const f of readdirSync("src").filter((n) => n.endsWith(".ts"))) {
    const code = readFileSync(`src/${f}`, "utf8");
    assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, f);
  }
});

test("the page allows scripts only from itself", () => {
  const html = readFileSync("src/index.html", "utf8");
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)/);
});
