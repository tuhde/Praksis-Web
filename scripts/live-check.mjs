// Checks the page's code against a running daemon, without a browser: logs in, lists the views,
// resolves each one, draws it into a DOM (jsdom), selects the first row that can be selected and
// starts the first button with a command. Usage: node scripts/live-check.mjs URL TOKEN
import { JSDOM } from "jsdom";
import { Client, normaliseBase } from "../dist/api.js";
import { runCommand, describe } from "../dist/commands.js";
import { renderComponents } from "../dist/view.js";

const [url, token] = process.argv.slice(2);
const client = new Client(normaliseBase(url), token);
const out = [];
const status = await client.call({ op: "status" });
out.push(`status: ${status.rules} rules`);
const views = (await client.call({ op: "views" })).views;
out.push(`views: ${views.map((v) => v.id).join(",")}`);
for (const v of views) {
  let r = await client.call({ op: "view", view: v.id, params: {}, maxSchema: 1 });
  const dom = new JSDOM("<!doctype html><div id=r></div>");
  const root = dom.window.document.getElementById("r");
  const picked = [];
  const ran = [];
  const handlers = { select: (s) => picked.push(s), run: (a) => ran.push(a), form: () => {} };
  renderComponents(root, r.components, handlers);
  out.push(`view ${v.id}: ${root.querySelectorAll("tr").length} table rows, text: ${root.textContent.slice(0, 60).replace(/\s+/g, " ")}`);
  const first = root.querySelector("tbody tr.clickable");
  if (first) {
    first.click();
    const sel = picked[0];
    out.push(`selected ${sel.param}=${String(sel.value).slice(-12)}`);
    r = await client.call({ op: "view", view: v.id, params: { [sel.param]: sel.value }, maxSchema: 1 });
    const again = new JSDOM("<!doctype html><div id=r></div>").window.document.getElementById("r");
    renderComponents(again, r.components, { ...handlers, run: (a) => ran.push(a) });
    const buttons = [...again.querySelectorAll("button")].filter((b) => !b.disabled && /Archive the selected/.test(b.textContent));
    buttons[0]?.click();
    if (ran[0]?.command) {
      const o = await runCommand(client, ran[0].command, ran[0].args ?? {});
      out.push(`command ${ran[0].command}: ${describe(o).join(" | ")}`);
    }
  }
}
console.log(out.join("\n"));
