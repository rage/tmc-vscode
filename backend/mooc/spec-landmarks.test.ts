import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"

// Staleness guard for the vendored spec. `bin/updateLangsOpenapi.sh --check-stamp`
// only proves the vendored file matches its own recorded sha256, so a spec that was
// never re-vendored is self-consistent and passes every check there is -- while the
// mock it validates goes on accepting the old member names and the real backend
// rejects the client. Master's schemas set no `additionalProperties: false` either,
// so a half-done rename validates clean too.
//
// Naming the members by hand is the point: they cannot be derived from anything in
// this repo, so this is the one check that fails when the spec is out of date.

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
