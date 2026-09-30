import {
  findNextDateAfter,
  formatDateTime,
  formatDeadline,
  parseDate,
} from "../../utilities/dateDeadline"

const absolute = (date: Date, locale: string): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date)

suite("Date utils", () => {
  const CURRENT_TIME = new Date(2020, 3, 1)
  const TARGET_TIME = new Date(2020, 3, 2)
  const PASSED_DATES = [new Date(2020, 1, 1), new Date(2020, 2, 23), new Date(2020, 2, 17)]
  const FUTURE_DATES = [TARGET_TIME, new Date(2020, 6, 1)]
  const TESTSET = PASSED_DATES.concat(FUTURE_DATES)

  test("findNextDateAfter", () => {
    expect(
      findNextDateAfter(CURRENT_TIME, []),
      "Next date in empty array should be null.",
    ).toBeNull()
    expect(
      findNextDateAfter(CURRENT_TIME, [CURRENT_TIME]),
      "Next date after start date can't be itself.",
    ).toBeNull()
    expect(
      findNextDateAfter(CURRENT_TIME, PASSED_DATES),
      "Next date after too early dates should be null.",
    ).toBeNull()
    expect(
      findNextDateAfter(CURRENT_TIME, FUTURE_DATES),
      "Next date isn't correct with only later dates.",
    ).toBe(TARGET_TIME)
    expect(
      findNextDateAfter(CURRENT_TIME, TESTSET),
      "Next date isn't correct with both earlier and later dates.",
    ).toBe(TARGET_TIME)
  })

  test("an unparseable deadline does not hide a real one", () => {
    const invalid = parseDate("whenever")
    expect(invalid, "An unparseable timestamp must not become a date.").toBeNull()

    expect(findNextDateAfter(CURRENT_TIME, [invalid, TARGET_TIME])).toBe(TARGET_TIME)
    expect(findNextDateAfter(CURRENT_TIME, [TARGET_TIME, invalid])).toBe(TARGET_TIME)
  })

  suite("formatDeadline", () => {
    const NOW = new Date("2026-06-01T12:00:00Z")

    test("renders a distant deadline in the given language, without a hint", () => {
      const date = new Date("2026-09-01T12:00:00Z")
      expect(formatDeadline(date, NOW, "fi")).toBe(absolute(date, "fi"))
      expect(formatDeadline(date, NOW, "en-US")).not.toMatch(/GMT|\(/)
    })

    test("adds a relative hint within a week, either side of now", () => {
      const soon = new Date("2026-06-04T12:00:00Z")
      expect(formatDeadline(soon, NOW, "en-US")).toBe(`${absolute(soon, "en-US")} (in 3 days)`)
      const hoursAgo = new Date("2026-06-01T07:00:00Z")
      expect(formatDeadline(hoursAgo, NOW, "en-US")).toBe(
        `${absolute(hoursAgo, "en-US")} (5 hours ago)`,
      )
    })

    test("renders nothing for a date that cannot be rendered", () => {
      expect(formatDeadline(new Date(NaN), NOW, "en-US")).toBe("")
      expect(formatDateTime(new Date(NaN), "en-US")).toBe("")
    })

    test("keeps each language's formatting apart", () => {
      const date = new Date("2026-09-01T12:00:00Z")
      expect(formatDateTime(date, "fi")).toBe(absolute(date, "fi"))
      expect(formatDateTime(date, "en-US")).toBe(absolute(date, "en-US"))
      expect(formatDateTime(date, "fi")).toBe(absolute(date, "fi"))
    })
  })
})
