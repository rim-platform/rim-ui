// Version-skew check: validates every GraphQL operation the client sends against the
// `schema.graphql` committed at a git ref, and lists the ones a server built from that ref
// would refuse.
//
//   npm run skew:check -- <git ref>   e.g. v0.3.0, origin/release, HEAD~30
//   npm run skew:check                the most recent v* tag
//
// Operations are the `gql` tagged templates under src/ (test files and fixtures excluded), with
// their `${FRAGMENT}` interpolations resolved through local constants and relative imports, as
// graphql-request concatenates them at runtime. Exit status: 0 when every operation validates
// (or there is no tag to check against), 1 when some would be refused, 2 when the check could
// not run.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSchema, parse, validate } from "graphql";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_DIR = join(ROOT, "src");
const EXTENSIONS = [".ts", ".tsx"];

class CheckError extends Error {}

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Source files the app ships: no tests, test helpers, fixtures or generated code. */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (["test", "__fixtures__", "__mocks__", "generated", "wasm"].includes(name)) return [];
      return sourceFiles(path);
    }
    if (!EXTENSIONS.some((ext) => name.endsWith(ext))) return [];
    if (/\.(test|spec)\.tsx?$/.test(name) || name.endsWith(".d.ts")) return [];
    return [path];
  });
}

/** The top-level constants and imports of one module, parsed on first use. */
const modules = new Map();

function moduleAt(path) {
  let mod = modules.get(path);
  if (mod) return mod;
  const text = readFileSync(path, "utf8");
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const constants = new Map();
  const imports = new Map();
  const reexports = new Map();
  const starExports = [];
  for (const statement of sf.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer) {
          constants.set(decl.name.text, decl.initializer);
        }
      }
    } else if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const from = statement.moduleSpecifier.text;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          imports.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
        }
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const from = statement.moduleSpecifier.text;
      if (!statement.exportClause) {
        starExports.push(from);
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const el of statement.exportClause.elements) {
          reexports.set(el.name.text, { from, name: (el.propertyName ?? el.name).text });
        }
      }
    }
  }
  mod = { path, sf, constants, imports, reexports, starExports };
  modules.set(path, mod);
  return mod;
}

/** The file a relative import points at, or null for a package import. */
function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function where(mod, node) {
  const { line } = mod.sf.getLineAndCharacterOfPosition(node.getStart(mod.sf));
  return `${relative(ROOT, mod.path)}:${line + 1}`;
}

/** The text `name` holds in `mod`, following imports and re-exports. */
function constantText(mod, name, seen) {
  const key = `${mod.path}#${name}`;
  if (seen.has(key)) throw new CheckError(`${relative(ROOT, mod.path)}: ${name} refers to itself`);
  seen = new Set(seen).add(key);

  const init = mod.constants.get(name);
  if (init) return expressionText(mod, init, seen);

  const link = mod.imports.get(name) ?? mod.reexports.get(name);
  if (link) {
    const target = resolveImport(mod.path, link.from);
    if (!target) {
      throw new CheckError(
        `${relative(ROOT, mod.path)}: ${name} comes from "${link.from}", which is not a file`,
      );
    }
    return constantText(moduleAt(target), link.name, seen);
  }

  for (const from of mod.starExports) {
    const target = resolveImport(mod.path, from);
    if (!target) continue;
    const found = moduleAt(target);
    if (found.constants.has(name) || found.imports.has(name) || found.reexports.has(name)) {
      return constantText(found, name, seen);
    }
  }
  throw new CheckError(`${relative(ROOT, mod.path)}: cannot resolve ${name}`);
}

/** The text a `gql` template, plain template or string literal evaluates to. */
function expressionText(mod, node, seen) {
  if (ts.isTaggedTemplateExpression(node)) return templateText(mod, node.template, seen);
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return templateText(mod, node, seen);
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    return expressionText(mod, node.expression, seen);
  }
  throw new CheckError(`${where(mod, node)}: cannot read ${node.getText(mod.sf)} as text`);
}

