import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"

import { Ajv2020 } from "ajv/dist/2020"

import { courses } from "./fixtures"

// Opaque-blob guard: the OpenAPI wire spec types `public_spec` as an opaque blob
// (the tmc plugin owns its shape, the host only forwards it), so the mock's
// response validator does NOT check its content. But the CLI deserialises it
// into tmc-mooc-client's typed `PublicSpec`, so a fixture whose public_spec
// drifts from that shape would break the CLI silently. This test closes that
// hole locally: it validates every fixture's public_spec against a JSON schema
// mirroring the tmc editor/browser public spec (public-spec.schema.json), OUT
// of band from the OpenAPI spec.

const schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, "public-spec.schema.json"), "utf8"),
) as Record<string, unknown>

describe("mooc fixture public_spec shape", () => {
  const ajv = new Ajv2020({ allErrors: true })
  const validate = ajv.compile(schema)

  for (const { course, exercises } of courses) {
    for (const exercise of exercises) {
      for (const task of exercise.slide.tasks) {
        test(`${course.slug} / ${exercise.slide.exercise_name} / task ${task.task_id} has a valid tmc public_spec`, () => {
          const valid = validate(task.public_spec)
          assert.ok(valid, `public_spec invalid: ${ajv.errorsText(validate.errors)}`)
        })
      }
    }
  }
})
