import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, relative } from "node:path";
import process from "node:process";

const root = process.cwd();
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
).split("\0").filter(Boolean);

const textExtensions = new Set([
  ".cjs", ".css", ".env", ".html", ".js", ".json", ".jsx", ".md", ".mjs",
  ".sql", ".svg", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);
const skippedPrefixes = ["node_modules/", "dist/", ".next/", ".vinext/", ".wrangler/"];
const forbiddenNames = [
  /(^|\/)\.env(?:\..+)?$/u,
  /\.(?:bak|backup|old|orig|p12|pfx|jks|keystore|pem|key|zip)$/iu,
  /\.map$/iu,
];
const contentRules = [
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/u },
  { id: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/u },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u },
  { id: "telegram-bot-token", pattern: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/u },
  {
    id: "hardcoded-sensitive-env",
    pattern: /\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)\b\s*[:=]\s*["'][^"'\s]{8,}["']/u,
  },
];

const findings = [];
for (const file of files) {
  const normalized = file.replaceAll("\\", "/");
  if (skippedPrefixes.some((prefix) => normalized.startsWith(prefix))) continue;

  if (
    forbiddenNames.some((pattern) => pattern.test(normalized))
    && normalized !== ".env.example"
  ) {
    findings.push({ file: normalized, line: 1, rule: "forbidden-artifact" });
    continue;
  }
  if (!textExtensions.has(extname(normalized).toLowerCase()) && normalized !== ".env.example") continue;

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\0")) continue;
  const lines = content.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    for (const rule of contentRules) {
      if (rule.pattern.test(lines[index])) {
        findings.push({
          file: relative(root, file).replaceAll("\\", "/"),
          line: index + 1,
          rule: rule.id,
        });
      }
    }
  }
}

if (findings.length > 0) {
  console.error("Security scan rejected possible secret or publishable artifact:");
  for (const finding of findings) {
    // Nunca se imprime el contenido coincidente.
    console.error(`- ${finding.file}:${finding.line} [${finding.rule}]`);
  }
  process.exitCode = 1;
} else {
  console.log(`Security scan passed (${files.length} repository files inspected).`);
}