function templateText(mod, template, seen) {
  if (ts.isNoSubstitutionTemplateLiteral(template)) return template.text;
  let text = template.head.text;
  for (const span of template.templateSpans) {
    if (!ts.isIdentifier(span.expression)) {
      throw new CheckError(
        `${where(mod, span.expression)}: cannot resolve \${${span.expression.getText(mod.sf)}}`,
      );
    }
    text += constantText(mod, span.expression.text, seen);
    text += span.literal.text;
  }
  return text;
}

/** Every `gql` document under src/, resolved to the text the client sends. */
function collectDocuments() {
  const documents = [];
  for (const path of sourceFiles(SOURCE_DIR)) {
    const mod = moduleAt(path);
    const visit = (node) => {
      if (
        ts.isTaggedTemplateExpression(node) &&
        ts.isIdentifier(node.tag) &&
        node.tag.text === "gql"
      ) {
        const { line } = mod.sf.getLineAndCharacterOfPosition(node.getStart(mod.sf));
        documents.push({
          file: relative(ROOT, path),
          line: line + 1,
          text: templateText(mod, node.template, new Set()),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(mod.sf);
  }
  return documents;
}

function operationLabel(doc) {
  const ops = doc.definitions.filter((d) => d.kind === "OperationDefinition");
  return ops.map((op) => `${op.operation} ${op.name?.value ?? "(anonymous)"}`).join(", ");
}

function defaultRef() {
  try {
    return git(["describe", "--tags", "--abbrev=0", "--match", "v*"]).trim();
  } catch {
    return null;
  }
}

function schemaAt(ref) {
  let commit;
  try {
    commit = git(["rev-parse", "--short", "--verify", `${ref}^{commit}`]).trim();
  } catch {
    throw new CheckError(`"${ref}" is not a commit, tag or branch in this repository`);
  }
  let sdl;
  try {
    sdl = git(["show", `${commit}:schema.graphql`]);
  } catch {
    throw new CheckError(`there is no schema.graphql at ${ref} (${commit})`);
  }
  try {
    return { commit, schema: buildSchema(sdl) };
  } catch (err) {
    throw new CheckError(`schema.graphql at ${ref} does not build: ${err.message}`);
  }
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let ref = args[0];
  if (!ref) {
    ref = defaultRef();
    if (!ref) {
      console.log("No v* tag to check against yet. Pass the server's ref instead:");
      console.log("  npm run skew:check -- <git ref>   e.g. v0.3.0, origin/release, HEAD~30");
      return 0;
    }
  }

  const { commit, schema } = schemaAt(ref);
  const documents = collectDocuments();
  const failures = new Map();
  let operations = 0;

  for (const document of documents) {
    let doc;
    try {
      doc = parse(document.text);
    } catch (err) {
      operations += 1;
      const list = failures.get(document.file) ?? [];
      list.push({ line: document.line, label: "(does not parse)", errors: [err.message] });
      failures.set(document.file, list);
      continue;
    }
    if (!doc.definitions.some((d) => d.kind === "OperationDefinition")) continue;
    operations += 1;
    const errors = validate(schema, doc);
    if (errors.length === 0) continue;
    const list = failures.get(document.file) ?? [];
    list.push({
      line: document.line,
      label: operationLabel(doc),
      errors: [...new Set(errors.map((e) => e.message))],
    });
    failures.set(document.file, list);
  }

  console.log(`Checked ${operations} operations against schema.graphql at ${ref} (${commit}).`);
  if (failures.size === 0) {
    console.log("A server at that version accepts all of them.");
    return 0;
  }

  let refused = 0;
  for (const file of [...failures.keys()].sort()) {
    console.log(`\n${file}`);
    for (const failure of failures.get(file)) {
      refused += 1;
      console.log(`  ${failure.label} (line ${failure.line})`);
      for (const message of failure.errors) console.log(`    - ${message}`);
    }
  }
  console.log(`\n${refused} of ${operations} operations would be refused by a server at ${ref}.`);
  return 1;
}

try {
  process.exitCode = main();
} catch (err) {
  if (!(err instanceof CheckError)) throw err;
  console.error(`skew:check: ${err.message}`);
  process.exitCode = 2;
}
