import {
  dateToString,
  findNextDateAfter,
  formatDeadline,
  parseDate,
  parseNextDeadlineAfter,
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

  test("parseNextDeadline", () => {
    const NO_DEADLINE = "No deadline"
    const ALL_DEADLINES_HAVE_EXPIRED = "All deadlines have expired"

    expect(
      parseNextDeadlineAfter(CURRENT_TIME, []),
      `Parsed deadline from empty array should be "${NO_DEADLINE}"`,
    ).toBe(NO_DEADLINE)
    expect(
      parseNextDeadlineAfter(CURRENT_TIME, [{ date: CURRENT_TIME, active: true }]),
      "Parsed deadline after current date can't be itself",
    ).toBe(ALL_DEADLINES_HAVE_EXPIRED)

    const parsedTarget = parseNextDeadlineAfter(CURRENT_TIME, [{ date: TARGET_TIME, active: true }])
    expect(parsedTarget, "Parsed deadline from one active target time should be that").toBe(
      `Next deadline: ${formatDeadline(TARGET_TIME, CURRENT_TIME, undefined)}`,
    )
    expect(
      parseNextDeadlineAfter(
        CURRENT_TIME,
        PASSED_DATES.map((x) => ({ date: x, active: true })),
      ),
      `Parsed deadline after active past dates should be "${ALL_DEADLINES_HAVE_EXPIRED}"`,
    ).toBe(ALL_DEADLINES_HAVE_EXPIRED)
    expect(
      parseNextDeadlineAfter(
        CURRENT_TIME,
        PASSED_DATES.map((x) => ({ date: x, active: false })),
      ),
      `Parsed deadline after inactive past dates should be "${ALL_DEADLINES_HAVE_EXPIRED}"`,
    ).toBe(ALL_DEADLINES_HAVE_EXPIRED)
    expect(
      parseNextDeadlineAfter(
        CURRENT_TIME,
        FUTURE_DATES.map((x) => ({ date: x, active: true })),
      ),
      `Parsed deadline from active future dates was expected to be "${parsedTarget}"`,
    ).toBe(parsedTarget)
    expect(
      parseNextDeadlineAfter(
        CURRENT_TIME,
        FUTURE_DATES.map((x) => ({ date: x, active: false })),
      ),
      `Parsed deadline from inactive future dates was expected to be "${parsedTarget}"`,
    ).toBe(parsedTarget)
  })

  test("an unparseable deadline neither renders nor hides a real one", () => {
    const invalid = parseDate("whenever")
    expect(invalid, "An unparseable timestamp must not become a date.").toBeNull()

    expect(dateToString(new Date(NaN)), "An unrenderable date must not render as text.").toBe("")
    expect(
      parseNextDeadlineAfter(CURRENT_TIME, [{ date: invalid, active: true }]),
      "A lone unparseable deadline is no deadline.",
    ).toBe("No deadline")

    const expected = `Next deadline: ${formatDeadline(TARGET_TIME, CURRENT_TIME, undefined)}`
    expect(
      parseNextDeadlineAfter(CURRENT_TIME, [
        { date: invalid, active: true },
        { date: TARGET_TIME, active: true },
      ]),
      "An unparseable deadline seen first must not mask a real one.",
    ).toBe(expected)
    expect(
      parseNextDeadlineAfter(CURRENT_TIME, [
        { date: TARGET_TIME, active: true },
        { date: invalid, active: true },
      ]),
      "An unparseable deadline seen last must not mask a real one.",
    ).toBe(expected)

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
    })
  })
})
