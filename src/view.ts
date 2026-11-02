// SPDX-License-Identifier: Apache-2.0

/** The newest UI schema this renderer understands. */
export const SCHEMA = 1;

export interface Select {
  param: string;
  value?: unknown;
  clear?: string[];
  then?: Action | null;
}
export interface Action {
  label?: string;
  command?: string;
  args?: Record<string, unknown>;
  confirm?: string | null;
  download?: { capability: string; args?: Record<string, unknown>; filename?: string } | null;
  opens?: { view: string; params?: Record<string, unknown>; screen?: string | null } | null;
}
export interface Column { title: string; format?: string }
export interface Row { cells: unknown[]; select?: Select | null; actions?: Action[]; emphasis?: boolean }
export interface Field { label: string; format?: string; value: unknown }
export interface Run { text: string; bold?: boolean; italic?: boolean; code?: boolean; muted?: boolean; link?: string | null; image?: string | null }
export interface Block { kind: string; level?: number; ordered?: boolean; runs?: Run[]; children?: Block[] }
export interface Rich { blocks: Block[]; blocked?: number; imagesParam?: string | null }
export interface Form { command: string; title?: string; submit?: string; fields?: unknown[]; others?: unknown[]; done?: string | null }
export interface Component {
  type: string;
  text?: string | null;
  style?: string | null;
  label?: string | null;
  enabled?: boolean | null;
  empty?: string | null;
  columns?: Column[] | null;
  rows?: Row[] | null;
  fields?: Field[] | null;
  actions?: Action[] | null;
  form?: Form | null;
  children?: Component[] | null;
  error?: string | null;
  select?: Select | null;
  rich?: Rich | null;
}

/** What the page does when a person uses a part of a view. */
export interface Handlers {
  /** A click or an entered text sets a parameter of the view. */
  select(select: Select, typed?: string): void;
  /** A button starts a command. */
  run(action: Action): void;
  /** A form of a command is shown. */
  form(form: Form, into: HTMLElement): void;
}

/** Only these may become the target of a link; anything else is shown as text. */
export function safeLink(target: string | null | undefined): string | null {
  if (!target) return null;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
}

/** Only an https address may be loaded as a picture, and then only because the person allowed it. */
export function safeImage(target: string | null | undefined): string | null {
  if (!target) return null;
  try {
    const url = new URL(target);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** A cell as a person reads it. */
export function formatValue(value: unknown, format?: string | null): string {
  if (value === null || value === undefined) return "";
  switch (format) {
    case "datetime":
    case "date": {
      const d = new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      return format === "date" ? d.toLocaleDateString() : d.toLocaleString();
    }
    case "number":
      return typeof value === "number" ? value.toLocaleString() : String(value);
    case "bytes":
      return typeof value === "number" ? formatBytes(value) : String(value);
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

function node<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function activate(e: HTMLElement, fn: () => void): void {
  e.tabIndex = 0;
  e.setAttribute("role", "button");
  e.classList.add("clickable");
  e.addEventListener("click", fn);
  e.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      fn();
    }
  });
}

/** Draws the parts of a view into `into`. Everything that came from the daemon goes in as text. */
export function renderComponents(into: HTMLElement, parts: Component[], h: Handlers): void {
  for (const c of parts) into.append(renderComponent(into.ownerDocument, c, h));
}

export function renderComponent(doc: Document, c: Component, h: Handlers): HTMLElement {
  if (c.error) return node(doc, "p", "error", `${c.type}: ${c.error}`);
  switch (c.type) {
    case "text": return text(doc, c);
    case "table": return table(doc, c, h);
    case "list": return list(doc, c, h);
    case "detail": return detail(doc, c);
    case "button": return button(doc, c, h);
    case "input": return input(doc, c, h);
    case "form": {
      const box = node(doc, "section", "form");
      if (c.form) h.form(c.form, box);
      return box;
    }
    case "richtext": return richtext(doc, c, h);
    case "row":
    case "column": {
      const box = node(doc, "div", c.type);
      renderComponents(box, c.children ?? [], h);
      return box;
    }
    default:
      return node(doc, "p", "muted", `[a part of the type '${c.type}' that this page does not know]`);
  }
}

function text(doc: Document, c: Component): HTMLElement {
  const style = c.style ?? "normal";
  const e = node(doc, style === "title" ? "h2" : style === "code" ? "pre" : "p", `text-${style}`, c.text ?? "");
  return e;
}

function actionButtons(doc: Document, actions: Action[] | null | undefined, h: Handlers): HTMLElement | null {
  if (!actions || actions.length === 0) return null;
  const box = node(doc, "span", "actions");
  for (const a of actions) {
    const b = node(doc, "button", undefined, a.label ?? a.command ?? "");
    b.type = "button";
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      h.run(a);
    });
    box.append(b);
  }
  return box;
}

