import { BackgroundJobs } from "../../ui/backgroundJobs"

const COURSES_VIEW = { kind: "coursesView" } as const

suite("BackgroundJobs", function () {
  test("lists a job while it runs, with what it reports", async function () {
    const jobs = new BackgroundJobs()
    let during: unknown

    const result = await jobs.run(
      { label: "Downloading 2 exercises", screen: COURSES_VIEW, isLong: true },
      async (job) => {
        job.report(0.5)
        job.relabel("Downloading the last exercise")
        during = [...jobs.running]
        return "done"
      },
    )

    expect(result).toBe("done")
    expect(during).toEqual([
      {
        label: "Downloading the last exercise",
        screen: COURSES_VIEW,
        isLong: true,
        fraction: 0.5,
      },
    ])
    expect(jobs.running).toEqual([])
  })

  test("ends a job that throws, and fires for each change", async function () {
    const jobs = new BackgroundJobs()
    let changes = 0
    jobs.onDidChange(() => changes++)

    await expect(
      jobs.run({ label: "Refreshing courses", screen: COURSES_VIEW }, async () => {
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")

    expect(jobs.running).toEqual([])
    expect(changes).toBe(2)
  })

  test("keeps the jobs in the order they started", async function () {
    const jobs = new BackgroundJobs()
    let release!: () => void
    const first = jobs.run(
      { label: "first", screen: COURSES_VIEW },
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    let labels: string[] = []

    await jobs.run({ label: "second", screen: COURSES_VIEW }, async () => {
      labels = jobs.running.map((job) => job.label)
    })
    release()
    await first

    expect(labels).toEqual(["first", "second"])
  })
})
