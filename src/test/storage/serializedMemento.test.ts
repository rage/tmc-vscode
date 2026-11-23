import * as fs from "fs"
import * as path from "path"

import type * as vscode from "vscode"

import { SerializedMemento } from "../../storage/serializedMemento"

interface PendingWrite {
  key: string
  value: unknown
  settle: (error?: Error) => void
}

/** A memento whose updates stay in flight until the test settles them, in any order. */
function createControlledMemento(): {
  memento: vscode.Memento
  started: PendingWrite[]
  maxInFlight: () => number
} {
  const stored = new Map<string, unknown>()
  const started: PendingWrite[] = []
  let inFlight = 0
  let maxInFlight = 0
  const memento: vscode.Memento = {
    keys: () => [...stored.keys()],
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      (stored.has(key) ? stored.get(key) : defaultValue) as T | undefined,
    update: (key: string, value: unknown): Promise<void> => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise<void>((resolve, reject) => {
        started.push({
          key,
          value,
          settle: (error) => {
            inFlight--
            if (error) {
              reject(error)
              return
            }
            if (value === undefined) {
              stored.delete(key)
            } else {
              stored.set(key, value)
            }
            resolve()
          },
        })
      })
    },
  }
  return { memento, started, maxInFlight: () => maxInFlight }
}

function settle(started: PendingWrite[], index: number, error?: Error): void {
  const write = started[index]
  if (!write) {
    throw new Error(`Write ${index} has not started`)
  }
  write.settle(error)
}

async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve)
  })
}

suite("SerializedMemento", function () {
  test("starts each update only after the previous one has settled, in call order", async function () {
    const { memento, started, maxInFlight } = createControlledMemento()
    const serialized = new SerializedMemento(memento)

    const writes = [serialized.update("a", 1), serialized.update("b", 2), serialized.update("a", 3)]
    await flush()
    expect(started.map(({ key, value }) => [key, value])).toEqual([["a", 1]])

    for (let i = 0; i < 3; i++) {
      settle(started, i)
      await flush()
    }
    await Promise.all(writes)
    expect(started.map(({ key, value }) => [key, value])).toEqual([
      ["a", 1],
      ["b", 2],
      ["a", 3],
    ])
    expect(maxInFlight()).toBe(1)
    expect(memento.get("a")).toBe(3)
  })

  test("reads its own queued writes", async function () {
    const { memento, started } = createControlledMemento()
    await seed(memento, started, { kept: "old", deleted: "old" })
    const serialized = new SerializedMemento(memento)

    void serialized.update("kept", "new")
    void serialized.update("added", "new")
    void serialized.update("deleted", undefined)

    expect(serialized.get("kept")).toBe("new")
    expect(serialized.get("added")).toBe("new")
    expect(serialized.get("deleted")).toBeUndefined()
    expect(serialized.get("deleted", "default")).toBe("default")
    expect([...serialized.keys()].toSorted()).toEqual(["added", "kept"])
  })

  test("reads the latest of several queued writes to one key", async function () {
    const { memento, started } = createControlledMemento()
    const serialized = new SerializedMemento(memento)

    const writes = [serialized.update("key", 1), serialized.update("key", 2)]
    await flush()
    settle(started, 0)
    await flush()
    expect(serialized.get("key")).toBe(2)
    settle(started, 1)
    await Promise.all(writes)
    expect(serialized.get("key")).toBe(2)
  })

  test("rejects only the failed write, and runs the ones queued after it", async function () {
    const { memento, started } = createControlledMemento()
    const serialized = new SerializedMemento(memento)

    const failed = serialized.update("a", 1)
    const next = serialized.update("b", 2)
    await flush()
    settle(started, 0, new Error("disk full"))
    await expect(failed).rejects.toThrow("disk full")
    await flush()
    settle(started, 1)
    await expect(next).resolves.toBeUndefined()
    expect(serialized.get("a")).toBeUndefined()
    expect(serialized.get("b")).toBe(2)
  })

  test("runs a write that throws instead of rejecting as a failed write", async function () {
    const throwing: vscode.Memento = {
      keys: () => [],
      get: () => undefined,
      update: (key: string) => {
        if (key === "bad") {
          throw new Error("thrown")
        }
        return Promise.resolve()
      },
    }
    const serialized = new SerializedMemento(throwing)

    await expect(serialized.update("bad", 1)).rejects.toThrow("thrown")
    await expect(serialized.update("good", 1)).resolves.toBeUndefined()
  })

  test("keeps many concurrent writers' updates", async function () {
    const lossy = createLossyMemento()
    const serialized = new SerializedMemento(lossy)

    await Promise.all(Array.from({ length: 50 }, (_, i) => serialized.update(`key-${i}`, i)))
    expect(lossy.keys()).toHaveLength(50)

    const unserialized = createLossyMemento()
    await Promise.all(Array.from({ length: 50 }, (_, i) => unserialized.update(`key-${i}`, i)))
    expect(unserialized.keys().length).toBeLessThan(50)
  })
})

/** Drops any update that starts while another is in flight, as VS Code can. */
function createLossyMemento(): vscode.Memento {
  const stored = new Map<string, unknown>()
  let isWriting = false
  return {
    keys: () => [...stored.keys()],
    get: <T>(key: string): T | undefined => stored.get(key) as T | undefined,
    update: async (key: string, value: unknown): Promise<void> => {
      const isDropped = isWriting
      isWriting = true
      await new Promise((resolve) => {
        setImmediate(resolve)
      })
      if (!isDropped) {
        stored.set(key, value)
        isWriting = false
      }
    },
  }
}

async function seed(
  memento: vscode.Memento,
  started: PendingWrite[],
  values: Record<string, unknown>,
): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    const write = memento.update(key, value)
    started.at(-1)?.settle()
    await write
  }
  started.length = 0
}

suite("globalState and workspaceState", function () {
  const srcRoot = path.join(__dirname, "..", "..")
  const wrapping = /new SerializedMemento\(context\.(globalState|workspaceState)\)/
  const rawAccess =
    /(?<!mementos)\.(globalState|workspaceState)\b|\b(globalState|workspaceState)\b.*\}\s*=/

  test("are touched only to put them behind a SerializedMemento", function () {
    const touches = fs
      .readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".ts") && !file.startsWith(`test${path.sep}`))
      .flatMap((file) =>
        fs
          .readFileSync(path.join(srcRoot, file), "utf8")
          .split("\n")
          .filter((line) => !/^\s*(\*|\/\/)/.test(line))
          .filter((line) => rawAccess.test(line) && !wrapping.test(line))
          .map((line) => `${file}: ${line.trim()}`),
      )
    expect(touches).toEqual([])
  })
})
