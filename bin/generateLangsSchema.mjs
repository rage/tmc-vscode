// Generates the zod v4 schemas and their public aliases for the tmc-langs-cli
// stdout contract, from the vendored JSON Schema artifact.
//
// Pipeline:
//   shared/bindings.schema.json  (schemars, serialize contract; re-vendor with
//                                 bin/updateLangsSchema.sh)
//     -> minimal OpenAPI 3.1 doc (this script, generic transforms only)
//     -> @hey-api/openapi-ts (zod plugin)  -> shared/generated/langs/zod.gen.ts
//     -> public aliases (this script)      -> shared/generated/langs/index.ts
//
// shared/langsSchema.ts re-exports index.ts and adds the handful of schemas
// that carry a client-side decision. Everything else reaches consumers without
// anyone editing that file, so a new CLI type cannot be silently left out.
//
// Run via `npm run generate:langs-schema`. This script only regenerates from
// the already-vendored shared/bindings.schema.json -- it does not re-vendor
// (use `npm run vendor:langs-schema` for that, which needs a local
// tmc-langs-rust checkout). The generated files are committed; a CI step
// re-runs this script and diffs shared/generated to catch drift (see
// .github/workflows/test.yml).
//
// The transforms applied to the JSON Schema are all GENERIC (no
// type-specific hacks):
//   1. #/$defs/X  ->  #/components/schemas/X   (OpenAPI component refs)
//   2. "$ref with sibling keywords"  ->  "allOf: [{$ref}] + siblings".
//      Semantics-preserving in JSON Schema 2020-12 (siblings of $ref are
//      ANDed), but codegen tools reliably honor allOf while dropping $ref
//      siblings -- this is what keeps the internally-tagged-enum discriminators
//      (output-kind / output-data-kind / update-data-kind) intact.
//   3. strip `format: "date-time"` -- generated validators map it to Z-only ISO
//      datetime, but real TMC timestamps carry +03:00 offsets, so timestamps
//      are validated as plain strings instead.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

const require = createRequire(import.meta.url)

const repoRoot = path.resolve(import.meta.dirname, "..")
const schemaPath = path.join(repoRoot, "shared", "bindings.schema.json")
const outDir = path.join(repoRoot, "shared", "generated", "langs")

const root = JSON.parse(fs.readFileSync(schemaPath, "utf8"))

function walk(node, fn) {
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, fn))
    return
  }
  if (node && typeof node === "object") {
    fn(node)
    for (const v of Object.values(node)) {
      walk(v, fn)
    }
  }
}

// 1. #/$defs/X -> #/components/schemas/X
walk(root, (n) => {
  if (typeof n.$ref === "string" && n.$ref.startsWith("#/$defs/")) {
    n.$ref = "#/components/schemas/" + n.$ref.slice("#/$defs/".length)
  }
})
// 2. $ref with siblings -> allOf
walk(root, (n) => {
  if (typeof n.$ref === "string" && Object.keys(n).length > 1) {
    const ref = n.$ref
    delete n.$ref
    n.allOf = [...(n.allOf ?? []), { $ref: ref }]
  }
})
// 3. strip date-time formats
walk(root, (n) => {
  if (n.format === "date-time") {
    delete n.format
  }
})
// 4. materialize boolean-`true` subschemas sitting in schema positions.
//    JSON Schema allows `true` (accept-anything) as a subschema, and schemars
//    emits it for any-typed but REQUIRED `serde_json::Value` fields (e.g. the
//    grading status' `feedback_json`, the `token` output-data). The zod
//    generator silently DROPS such properties -- so a required key vanishes from
//    both the generated type and the validation. Replacing `true` with the
//    equivalent empty object schema `{}` makes the generator emit `z.unknown()`
//    (same as it already does for `additionalProperties: true`), preserving the
//    key. Only boolean schemas in real schema positions are touched; boolean
//    KEYWORDS (uniqueItems, readOnly, ...) are left alone.
const SCHEMA_MAP_KEYWORDS = ["properties", "patternProperties", "$defs", "definitions"]
const SCHEMA_SINGLE_KEYWORDS = [
  "additionalProperties",
  "items",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "contains",
]
const SCHEMA_LIST_KEYWORDS = ["allOf", "anyOf", "oneOf", "prefixItems"]
walk(root, (n) => {
  for (const kw of SCHEMA_MAP_KEYWORDS) {
    const map = n[kw]
    if (map && typeof map === "object" && !Array.isArray(map)) {
      for (const key of Object.keys(map)) {
        if (map[key] === true) {
          map[key] = {}
        }
      }
    }
  }
  for (const kw of SCHEMA_SINGLE_KEYWORDS) {
    if (n[kw] === true) {
      n[kw] = {}
    }
  }
  for (const kw of SCHEMA_LIST_KEYWORDS) {
    const list = n[kw]
    if (Array.isArray(list)) {
      for (let i = 0; i < list.length; i++) {
        if (list[i] === true) {
          list[i] = {}
        }
      }
    }
  }
})

