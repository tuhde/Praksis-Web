// SPDX-License-Identifier: Apache-2.0
import { ApiError, Client, normaliseBase, type Reply } from "./api.js";

const DEFAULT_BASE = "http://127.0.0.1:8484";

/** Builds an element; text always goes in as text, never as markup. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { text?: string; cls?: string; attrs?: Record<string, string> } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (props.text !== undefined) e.textContent = props.text;
  if (props.cls) e.className = props.cls;
  for (const [k, v] of Object.entries(props.attrs ?? {})) e.setAttribute(k, v);
  for (const c of children) e.append(c);
  return e;
}

function root(): HTMLElement {
  const r = document.getElementById("app");
  if (!r) throw new Error("no #app");
  return r;
}

function show(...nodes: Node[]): void {
  root().replaceChildren(...nodes);
}

function loginScreen(message = ""): void {
  const base = el("input", { attrs: { type: "url", name: "base", value: sessionStorage.getItem("base") ?? DEFAULT_BASE, autocomplete: "off", required: "" } });
  const token = el("input", { attrs: { type: "password", name: "token", autocomplete: "off", required: "", placeholder: "pwt_..." } });
  const error = el("p", { cls: "error", text: message, attrs: { role: "alert" } });
  const form = el(
    "form",
    {},
    el("label", {}, "Daemon", base),
    el("label", {}, "Token", token),
    el("button", { text: "Log in", attrs: { type: "submit" } }),
    error,
  );
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void login(base.value, token.value);
  });
  show(el("h1", { text: "Praksis" }), form, el("p", { cls: "hint", text: "Make a token with: praksis web token create NAME" }));
}

async function login(baseInput: string, token: string): Promise<void> {
  let client: Client;
  try {
    client = new Client(normaliseBase(baseInput), token.trim());
  } catch (e) {
    loginScreen((e as Error).message);
    return;
  }
  try {
    const status = await client.call({ op: "status" });
    // only the address is remembered for the session, never the token
    sessionStorage.setItem("base", client.base);
    await home(client, status);
  } catch (e) {
    loginScreen(e instanceof ApiError ? e.message : String(e));
  }
}

function text(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

async function home(client: Client, status: Reply): Promise<void> {
  const identity = text(status["identity"]);
  document.title = identity ? `Praksis: ${identity}` : "Praksis";
  const views = await client.call({ op: "views" });
  const list = el("ul");
  const items = Array.isArray(views["views"]) ? (views["views"] as Record<string, unknown>[]) : [];
  for (const v of items) {
    list.append(el("li", {}, el("strong", { text: text(v["title"]) || text(v["id"]) }), el("span", { text: v["description"] ? ` ${text(v["description"])}` : "" })));
  }
  const logout = el("button", { text: "Log out", attrs: { type: "button" } });
  logout.addEventListener("click", () => loginScreen());
  show(
    el("header", {}, el("h1", { text: identity ? `Praksis: ${identity}` : "Praksis" }), logout),
    el("p", { text: `${text(status["rules"])} rules, ${text(status["pending"])} events waiting, protocol ${text(status["protocol"])}` }),
    el("h2", { text: "Screens" }),
    items.length ? list : el("p", { text: "This daemon has no views." }),
  );
}

loginScreen();
