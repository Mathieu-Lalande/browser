// Fails when the main process (src/main) has an import cycle. Dependency-free (TypeScript's own parser).
// Type-only imports are ignored (`import type …`, or every specifier marked `type`): they are erased
// at build time, like madge's `detectiveOptions.ts.skipTypeImports`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(root, "src", "main");

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

function resolveImport(from, spec) {
  if (!spec.startsWith(".")) return null;
  const target = resolve(dirname(from), spec);
  for (const candidate of [target, `${target}.ts`, join(target, "index.ts")]) {
    if (candidate.endsWith(".ts") && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function typeOnly(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    const named = clause.namedBindings;
    return !clause.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly);
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return true;
    const clause = node.exportClause;
    return !!clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly);
  }
  return false;
}

function importsOf(file) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const specs = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!typeOnly(node)) specs.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteral(arg)) specs.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(specs.map((spec) => resolveImport(file, spec)).filter(Boolean))];
}

const graph = new Map(sources(base).map((file) => [file, importsOf(file)]));
const state = new Map(); // file -> "visiting" | "done"
const stack = [];
const cycles = [];

function walk(file) {
  state.set(file, "visiting");
  stack.push(file);
  for (const next of graph.get(file) ?? []) {
    if (state.get(next) === "visiting") cycles.push([...stack.slice(stack.indexOf(next)), next]);
    else if (!state.has(next)) walk(next);
  }
  stack.pop();
  state.set(file, "done");
}
for (const file of graph.keys()) if (!state.has(file)) walk(file);

if (cycles.length) {
  console.error(`Import cycles in src/main (${cycles.length}):`);
  for (const cycle of cycles) console.error(`  ${cycle.map((f) => relative(base, f)).join(" > ")}`);
  process.exit(1);
}
console.log(`No import cycle in src/main (${graph.size} modules).`);
