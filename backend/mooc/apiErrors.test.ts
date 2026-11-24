import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { describe, test } from "node:test"

import { API_ERRORS } from "./apiErrors"

// The error table is transcribed from the host by hand and the OpenAPI response validation
// accepts any 4xx body, so this reads back what the vendored spec says of each refusal. Keys the
// host never documents in the spec (e.g. sisu errors) stay unchecked: nothing generated names them.

interface Spec {
  paths: Record<string, Record<string, { responses: Record<string, { description?: string }> }>>
}

const spec = JSON.parse(
  fs.readFileSync(path.join(__dirname, "exercise-services-client.openapi.generated.json"), "utf8"),
) as Spec

const documentedKeys = (): { key: string; status: number; where: string }[] => {
  const found: { key: string; status: number; where: string }[] = []
  for (const [route, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      for (const [status, response] of Object.entries(operation.responses)) {
        if (Number(status) < 400) {
          continue
        }
        for (const [, key] of (response.description ?? "").matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
          found.push({ key: key!, status: Number(status), where: `${method} ${route} ${status}` })
        }
      }
    }
  }
  return found
}

describe("the mock's error table against the vendored spec", () => {
  const documented = documentedKeys()

  test("the spec documents some message keys", () => {
    assert.ok(documented.length >= 10, `only ${documented.length} keys found`)
  })

  for (const { key, status, where } of documented) {
    test(`${where} documents ${key}, which the table answers with that status`, () => {
      const known = API_ERRORS[key as keyof typeof API_ERRORS] as { status: number } | undefined
      assert.ok(known, `${key} is documented by the spec but missing from apiErrors.ts`)
      assert.equal(known.status, status)
    })
  }
})
