import { mapConcurrently, sleep } from "../../utilities"

suite("mapConcurrently", function () {
  test("runs at most `limit` tasks at once and keeps the input order", async function () {
    let running = 0
    let mostRunning = 0
    const results = await mapConcurrently([30, 10, 20, 0, 5], 2, async (delay) => {
      running++
      mostRunning = Math.max(mostRunning, running)
      await sleep(delay)
      running--
      return delay * 2
    })

    expect(results).toEqual([60, 20, 40, 0, 10])
    expect(mostRunning).toBe(2)
  })

  test("resolves to an empty list for no items", async function () {
    expect(await mapConcurrently([], 4, async () => 1)).toEqual([])
  })

  test("rejects when a task does", async function () {
    await expect(
      mapConcurrently([1, 2], 4, async (n) => {
        if (n === 2) {
          throw new Error("boom")
        }
        return n
      }),
    ).rejects.toThrow("boom")
  })
})
