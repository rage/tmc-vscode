import { Ok } from "ts-results"
import { vi } from "vitest"

import {
  listEnrolledMoocCourses,
  listOrganizationCourses,
  listTmcOrganizations,
  MOOC_LOGIN,
} from "../../actions/courseCatalog"
import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import { createMockActionContext } from "../mocks/actionContext"

const organizations = [
  { name: "Test org", slug: "test", information: "", logo_path: "", pinned: false },
]
const moocCourses = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Course",
    slug: "course",
    description: null,
    organization_name: "MOOC.fi",
  },
]

function context(options: {
  moocAuthenticated?: boolean
  getTmcOrganizations?: ReturnType<typeof vi.fn>
  getEnrolledMoocCourses?: ReturnType<typeof vi.fn>
  getCourses?: ReturnType<typeof vi.fn>
}): ReadyActionContext {
  const langs = {
    getTmcOrganizations: options.getTmcOrganizations ?? vi.fn(async () => Ok(organizations)),
    getEnrolledMoocCourses: options.getEnrolledMoocCourses ?? vi.fn(async () => Ok(moocCourses)),
    getCourses: options.getCourses ?? vi.fn(async () => Ok([])),
  } as unknown as Langs
  return createMockActionContext({
    authenticated: { mooc: options.moocAuthenticated ?? true },
    startup: { langs },
  })
}

suite("listEnrolledMoocCourses and listTmcOrganizations", function () {
  test("fetch each backend's listing when the mooc session is authenticated", async function () {
    const ctx = context({})

    expect(await listTmcOrganizations(ctx)).toEqual(Ok(organizations))
    expect(await listEnrolledMoocCourses(ctx)).toEqual(Ok(moocCourses))
  })

  test("stands for a mooc login instead of fetching, when there is no mooc session", async function () {
    const getEnrolledMoocCourses = vi.fn(async () => Ok(moocCourses))
    const ctx = context({ moocAuthenticated: false, getEnrolledMoocCourses })

    expect(await listEnrolledMoocCourses(ctx)).toBe(MOOC_LOGIN)
    expect(getEnrolledMoocCourses).not.toHaveBeenCalled()
  })
})

suite("listOrganizationCourses", function () {
  test("fetches the organization's courses by slug", async function () {
    const getCourses = vi.fn(async () => Ok([]))
    const ctx = context({ getCourses })

    await listOrganizationCourses(ctx, "test-org")

    expect(getCourses).toHaveBeenCalledExactlyOnceWith("test-org")
  })
})
