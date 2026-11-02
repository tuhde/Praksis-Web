// SPDX-License-Identifier: Apache-2.0
import type { Client } from "./api.js";

export interface OutcomeLine { outcome: string; actionId?: string | null; message: string }
export interface Outcome { done: boolean; lines: OutcomeLine[] }

/** The value of a field of the given type from what was typed; null if empty and optional. */
export function typedValue(field: { name: string; type: string; required?: boolean; label?: string | null }, raw: string): unknown {
  const text = raw.trim();
  const name = field.label || field.name;
  if (text === "") {
    if (field.required) throw new Error(`${name} is needed.`);
    return null;
  }
  switch (field.type) {
    case "int": {
      if (!/^[+-]?\d+$/.test(text)) throw new Error(`${name} must be a whole number.`);
      const n = Number(text);
      if (!Number.isSafeInteger(n)) throw new Error(`${name} is too large.`);
      return n;
    }
    case "double": {
      const n = Number(text);
      if (!Number.isFinite(n)) throw new Error(`${name} must be a number.`);
      return n;
    }
    case "timestamp": {
      const d = new Date(text);
      if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || Number.isNaN(d.getTime())) {
        throw new Error(`${name} must be a time like 2026-01-31T10:00:00Z.`);
      }
      return d.toISOString();
    }
    case "bytes":
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) throw new Error(`${name} must be Base64.`);
      return text;
    case "list":
    case "map": {
      let v: unknown;
      try {
        v = JSON.parse(text);
      } catch {
        throw new Error(`${name} is not valid JSON.`);
      }
      if (field.type === "list" ? !Array.isArray(v) : typeof v !== "object" || v === null || Array.isArray(v)) {
        throw new Error(field.type === "list" ? `${name} must be a list, like ["a", "b"].` : `${name} must be a map, like {"key": "value"}.`);
      }
      return v;
    }
    default:
      return text;
  }
}

/** Whether every step worked; a step left out because its condition is false is no failure. */
export function succeeded(o: Outcome): boolean {
  return o.lines.every((l) => l.outcome === "OK" || (l.outcome === "SKIPPED" && !!l.actionId));
}

/** The steps of a result, one line each. */
export function describe(o: Outcome): string[] {
  if (o.lines.length === 0) return ["(nothing was done)"];
  return o.lines.map((l) => `${l.outcome}  ${l.actionId ? `${l.actionId}: ` : ""}${l.message}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Starts a command and waits for what became of it. */
export async function runCommand(
  client: Client,
  command: string,
  args: Record<string, unknown>,
  waitMillis = 30000,
  pause = 200,
): Promise<Outcome> {
  const started = await client.call({ op: "run-command", command, args, client: "praksis-web" });
  const event = started["event"];
  if (typeof event !== "string") throw new Error("the daemon answered with something unexpected");
  const end = Date.now() + waitMillis;
  for (;;) {
    const r = (await client.call({ op: "outcome", event })) as unknown as Outcome & { type: string };
    if (r.done) return { done: true, lines: Array.isArray(r.lines) ? r.lines : [] };
    if (Date.now() > end) throw new Error("The command is still running; see the log.");
    await sleep(pause);
  }
}
