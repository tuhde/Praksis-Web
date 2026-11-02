// Copies the files that need no compiling next to the compiled ones.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("dist", { recursive: true });
for (const f of ["index.html", "style.css"]) copyFileSync(`src/${f}`, `dist/${f}`);
