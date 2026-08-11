import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import process from "node:process";

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("Uso: node scripts/verify-public-build.mjs <directorio-publico> [...]");
  process.exit(2);
}

const findings = [];
let javascriptFiles = 0;

function inspectDirectory(input) {
  const root = resolve(input);
  if (!existsSync(root)) {
    findings.push({ file: input, rule: "missing-public-build" });
    return;
  }

  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current)) {
      const absolute = join(current, entry);
      if (statSync(absolute).isDirectory()) {
        pending.push(absolute);
        continue;
      }

      const file = relative(process.cwd(), absolute).replaceAll("\\", "/");
      const extension = extname(entry).toLowerCase();
      if (extension === ".map") {
        findings.push({ file, rule: "source-map-published" });
        continue;
      }
      if (!new Set([".js", ".mjs", ".css", ".html"]).has(extension)) continue;
      if (extension === ".js" || extension === ".mjs") javascriptFiles += 1;

      const content = readFileSync(absolute, "utf8");
      const checks = [
        ["source-map-reference", /sourceMappingURL\s*=/u],
        ["webpack-source-path", /webpack:\/\//u],
        ["local-windows-path", /[A-Za-z]:[\\/]+Users[\\/]+/u],
        // Turbopack 16.3 emits `file:///ROOT/` as a virtual runtime identifier.
        // It is not a filesystem path and contains no developer-machine data.
        ["local-file-url", /file:\/\/\/(?!ROOT(?:\/|["'`]))/u],
      ];
      for (const [rule, pattern] of checks) {
        if (pattern.test(content)) findings.push({ file, rule });
      }
    }
  }
}

for (const root of roots) inspectDirectory(root);
if (javascriptFiles === 0) {
  findings.push({ file: roots.join(","), rule: "javascript-bundle-missing" });
}

if (findings.length > 0) {
  console.error("El build público contiene artefactos que no deben publicarse:");
  for (const finding of findings) {
    console.error(`- ${finding.file} [${finding.rule}]`);
  }
  process.exit(1);
}

console.log(
  `Public build verification passed (${javascriptFiles} JavaScript bundles, no source maps or local paths).`,
);
