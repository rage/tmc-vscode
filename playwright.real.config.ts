import { readFileSync } from "node:fs"
import { join } from "node:path"

import { defineConfig } from "@playwright/test"

// Opt-in: drives the real extension against a real courses.mooc.fi stack (project-331.local), never
// the mock. Nothing in the default or CI runs includes it. See playwright/real/README.md.
if (process.env.TMC_E2E_REAL !== "1") {
  throw new Error(
    "The real-backend specs run only on request: set TMC_E2E_REAL=1 (see playwright/real/README.md).",
  )
}

// Exercise ids the stack's setup script recorded.
try {
  for (const line of readFileSync(join(__dirname, "playwright/real/scripts/ids.env"), "utf8").split(
    "\n",
  )) {
    const [key, value] = line.split("=")
    if (key && value && !(key in process.env)) {
      process.env[key] = value
    }
  }
} catch {
  // Without it the specs that need exercise ids fail with a message saying so.
}

export default defineConfig({
  testDir: "./playwright/real",
  testMatch: /.*\.real\.ts$/,
  outputDir: join(process.env.E2E_OUT ?? join(__dirname, "test-results", "real"), "test-output"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 15 * 60 * 1000,
  expect: { timeout: 30 * 1000 },
})
