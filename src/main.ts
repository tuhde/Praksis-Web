// SPDX-License-Identifier: Apache-2.0
import { ApiError, Client, normaliseBase, type Reply } from "./api.js";
import { describe, runCommand, succeeded, type Outcome } from "./commands.js";
import { renderForm, type FormEnv } from "./forms.js";
import { renderComponents, SCHEMA, type Action, type Component, type Handlers } from "./view.js";

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
  private fields = new Map<string, string[]>();
  private readonly result = el("p", { cls: "result", attrs: { role: "status" } });
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
    show(...header, nav, this.result, this.pane);
    void this.loadCommands();
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
    this.note("");
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
      run: (action) => void this.act(action),
      form: (form, into) => renderForm(into, form, this.formEnv()),
    };
  }

  private formEnv(): FormEnv {
    return {
      submit: async (command, values, leave) => {
        try {
          const outcome = await runCommand(this.client, command, values);
          this.say(outcome);
          if (!succeeded(outcome)) return describe(outcome).join("; ");
          if (leave) await this.open(leave, {});
          else await this.refresh();
          return null;
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      },
      fieldsOf: (command) => this.fields.get(command) ?? null,
      suggest: async (lookup, text) => {
        const r = await this.client.call({ op: "lookup", view: this.current ?? "", capability: lookup.capability, args: { [lookup.arg]: text } });
        const items = (Array.isArray(r["items"]) ? r["items"] : []) as Record<string, unknown>[];
        return items.flatMap((i) => {
          const address = typeof i["address"] === "string" ? i["address"] : "";
          const name = typeof i["name"] === "string" ? i["name"] : "";
          return address ? [name ? `${name} <${address}>` : address] : [];
        });
      },
    };
  }

  /** A button of a view: another view, a command (after the question it asks), or a download. */
  private async act(action: Action): Promise<void> {
    if (action.opens) {
      if (action.opens.screen) {
        this.note("This opens a screen of the desktop program, which this page does not have.");
        return;
      }
      await this.open(action.opens.view, action.opens.params ?? {});
      return;
    }
    if (action.download) {
      this.note("Downloads are not offered over the web yet.");
      return;
    }
    if (!action.command) return;
    if (action.confirm && !window.confirm(action.confirm)) return;
    try {
      const outcome = await runCommand(this.client, action.command, action.args ?? {});
      this.say(outcome);
      await this.refresh();
    } catch (e) {
      this.note(e instanceof Error ? e.message : String(e), true);
    }
  }

  private say(outcome: Outcome): void {
    this.note(describe(outcome).join("\n"), !succeeded(outcome));
  }

  private note(message: string, failed = false): void {
    this.result.textContent = message;
    this.result.className = failed ? "result error" : "result";
  }

  private async loadCommands(): Promise<void> {
    try {
      const r = await this.client.call({ op: "commands" });
      const list = (Array.isArray(r["commands"]) ? r["commands"] : []) as { id: string; params?: { name: string }[] }[];
      this.fields = new Map(list.map((c) => [c.id, (c.params ?? []).map((p) => p.name)]));
    } catch {
      // without the list another button of a form sends all its fields
    }
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
