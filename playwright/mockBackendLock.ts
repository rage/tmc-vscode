import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const LOCK_FILE = join(tmpdir(), "tmc-vscode-playwright-mock-4001.lock")

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

/**
 * Refuses a run while another run uses the mock backend on port 4001: each test resets the
 * mock, which wipes the other run's device codes and sessions mid-test.
 *
 * @returns The teardown that releases the lock.
 */
export default function globalSetup(): () => void {
  for (;;) {
    if (tryLock()) {
      return () => fs.rmSync(LOCK_FILE, { force: true })
    }
    const owner = Number(fs.readFileSync(LOCK_FILE, "utf8"))
    if (isRunning(owner)) {
      throw new Error(
        `Playwright run ${owner} is using the mock backend on port 4001; wait for it to end.`,
      )
    }
    fs.rmSync(LOCK_FILE, { force: true })
  }
}

/** Takes the lock; `false` when another run holds it, or a run that died left it. */
function tryLock(): boolean {
  try {
    fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: "wx" })
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") {
      return false
    }
    throw e
  }
}
