import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/site/published-search.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ES2020,
  },
});
mkdirSync(new URL("../dist", import.meta.url), { recursive: true });
writeFileSync(new URL("../dist/search.js", import.meta.url), compiled.outputText);
copyFileSync(new URL("../site/index.html", import.meta.url), new URL("../dist/index.html", import.meta.url));
copyFileSync(new URL("../site/app.js", import.meta.url), new URL("../dist/app.js", import.meta.url));
copyFileSync(new URL("../site/styles.css", import.meta.url), new URL("../dist/styles.css", import.meta.url));
copyFileSync(new URL("../data/flights.json", import.meta.url), new URL("../dist/flights.json", import.meta.url));
copyFileSync(new URL("../dist/index.html", import.meta.url), new URL("../dist/404.html", import.meta.url));
console.log("Wrote dist/ for GitHub Pages.");
