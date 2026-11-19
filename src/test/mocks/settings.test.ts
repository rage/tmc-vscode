import Settings from "../../config/settings"
import { LogLevel } from "../../utilities/logger"
import { createSettingsMock } from "./settings"

suite("the settings mock", () => {
  test("it answers every method Settings exposes", () => {
    // An omitted method reads as `undefined`, which a boolean setting's caller takes for "off".
    const [settings] = createSettingsMock()
    const publicSurface = Object.getOwnPropertyNames(Settings.prototype).filter(
      (name) => name !== "constructor" && !name.startsWith("_"),
    )

    expect(publicSurface.filter((name) => !(name in (settings as object)))).toEqual([])
  })

  test("a delivered change reaches the subscriber and the next read alike", () => {
    // Production reads the new value back from the configuration; a mock that only notified would
    // pass tests on a disagreement that cannot happen.
    const [settings, values, change] = createSettingsMock()
    const notified: boolean[] = []
    settings.onChangeHideMetaFiles = (hide): void => void notified.push(hide)

    change.hideMetaFiles(false)

    expect(notified).toEqual([false])
    expect(settings.getHideMetaFiles()).toBe(false)
    expect(values.hideMetaFiles).toBe(false)
  })

  test("each value field feeds the getter for that same setting", () => {
    // The two boolean settings default alike, so a miswired getter reads correctly until exactly one changes.
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
    expect(settings.getJavaHome()).toBe("")
  })
})
