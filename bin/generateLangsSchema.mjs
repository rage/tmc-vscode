// Generates the zod v4 schemas and their public aliases for the tmc-langs-cli
// stdout contract, from the vendored JSON Schema artifact.
//
// Pipeline:
//   shared/bindings.schema.json  (re-vendor with `npm run vendor:langs-schema`)
//     -> minimal OpenAPI 3.1 doc (this script, generic transforms only)
//     -> @hey-api/openapi-ts (zod plugin)  -> shared/generated/langs/zod.gen.ts
//     -> public aliases (this script)      -> shared/generated/langs/index.ts
//
// shared/langsSchema.ts re-exports index.ts and adds only the schemas that carry
// a client-side decision, so a new CLI type cannot be silently left out.
//
// Run via `npm run generate:langs-schema`. Generated files are committed; CI
// re-runs this and diffs shared/generated to catch drift.
//
// Transforms are generic (no type-specific hacks):
//   1. #/$defs/X -> #/components/schemas/X
//   2. $ref with siblings -> allOf: [{$ref}] + siblings. Codegen drops $ref
//      siblings but honors allOf, which keeps the tagged-enum discriminators.
//   3. strip `format: "date-time"`: generated validators accept only Z-suffixed
//      ISO, but real TMC timestamps carry +03:00 offsets.
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

walk(root, (n) => {
  if (typeof n.$ref === "string" && n.$ref.startsWith("#/$defs/")) {
    n.$ref = "#/components/schemas/" + n.$ref.slice("#/$defs/".length)
  }
})
walk(root, (n) => {
  if (typeof n.$ref === "string" && Object.keys(n).length > 1) {
    const ref = n.$ref
    delete n.$ref
    n.allOf = [...(n.allOf ?? []), { $ref: ref }]
  }
})
walk(root, (n) => {
  if (n.format === "date-time") {
    delete n.format
  }
})
// 4. Replace boolean-`true` subschemas with `{}`. schemars emits `true` for required
//    `serde_json::Value` fields and the zod generator silently drops such properties;
//    `{}` yields `z.unknown()` and keeps the key. Boolean keywords (uniqueItems, ...)
//    are left alone.
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

// Empty `paths` avoids dummy endpoint/client artifacts (ClientOptions, ReadCliOutput*).
const doc = {
  openapi: "3.1.1",
  info: { title: "tmc-langs-cli stdout contract", version: "0.0.0" },
  paths: {},
  components: { schemas: { ...defs, CliOutput: root } },
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "langs-openapi-"))
const openapiPath = path.join(tmpDir, "langs.openapi.json")
fs.writeFileSync(openapiPath, JSON.stringify(doc, null, 2) + "\n")

// Not the node_modules/.bin shim: on Windows it is a `.cmd`/`.ps1` pair execFileSync
// cannot spawn. Only package.json is exported, hence the bin path from the manifest.
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

// `CliOutput` and `MoocOldSubmissionRestore` are hand-written in shared/langsSchema.ts
// (preprocess step; a caveat the Rust docs lack). The numbered `StatusUpdate*` are
// schemars' monomorphizations that `zStatusUpdateData` already unions.
const notAliased = new Set([
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
for (const name of notAliased) {
  if (!generatedNames.has(name)) {
    throw new Error(
      `z${name} is no longer generated; drop it from notAliased in ${import.meta.filename}`,
    )
  }
}

const aliases = generated.filter((schema) => !notAliased.has(schema.name))
aliases.sort((a, b) => a.name.localeCompare(b.name))

// A name exported from both files resolves to the shim's copy under `export *`.
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
      "Remove the hand-written export, or add the name to notAliased here.",
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
