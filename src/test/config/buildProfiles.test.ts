import { createRequire } from "module"

const { mockBackend, mockTmcLocalMooc } = createRequire(import.meta.url)("../../../config.js") as {
  mockBackend: Record<string, string>
  mockTmcLocalMooc: Record<string, string>
}

// Test tiers build with these profiles; a profile naming a production host would let a spec that
// forgets its environment override reach the real backends.
suite("mock build profiles", function () {
  const profiles = { mockBackend, mockTmcLocalMooc }

  for (const [name, profile] of Object.entries(profiles)) {
    test(`${name} resolves no backend to a mooc.fi host`, function () {
      for (const [define, value] of Object.entries(profile)) {
        if (define.endsWith("_URL__")) {
          expect(new URL(JSON.parse(value) as string).hostname, `${name}.${define}`).not.toMatch(
            /(^|\.)mooc\.fi$/,
          )
        }
      }
    })
  }
})
