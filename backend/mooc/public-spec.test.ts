import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"

import { Ajv2020 } from "ajv/dist/2020"

import { courses } from "./fixtures"

// The OpenAPI spec types `public_spec` as an opaque blob, so the mock's response validator
// does not check it, but the CLI deserialises it into a typed `PublicSpec`. This validates
// every fixture against public-spec.schema.json so drift cannot break the CLI silently.

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

  test("the fixtures cover both spec types", () => {
    // The types take different CLI paths (only an editor task is downloadable and submittable).
    const types = new Set(
      courses.flatMap(({ exercises }) =>
        exercises.flatMap(({ slide }) => slide.tasks.map((task) => task.public_spec.type)),
      ),
    )
    assert.deepEqual([...types].toSorted(), ["browser", "editor"])
  })
})
