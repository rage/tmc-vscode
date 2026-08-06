import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import * as actions from "../../actions"
import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import { addNewCourse } from "../../commands/addNewCourse"
import { createMockActionContext } from "../mocks/actionContext"

vi.mock("../../actions/addNewCourse", () => ({
  addNewCourse: vi.fn(async () => Ok.EMPTY),
}))

const organizations = [
  { name: "MOOC", slug: "mooc", information: "", logo_path: "", pinned: true },
  { name: "Test org", slug: "test", information: "", logo_path: "", pinned: false },
]

const tmcCourses = [
  {
    id: 1,
    name: "shared-slug",
    title: "Python Programming",
    description: null,
    details_url: "",
    unlock_url: "",
    reviews_url: "",
    comet_url: "",
    spyware_urls: [],
  },
]

const moocCourses = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Shared Slug Course",
    slug: "shared-slug",
    description: null,
    organization_name: "MOOC.fi",
  },
]

interface Pick {
  prompt: { title: string; placeHolder: string } | string
  items: [string, unknown, string?][]
}

interface Harness {
  context: ActionContext
  picks: Pick[]
  errors: string[]
}

function harness(options: {
  organizations?: ReturnType<typeof Ok> | ReturnType<typeof Err>
  moocAuthenticated?: ReturnType<typeof Ok> | ReturnType<typeof Err>
  moocCourses?: ReturnType<typeof Ok> | ReturnType<typeof Err>
  /** Label to select at each prompt, in order. `undefined` dismisses the pick. */
  select?: (string | undefined)[]
}): Harness {
  const base = createMockActionContext()
  const picks: Pick[] = []
  const errors: string[] = []
  const select = options.select ?? []

  const langs = {
    getTmcOrganizations: vi.fn(async () => options.organizations ?? Ok(organizations)),
    getCourses: vi.fn(async () => Ok(tmcCourses)),
    isMoocAuthenticated: vi.fn(async () => options.moocAuthenticated ?? Ok(true)),
    getEnrolledMoocCourseInstances: vi.fn(async () => options.moocCourses ?? Ok(moocCourses)),
  } as unknown as Langs

  const dialog = {
    ...base.dialog,
    selectItem: vi.fn(
      async (
        prompt: { title: string; placeHolder: string } | string,
        ...items: [string, unknown, string?][]
      ) => {
        const index = picks.length
        picks.push({ prompt, items })
        const wanted = select[index]
        return wanted === undefined ? undefined : items.find(([label]) => label === wanted)?.[1]
      },
    ),
    errorNotification: vi.fn((message: string) => {
      errors.push(message)
    }),
  } as unknown as ActionContext["dialog"]

  return { context: { ...base, dialog, langs: new Ok(langs) }, picks, errors }
}

suite("Add new course command", function () {
  beforeEach(function () {
    vi.mocked(actions.addNewCourse).mockClear()
  })

  test("lists organizations and mooc courses in one pick, each naming its backend", async function () {
    const { context, picks } = harness({ select: [undefined] })
    await addNewCourse(context)

    expect(picks).toHaveLength(1)
    expect(picks[0]?.items.map((item) => [item[0], item[2]])).toEqual([
      ["MOOC", "TMC Server · browse courses"],
      ["Test org", "TMC Server · browse courses"],
      ["Shared Slug Course", "courses.mooc.fi · MOOC.fi"],
    ])
    // No platform question: the single pick is the first thing the user sees.
    expect(picks[0]?.prompt).toEqual({
      title: "Add New Course",
      placeHolder: "Which course or organization?",
    })
  })

  test("adds a mooc course in one step", async function () {
    const { context, picks } = harness({ select: ["Shared Slug Course"] })
    await addNewCourse(context)

    expect(picks).toHaveLength(1)
    expect(actions.addNewCourse).toHaveBeenCalledWith(context, "", {
      kind: "mooc",
      data: { instanceId: "11111111-1111-1111-1111-111111111111" },
    })
  })

  test("adds a tmc course via its organization", async function () {
    const { context, picks } = harness({ select: ["Test org", "Python Programming"] })
    await addNewCourse(context)

    expect(picks).toHaveLength(2)
    expect(picks[1]?.prompt).toEqual({
      title: "Add New Course",
      placeHolder: "Which course in Test org?",
    })
    expect(actions.addNewCourse).toHaveBeenCalledWith(context, "test", {
      kind: "tmc",
      data: { courseId: 1 },
    })
  })

  test("still offers mooc courses when TMC Server is unreachable, naming what is missing", async function () {
    const { context, picks, errors } = harness({
      organizations: Err(new Error("connection error")),
      select: ["Shared Slug Course"],
    })
    await addNewCourse(context)

    expect(errors).toEqual([])
    expect(picks[0]?.items.map((item) => item[0])).toEqual(["Shared Slug Course"])
    expect(picks[0]?.prompt).toEqual({
      title: "Add New Course",
      placeHolder:
        "Which course or organization? (TMC Server unavailable, so its courses are missing)",
    })
    expect(actions.addNewCourse).toHaveBeenCalledOnce()
  })

  test("still offers TMC organizations when the mooc backend errors", async function () {
    const { context, picks, errors } = harness({
      moocCourses: Err(new Error("connection error")),
      select: ["Test org", "Python Programming"],
    })
    await addNewCourse(context)

    expect(errors).toEqual([])
    expect(picks[0]?.items.map((item) => item[0])).toEqual(["MOOC", "Test org"])
    expect(picks[0]?.prompt).toEqual({
      title: "Add New Course",
      placeHolder:
        "Which course or organization? (courses.mooc.fi unavailable, so its courses are missing)",
    })
    expect(actions.addNewCourse).toHaveBeenCalledOnce()
  })

  test("treats a missing mooc login as that backend being unavailable, not a failure", async function () {
    const { context, picks, errors } = harness({
      moocAuthenticated: Ok(false),
      select: [undefined],
    })
    await addNewCourse(context)

    expect(errors).toEqual([])
    expect(picks[0]?.items.map((item) => item[0])).toEqual(["MOOC", "Test org"])
    expect(picks[0]?.prompt).toMatchObject({
      placeHolder: expect.stringContaining("courses.mooc.fi unavailable"),
    })
  })

  test("reports an error and opens no pick when both backends fail", async function () {
    const { context, picks, errors } = harness({
      organizations: Err(new Error("connection error")),
      moocCourses: Err(new Error("connection error")),
    })
    await addNewCourse(context)

    expect(picks).toEqual([])
    expect(errors).toEqual([
      "Failed to fetch courses from TMC Server or courses.mooc.fi. " +
        "Check your network connection and that you are logged in.",
    ])
    expect(actions.addNewCourse).not.toHaveBeenCalled()
  })

  test("distinguishes a tmc and a mooc course that share a slug", async function () {
    // Both entries here derive from the slug `shared-slug`; the descriptions are
    // what keeps them apart, and the picked value must be the mooc one.
    const { context } = harness({ select: ["Shared Slug Course"] })
    await addNewCourse(context)

    expect(actions.addNewCourse).toHaveBeenCalledWith(
      context,
      "",
      expect.objectContaining({ kind: "mooc" }),
    )
  })
})
