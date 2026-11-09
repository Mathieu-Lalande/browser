#!/usr/bin/env node
/**
 * `npm run check:i18n` (ADR-052): flags French-looking text hard-coded in UI code instead of
 * going through the catalogs (`src/shared/i18n/fr.ts` / `en.ts`). Heuristic: string literals,
 * template literals, JSX text and Svelte markup containing French accented characters or
 * common French words. Comments, the catalogs and tests are skipped.
 *
 * Escape hatches, for text that must stay French (data matched against pages, parsing words…):
 * `// i18n-ignore` on the line or the line above, or `i18n-ignore-file` in a file comment.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parse as parseSvelte } from "svelte/compiler";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["src/main", "src/renderer/src", "src/shared", "src/preload", "mobile/src"];
const SKIP_DIRS = new Set(["node_modules", "i18n", "generated", "__snapshots__"]);
const SKIP_FILE = /\.(test|spec)\.tsx?$|\.d\.ts$|readability-source\.ts$/;

const ACCENT = /[àâçéèêëîïôûùœÀÂÇÉÈÊËÎÔÛŒ«»]/;
const STRONG = /\b(vous|votre|vos|onglets?|fenêtres?|paramètres|réglages|aucune?|cette|supprimer|enregistrer|afficher|masquer|annuler|fermer|ouvrir|rechercher|ajouter|retirer|désactivé|activé|impossible de|n'est|n'a|d'un|d'une|l'onglet|l'adresse|la page)\b/i;
const COMMON = /\b(le|la|les|des|du|une|et|est|pour|avec|dans|sur|pas|par|aux|qui|que|ou|en|au|un|de)\b/g;

function looksFrench(text) {
  const plain = text.replace(/\{[^{}]*\}/g, " ");
  if (!/[A-Za-zÀ-ÿ]{2}/.test(plain)) return false;
  if (ACCENT.test(plain) || STRONG.test(plain)) return true;
  return (plain.match(COMMON) ?? []).length >= 3;
}

const findings = [];

function ignoredLine(lines, line) {
  return /i18n-ignore\b/.test(lines[line] ?? "") || /i18n-ignore\b/.test(lines[line - 1] ?? "");
}

function report(file, source, lines, offset, text) {
  const line = source.slice(0, offset).split("\n").length - 1;
  if (ignoredLine(lines, line)) return;
  findings.push(`${file}:${line + 1}: ${JSON.stringify(text.length > 90 ? text.slice(0, 87) + "…" : text)}`);
}

function checkTs(file, source, lines) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    if (ts.isCallExpression(node) && /^console\./.test(node.expression.getText(sf))) return;
    let text = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" {} ");
    else if (ts.isJsxText(node)) text = node.getText(sf);
    if (text !== null && looksFrench(text)) report(file, source, lines, node.getStart(sf), text.trim());
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function checkSvelte(file, source, lines) {
  const scripts = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = scripts.exec(source))) {
    const start = match.index + match[0].indexOf(">") + 1;
    // Same offsets as the whole file: pad the script with the preceding text's newlines.
    const padded = source.slice(0, start).replace(/[^\n]/g, " ") + match[1];
    checkTs(file + ".ts", padded, lines);
  }
  const ast = parseSvelte(source, { modern: true });
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === "Comment" || node.type === "StyleSheet") return;
    if (node.type === "Text" && looksFrench(node.data)) report(file, source, lines, node.start, node.data.trim());
    if (node.type === "Literal" && typeof node.value === "string" && looksFrench(node.value)) report(file, source, lines, node.start, node.value);
    if (node.type === "TemplateElement" && looksFrench(node.value.cooked ?? "")) report(file, source, lines, node.start, node.value.cooked);
    for (const key of Object.keys(node)) {
      if (key === "metadata" || key === "loc" || key === "instance" || key === "module" || key === "css") continue;
      walk(node[key]);
    }
  };
  walk(ast.fragment);
}

function visitDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) visitDir(full);
      continue;
    }
    if (!/\.(ts|tsx|svelte)$/.test(entry.name) || SKIP_FILE.test(entry.name)) continue;
    const source = fs.readFileSync(full, "utf8");
    if (/i18n-ignore-file/.test(source)) continue;
    const file = path.relative(ROOT, full);
    const lines = source.split("\n");
    if (entry.name.endsWith(".svelte")) checkSvelte(file, source, lines);
    else checkTs(file, source, lines);
  }
}

for (const dir of DIRS) if (fs.existsSync(path.join(ROOT, dir))) visitDir(path.join(ROOT, dir));

for (const finding of findings) console.log(finding.replace(/\.svelte\.ts:/, ".svelte:"));
if (findings.length) {
  console.error(`\n${findings.length} hard-coded French text(s): move them to src/shared/i18n (fr.ts + en.ts) and use t("key"), or mark data with // i18n-ignore.`);
  process.exit(1);
}
console.log("check:i18n: no hard-coded French UI text.");
