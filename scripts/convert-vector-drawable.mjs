#!/usr/bin/env node
/**
 * Mechanical converter: Android VectorDrawable XML -> plain SVG.
 *
 * This performs a 1:1 structural conversion (same path data, same fill
 * colors, same viewport) with no redesign, matching the policy already
 * documented in public/assets/apk/resource-map.json. It never touches the
 * original APK resource files; it only reads them and writes a new .svg
 * file at the destination path given on the command line.
 *
 * Usage:
 *   node scripts/convert-vector-drawable.mjs <input.xml> <output.svg>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [, , inputPath, outputPath] = process.argv;

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/convert-vector-drawable.mjs <input.xml> <output.svg>");
  process.exit(1);
}

const xml = readFileSync(inputPath, "utf8");

function attr(tag, name) {
  const match = tag.match(new RegExp(`android:${name}="([^"]*)"`));
  return match ? match[1] : undefined;
}

const vectorTagMatch = xml.match(/<vector\b[\s\S]*?>/);
if (!vectorTagMatch) {
  console.error("No <vector> root element found in", inputPath);
  process.exit(1);
}
const vectorTag = vectorTagMatch[0];

const viewportWidth = attr(vectorTag, "viewportWidth") ?? attr(vectorTag, "width").replace("dp", "");
const viewportHeight = attr(vectorTag, "viewportHeight") ?? attr(vectorTag, "height").replace("dp", "");
const widthDp = (attr(vectorTag, "width") ?? `${viewportWidth}dp`).replace("dp", "");
const heightDp = (attr(vectorTag, "height") ?? `${viewportHeight}dp`).replace("dp", "");

const pathRegex = /<path\b([\s\S]*?)\/>/g;
const paths = [];
let pathMatch;
while ((pathMatch = pathRegex.exec(xml))) {
  const pathTag = pathMatch[1];
  const d = attr(pathTag, "pathData");
  if (!d) continue;
  const fill = attr(pathTag, "fillColor");
  const fillType = attr(pathTag, "fillType");
  const strokeColor = attr(pathTag, "strokeColor");
  const strokeWidth = attr(pathTag, "strokeWidth");

  const svgAttrs = [`d="${d}"`];
  svgAttrs.push(`fill="${fill && fill !== "#00000000" ? fill : "none"}"`);
  if (fillType === "evenOdd") svgAttrs.push(`fill-rule="evenOdd"`);
  if (strokeColor && strokeColor !== "#00000000") {
    svgAttrs.push(`stroke="${strokeColor}"`);
    if (strokeWidth) svgAttrs.push(`stroke-width="${strokeWidth}"`);
  }
  paths.push(`<path ${svgAttrs.join(" ")}/>`);
}

if (paths.length === 0) {
  console.error("No <path> elements with pathData found in", inputPath);
  process.exit(1);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthDp}" height="${heightDp}" viewBox="0 0 ${viewportWidth} ${viewportHeight}">${paths.join("")}</svg>\n`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, svg, "utf8");
console.log(`Converted ${paths.length} path(s): ${inputPath} -> ${outputPath}`);
