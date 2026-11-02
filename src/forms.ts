// SPDX-License-Identifier: Apache-2.0
import { typedValue } from "./commands.js";
import type { Form } from "./view.js";

interface FormField { name: string; type: string; required?: boolean; label?: string | null; value?: unknown; widget?: string | null }
interface Submit { label: string; command: string }
interface Lookup { capability: string; arg: string }
type FullForm = Form & { fields?: FormField[]; others?: Submit[]; lookup?: Lookup | null };

/** What a form needs from the page around it. */
export interface FormEnv {
  /** Starts the command; resolves to a problem to show, or null if it worked. */
  submit(command: string, values: Record<string, unknown>, leave: string | null): Promise<string | null>;
  /** The names of the arguments of a command, or null if it is not known. */
  fieldsOf(command: string): string[] | null;
  /** Suggestions for the text typed so far, best first. */
  suggest(lookup: Lookup, text: string): Promise<string[]>;
}

function shown(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** Draws a form of a command. Values are read when a button is pressed, checked by type. */
export function renderForm(into: HTMLElement, form: Form, env: FormEnv): void {
  const doc = into.ownerDocument;
  const f = form as FullForm;
  const fields = f.fields ?? [];
  const box = doc.createElement("form");
  box.className = "command-form";
  if (f.title) {
    const t = doc.createElement("h3");
    t.textContent = f.title;
    box.append(t);
  }
  const readers = new Map<string, () => unknown>();
  let nextId = 0;
  for (const field of fields) {
    if (field.widget === "hidden") {
      const v = shown(field.value);
      readers.set(field.name, () => (v === "" ? null : typedValue(field, v)));
      continue;
    }
    const id = `f${nextId++}-${field.name}`;
    const row = doc.createElement("div");
    row.className = "field";
    const label = doc.createElement("label");
    label.htmlFor = id;
    label.textContent = (field.label || field.name) + (field.required ? " *" : "");
    row.append(label);
    const start = shown(field.value);
    if (field.widget === "files") {
      const note = doc.createElement("p");
      note.className = "muted";
      note.textContent = "Attaching files is not offered over the web yet.";
      row.append(note);
      readers.set(field.name, () => null);
    } else if (field.type === "bool") {
      const c = doc.createElement("input");
      c.type = "checkbox";
      c.id = id;
      c.checked = start === "true";
      row.append(c);
      readers.set(field.name, () => c.checked);
    } else if (field.widget === "multiline" || field.type === "list" || field.type === "map" || field.type === "bytes") {
      const a = doc.createElement("textarea");
      a.id = id;
      a.rows = field.widget === "multiline" ? 12 : 3;
      a.value = start;
      row.append(a);
      // the text of a message is kept as typed: its line breaks and spaces are the message
      readers.set(field.name, () => {
        if (field.widget === "multiline") {
          if (a.value.trim() === "") {
            if (field.required) throw new Error(`${field.label || field.name} is needed.`);
            return null;
          }
          return a.value;
        }
        return typedValue(field, a.value);
      });
    } else {
      const i = doc.createElement("input");
      i.type = "text";
      i.id = id;
      i.value = start;
      i.autocomplete = "off";
      row.append(i);
      if (field.widget === "recipients" && f.lookup) {
        suggestions(i, f.lookup, env, doc, row);
      }
      readers.set(field.name, () => typedValue(field, i.value));
    }
    box.append(row);
  }
  const problem = doc.createElement("p");
  problem.className = "error";
  problem.setAttribute("role", "alert");
  const buttons = doc.createElement("div");
  buttons.className = "buttons";
  const add = (label: string, command: string, main: boolean) => {
    const b = doc.createElement("button");
    b.type = main ? "submit" : "button";
    b.textContent = label;
    const go = async () => {
      problem.textContent = "";
      let values: Record<string, unknown>;
      try {
        values = {};
        for (const [name, read] of readers) {
          const v = read();
          if (v !== null && v !== undefined) values[name] = v;
        }
      } catch (e) {
        problem.textContent = (e as Error).message;
        return;
      }
      if (!main) {
        // another button takes the same fields; a field that its command does not have is not sent
        const known = env.fieldsOf(command);
        if (known) for (const k of Object.keys(values)) if (!known.includes(k)) delete values[k];
      }
      b.disabled = true;
      try {
        const err = await env.submit(command, values, main ? (f.done ?? null) : null);
        if (err) problem.textContent = err;
      } finally {
        b.disabled = false;
      }
    };
    if (main) box.addEventListener("submit", (ev) => { ev.preventDefault(); void go(); });
    else b.addEventListener("click", () => void go());
    buttons.append(b);
  };
  add(f.submit || f.title || f.command, f.command, true);
  for (const o of f.others ?? []) add(o.label, o.command, false);
  box.append(buttons, problem);
  into.append(box);
}

/** Suggests addresses for the last entry of a comma separated list. */
function suggestions(input: HTMLInputElement, lookup: Lookup, env: FormEnv, doc: Document, row: HTMLElement): void {
  const list = doc.createElement("datalist");
  list.id = `${input.id}-suggestions`;
  input.setAttribute("list", list.id);
  row.append(list);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const cut = input.value.lastIndexOf(",");
    const prefix = cut < 0 ? "" : input.value.slice(0, cut + 1) + " ";
    const typed = input.value.slice(cut + 1).trim();
    if (typed.length < 2) {
      list.replaceChildren();
      return;
    }
    const mine = ++latest;
    timer = setTimeout(() => {
      env.suggest(lookup, typed).then(
        (items) => {
          if (mine !== latest) return;
          list.replaceChildren(
            ...items.slice(0, 20).map((s) => {
              const o = doc.createElement("option");
              o.value = prefix + s;
              return o;
            }),
          );
        },
        () => list.replaceChildren(),
      );
    }, 250);
  });
}
