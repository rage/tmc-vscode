// Generates the zod v4 schemas + TypeScript types for the tmc-langs-cli stdout
// contract from the vendored JSON Schema artifact.
//
// Pipeline:
//   shared/bindings.schema.json  (schemars, serialize contract; re-vendor with
//                                 bin/updateLangsSchema.sh)
//     -> minimal OpenAPI 3.1 doc (this script, generic transforms only)
//     -> @hey-api/openapi-ts (zod + @hey-api/typescript plugins)
//     -> shared/generated/langs/{zod.gen.ts, types.gen.ts, index.ts}
//
// shared/langsSchema.ts is a thin shim re-exporting the generated output under
// the stable public names consumers import.
//
// Run via `npm run generate:langs-schema`. This script only regenerates from
// the already-vendored shared/bindings.schema.json -- it does not re-vendor
// (use `npm run vendor:langs-schema` for that, which needs a local
// tmc-langs-rust checkout). The generated files are committed; a CI step
// re-runs this script and diffs shared/generated + shared/bindings.schema.json
// to catch drift (see .github/workflows/test.yml).
//
// The three transforms applied to the JSON Schema are all GENERIC (no
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
import os from "node:os"
import path from "node:path"

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

const openapiTsBin = path.join(repoRoot, "node_modules", ".bin", "openapi-ts")
try {
  execFileSync(
    openapiTsBin,
    ["-i", openapiPath, "-o", outDir, "-p", "@hey-api/typescript", "-p", "zod"],
    { stdio: "inherit", cwd: repoRoot },
  )
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

console.log(`Generated zod schemas + types into ${path.relative(repoRoot, outDir)}`)
