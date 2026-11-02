// SPDX-License-Identifier: Apache-2.0
import { ApiError, Client, normaliseBase, type Reply } from "./api.js";
import { renderComponents, SCHEMA, type Component, type Handlers } from "./view.js";

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

interface ViewInfo { id: string; title: string; description?: string | null; schema: number }
interface Resolved { id: string; title: string; params: { name: string; value: unknown }[]; components: Component[]; warnings?: string[] }

/** One session: the list of views, the view that is open and its state, kept up to date. */
class Session {
  private current: string | null = null;
  private params: Record<string, unknown> = {};
  private stop = new AbortController();
  private readonly pane = el("section", { cls: "pane" });

  constructor(
    private readonly client: Client,
    private readonly views: ViewInfo[],
  ) {}

  start(header: Node[]): void {
    const nav = el("nav");
    for (const v of this.views) {
      const b = el("button", { text: v.title || v.id, attrs: { type: "button", title: v.description ?? "" } });
      if (v.schema > SCHEMA) {
        b.disabled = true;
        b.title = "needs a newer version of this page";
      }
      b.addEventListener("click", () => void this.open(v.id, {}));
      nav.append(b);
    }
    show(...header, nav, this.pane);
    void this.follow();
    const first = this.views.find((v) => v.schema <= SCHEMA);
    if (first) void this.open(first.id, {});
    else this.pane.replaceChildren(el("p", { text: "This daemon has no views this page can show." }));
  }

  close(): void {
    this.stop.abort();
  }

  async open(id: string, params: Record<string, unknown>): Promise<void> {
    this.current = id;
    this.params = params;
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.current) return;
    try {
      const r = (await this.client.call({ op: "view", view: this.current, params: this.params, maxSchema: SCHEMA })) as unknown as Resolved;
      // the daemon fills in the defaults; keep them as the state of the view
      this.params = Object.fromEntries(r.params.map((p) => [p.name, p.value]));
      const body = el("div");
      for (const w of r.warnings ?? []) body.append(el("p", { cls: "warning", text: w }));
      renderComponents(body, r.components, this.handlers());
      this.pane.replaceChildren(el("h2", { text: r.title }), body);
    } catch (e) {
      this.pane.replaceChildren(el("p", { cls: "error", text: e instanceof Error ? e.message : String(e) }));
    }
  }

  private handlers(): Handlers {
    return {
      select: (sel, typed) => {
        this.params = { ...this.params, [sel.param]: sel.value === null || sel.value === undefined ? (typed ?? "") : sel.value };
        for (const name of sel.clear ?? []) delete this.params[name];
        void this.refresh();
      },
      run: (action) => this.notYet(action.label ?? action.command ?? "this"),
      form: (form, into) => into.append(el("p", { cls: "muted", text: `${form.title ?? form.command}: forms follow in a later version of this page` })),
    };
  }

  private notYet(what: string): void {
    this.pane.prepend(el("p", { cls: "warning", text: `${what}: starting commands follows in a later version of this page` }));
  }

  /** Asks what changed, in a loop, and draws the view again when something did. */
  private async follow(): Promise<void> {
    let since = 0;
    const signal = this.stop.signal;
    while (!signal.aborted) {
      try {
        const r = await this.client.call({ op: "changes", since, waitMillis: 25000 }, signal);
        const counter = Number(r["counter"] ?? r["since"] ?? since);
        const changed = counter !== since && since !== 0;
        since = Number.isFinite(counter) ? counter : since;
        if (changed) await this.refresh();
      } catch (e) {
        if (signal.aborted) return;
        // the daemon is away or the token was revoked: try again later
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}

let session: Session | null = null;

async function home(client: Client, status: Reply): Promise<void> {
  session?.close();
  const identity = text(status["identity"]);
  document.title = identity ? `Praksis: ${identity}` : "Praksis";
  const reply = await client.call({ op: "views" });
  const views = (Array.isArray(reply["views"]) ? reply["views"] : []) as ViewInfo[];
  const logout = el("button", { text: "Log out", attrs: { type: "button" } });
  logout.addEventListener("click", () => {
    session?.close();
    session = null;
    loginScreen();
  });
  session = new Session(client, views);
  session.start([
    el("header", {}, el("h1", { text: identity ? `Praksis: ${identity}` : "Praksis" }), logout),
    el("p", { cls: "muted", text: `${text(status["rules"])} rules, ${text(status["pending"])} events waiting` }),
  ]);
}

loginScreen();