function table(doc: Document, c: Component, h: Handlers): HTMLElement {
  const rows = c.rows ?? [];
  if (rows.length === 0) return node(doc, "p", "muted", c.empty ?? "");
  const cols = c.columns ?? [];
  const t = node(doc, "table");
  const head = node(doc, "tr");
  for (const col of cols) head.append(node(doc, "th", undefined, col.title));
  head.append(node(doc, "th"));
  const thead = node(doc, "thead");
  thead.append(head);
  t.append(thead);
  const body = node(doc, "tbody");
  for (const r of rows) {
    const tr = node(doc, "tr", r.emphasis ? "emphasis" : undefined);
    r.cells.forEach((v, i) => tr.append(node(doc, "td", undefined, formatValue(v, cols[i]?.format))));
    const acts = node(doc, "td");
    const buttons = actionButtons(doc, r.actions, h);
    if (buttons) acts.append(buttons);
    tr.append(acts);
    if (r.select) {
      const s = r.select;
      activate(tr, () => h.select(s));
    }
    body.append(tr);
  }
  t.append(body);
  const wrap = node(doc, "div", "table-wrap");
  wrap.append(t);
  return wrap;
}

function list(doc: Document, c: Component, h: Handlers): HTMLElement {
  const rows = c.rows ?? [];
  if (rows.length === 0) return node(doc, "p", "muted", c.empty ?? "");
  const ul = node(doc, "ul", "items");
  for (const r of rows) {
    const li = node(doc, "li", r.emphasis ? "emphasis" : undefined);
    li.append(node(doc, "span", "title", formatValue(r.cells[0])));
    const sub = formatValue(r.cells[1]);
    if (sub) li.append(node(doc, "span", "subtitle", sub));
    const buttons = actionButtons(doc, r.actions, h);
    if (buttons) li.append(buttons);
    if (r.select) {
      const s = r.select;
      activate(li, () => h.select(s));
    }
    ul.append(li);
  }
  return ul;
}

function detail(doc: Document, c: Component): HTMLElement {
  const dl = node(doc, "dl");
  for (const f of c.fields ?? []) {
    dl.append(node(doc, "dt", undefined, f.label));
    dl.append(node(doc, "dd", undefined, formatValue(f.value, f.format)));
  }
  return dl;
}

function button(doc: Document, c: Component, h: Handlers): HTMLElement {
  const b = node(doc, "button", undefined, c.label ?? "");
  b.type = "button";
  b.disabled = c.enabled === false;
  b.addEventListener("click", () => {
    if (c.select) h.select(c.select);
    else if (c.actions && c.actions[0]) h.run(c.actions[0]);
  });
  return b;
}

function input(doc: Document, c: Component, h: Handlers): HTMLElement {
  const i = node(doc, "input");
  i.type = "text";
  i.value = c.text ?? "";
  if (c.label) i.placeholder = c.label;
  i.autocomplete = "off";
  i.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && c.select) {
      ev.preventDefault();
      h.select(c.select, i.value);
    }
  });
  return i;
}

function runNode(doc: Document, r: Run, allowImage: boolean): Node {
  const image = allowImage ? safeImage(r.image) : null;
  if (image) {
    const img = node(doc, "img");
    img.src = image;
    img.alt = r.text;
    img.referrerPolicy = "no-referrer";
    img.loading = "lazy";
    return img;
  }
  let e: HTMLElement = node(doc, "span", undefined, r.text);
  const href = safeLink(r.link);
  if (href) {
    const a = node(doc, "a", undefined, r.text);
    a.href = href;
    a.rel = "noopener noreferrer nofollow";
    a.target = "_blank";
    e = a;
  }
  if (r.code) e.classList.add("code");
  if (r.muted) e.classList.add("muted");
  if (r.bold) e.style.fontWeight = "bold";
  if (r.italic) e.style.fontStyle = "italic";
  return e;
}

function blockNode(doc: Document, b: Block): HTMLElement {
  const runs = (into: HTMLElement) => {
    for (const r of b.runs ?? []) into.append(runNode(doc, r, true));
    return into;
  };
  switch (b.kind) {
    case "heading": return runs(node(doc, (`h${Math.min(6, Math.max(1, b.level ?? 3))}` as "h3")));
    case "quote": return runs(node(doc, "blockquote"));
    case "pre": return runs(node(doc, "pre"));
    case "rule": return node(doc, "hr");
    case "item": {
      const li = runs(node(doc, "li"));
      for (const c of b.children ?? []) li.append(blockNode(doc, c));
      return li;
    }
    case "list": {
      const l = node(doc, b.ordered ? "ol" : "ul");
      for (const c of b.children ?? []) l.append(blockNode(doc, c));
      return l;
    }
    default: return runs(node(doc, "p"));
  }
}

function richtext(doc: Document, c: Component, h: Handlers): HTMLElement {
  const box = node(doc, "div", "richtext");
  const rich = c.rich;
  if (!rich) return box;
  for (const b of rich.blocks) box.append(blockNode(doc, b));
  if ((rich.blocked ?? 0) > 0 && rich.imagesParam) {
    const param = rich.imagesParam;
    const b = node(doc, "button", undefined, `Load ${rich.blocked} remote image${rich.blocked === 1 ? "" : "s"}`);
    b.type = "button";
    b.addEventListener("click", () => h.select({ param, value: true }));
    box.append(b);
  }
  return box;
}
