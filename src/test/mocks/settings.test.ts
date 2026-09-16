import Settings from "../../config/settings"
import { LogLevel } from "../../utilities/logger"
import { createSettingsMock } from "./settings"

suite("the settings mock", () => {
  test("it answers every method Settings exposes", () => {
    // A method the mock omits reads as `undefined`, which a boolean setting's
    // caller takes for "off" — a silent wrong answer rather than a failure.
    const [settings] = createSettingsMock()
    const publicSurface = Object.getOwnPropertyNames(Settings.prototype).filter(
      (name) => name !== "constructor" && !name.startsWith("_"),
    )

    expect(publicSurface.filter((name) => !(name in (settings as object)))).toEqual([])
  })

  test("a delivered change reaches the subscriber and the next read alike", () => {
    // Production reads the new value back out of the VS Code configuration, so a
    // mock that notified without changing what a getter answers would let a test
    // pass on a disagreement that cannot happen.
    const [settings, values, change] = createSettingsMock()
    const notified: boolean[] = []
    settings.onChangeUpdateExercisesAutomatically = (value): void => void notified.push(value)

    change.updateExercisesAutomatically(true)

    expect(notified).toEqual([true])
    expect(settings.getAutomaticallyUpdateExercises()).toBe(true)
    expect(values.updateExercisesAutomatically).toBe(true)
  })

  test("each value field feeds the getter for that same setting", () => {
    // The two boolean settings default alike and share a type, so a getter wired
    // to the wrong field reads correctly until a test changes exactly one of them.
    const [settings, values] = createSettingsMock()

    values.downloadOldSubmission = true

    expect(settings.getDownloadOldSubmission()).toBe(true)
    expect(settings.getAutomaticallyUpdateExercises()).toBe(false)
  })

  test("its values start at the settings' declared defaults", () => {
    const [settings] = createSettingsMock()

    expect(settings.getDownloadOldSubmission()).toBe(false)
    expect(settings.getAutomaticallyUpdateExercises()).toBe(false)
    expect(settings.getLogLevel()).toBe(LogLevel.Errors)
    expect(settings.isInsider()).toBe(false)
    expect(settings.getJavaHome()).toBe("")
  })
})
