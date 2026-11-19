import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"

// Staleness guard for the vendored spec. `--check-stamp` only proves the file
// matches its own sha256, so a never-re-vendored spec passes while the mock keeps
// accepting old member names. Schemas set no `additionalProperties: false`, so a
// half-done rename validates clean too.
//
// The members are named by hand because nothing in this repo can derive them.

const spec = JSON.parse(
  fs.readFileSync(path.join(__dirname, "exercise-services-client.openapi.generated.json"), "utf8"),
) as { components: { schemas: Record<string, { properties?: Record<string, unknown> }> } }

describe("vendored client API spec landmarks", () => {
  const schemas = spec.components.schemas

  for (const name of ["AnswerFile", "AnswerKind"]) {
    test(`declares ${name}`, () => {
      assert.ok(schemas[name], `${name} is missing: the vendored spec predates the file overhaul`)
    })
  }

  for (const [schema, property] of [
    ["UploadedFiles", "data_files"],
    ["SubmissionFiles", "data_files"],
    ["ExerciseSlideSubmission", "answer_kind"],
    ["ExerciseSlideSubmission", "data_files"],
    ["ExerciseSlideSubmission", "data_json"],
  ] as const) {
    test(`${schema} declares ${property}`, () => {
      assert.ok(schemas[schema]?.properties?.[property], `${schema}.${property} is missing`)
    })
  }

  test("declares nothing from the pre-overhaul shape", () => {
    assert.equal(schemas["UploadedFile"], undefined, "UploadedFile was replaced by AnswerFile")
    const serialized = JSON.stringify(spec)
    for (const gone of ["uploaded_file_ids", "download_url"]) {
      assert.ok(!serialized.includes(gone), `the spec still mentions ${gone}`)
    }
  })
})