const defs = root.$defs ?? {}
delete root.$defs
delete root.$schema

// Components-only doc (empty paths): keeps generation to the schema types and
// avoids emitting dummy endpoint/client artifacts (ClientOptions, ReadCliOutput*).
const doc = {
  openapi: "3.1.1",
  info: { title: "tmc-langs-cli stdout contract", version: "0.0.0" },
  paths: {},
  components: { schemas: { ...defs, CliOutput: root } },
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "langs-openapi-"))
const openapiPath = path.join(tmpDir, "langs.openapi.json")
fs.writeFileSync(openapiPath, JSON.stringify(doc, null, 2) + "\n")

// The package's own entry point, run through this Node, rather than the
// node_modules/.bin shim: on Windows that shim is a `.cmd`/`.ps1` pair that
// execFileSync cannot spawn. Only package.json is exported, so the bin path
// comes from the manifest instead of being spelled out here.
const openapiTsManifest = require.resolve("@hey-api/openapi-ts/package.json")
const openapiTsBin = path.resolve(
  path.dirname(openapiTsManifest),
  JSON.parse(fs.readFileSync(openapiTsManifest, "utf8")).bin["openapi-ts"],
)
try {
  execFileSync(process.execPath, [openapiTsBin, "-i", openapiPath, "-o", outDir, "-p", "zod"], {
    stdio: "inherit",
    cwd: repoRoot,
  })
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

// Schemas shared/langsSchema.ts defines itself, so the alias file must leave
// them alone: re-exporting them here too would shadow the hand-written ones
// silently. `CliOutput` is wrapped in a preprocess step there,
// `MoocOldSubmissionRestore` carries a caveat the Rust doc comment does not,
// and the numbered `StatusUpdate*` are schemars' monomorphizations of the Rust
// generic, which `zStatusUpdateData` already unions and which the shim exports
// as a generic interface instead.
const shimOwned = new Set([
  "CliOutput",
  "MoocOldSubmissionRestore",
  "StatusUpdate",
  "StatusUpdate2",
  "StatusUpdate3",
  "StatusUpdate4",
])

const zodPath = path.join(outDir, "zod.gen.ts")
const zodSource = fs.readFileSync(zodPath, "utf8")
const generated = [
  ...zodSource.matchAll(/(\/\*\*[\s\S]*?\*\/\n)?export const z([A-Za-z0-9_]+) = /g),
].map((match) => ({ doc: match[1] ?? "", name: match[2] }))
if (generated.length === 0) {
  throw new Error(`No zod schemas found in ${zodPath}`)
}

const generatedNames = new Set(generated.map((schema) => schema.name))
for (const name of shimOwned) {
  if (!generatedNames.has(name)) {
    throw new Error(
      `z${name} is no longer generated; drop it from shimOwned in ${import.meta.filename}`,
    )
  }
}

const aliases = generated.filter((schema) => !shimOwned.has(schema.name))
aliases.sort((a, b) => a.name.localeCompare(b.name))

// A name exported from both files would resolve to the shim's copy under
// `export *`, quietly turning a generated schema into a hand-written one.
const shimSource = fs.readFileSync(path.join(repoRoot, "shared", "langsSchema.ts"), "utf8")
const shimExports = new Set(
  [...shimSource.matchAll(/^export (?:const|type|interface|function|class) ([A-Za-z0-9_]+)/gm)].map(
    (match) => match[1],
  ),
)
const shadowed = aliases.map((schema) => schema.name).filter((name) => shimExports.has(name))
if (shadowed.length > 0) {
  throw new Error(
    `shared/langsSchema.ts re-declares generated schema(s): ${shadowed.join(", ")}. ` +
      "Remove the hand-written export, or add the name to shimOwned here.",
  )
}

const indexSource = [
  "// This file is generated by bin/generateLangsSchema.mjs. Do not edit.\n",
  "\nimport * as z from 'zod';\n",
  `\nimport {\n${aliases.map((schema) => `    z${schema.name},`).join("\n")}\n} from './zod.gen';\n`,
  ...aliases.map(
    (schema) =>
      `\n${schema.doc}export const ${schema.name} = z${schema.name};\n` +
      `export type ${schema.name} = z.infer<typeof ${schema.name}>;\n`,
  ),
].join("")
fs.writeFileSync(path.join(outDir, "index.ts"), indexSource)

console.log(
  `Generated ${generated.length} zod schemas and ${aliases.length} public aliases into ${path.relative(repoRoot, outDir)}`,
)
