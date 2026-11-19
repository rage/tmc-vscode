// oxlint-disable accessor-pairs -- mirrors Settings' write-only callback registration API
import { vi } from "vitest"

import type Settings from "../../config/settings"
import type { NewExerciseHandling } from "../../config/settings"
import { LogLevel } from "../../utilities/logger"

/**
 * What the settings currently read as, keyed by `testMyCode.*` setting name like
 * {@link SettingsMockChanges}. Assign to any field to change one without
 * notifying a subscriber.
 */
export interface SettingsMockValues {
  downloadOldSubmission: boolean
  hideMetaFiles: boolean
  updateExercisesAutomatically: boolean
  newExercises: NewExerciseHandling
  javaHome: string
  logLevel: LogLevel
  "experimental.coursesMoocFi": boolean
}

/**
 * Delivers a setting change the way `Settings` does on `onDidChangeConfiguration`: the new
 * value takes effect, and reaches the subscriber of a setting that has one, so a subscriber
 * and a later read cannot disagree.
 */
export interface SettingsMockChanges {
  hideMetaFiles: (value: boolean) => void
  "experimental.coursesMoocFi": (value: boolean) => void
}

export function createSettingsMock(): [Settings, SettingsMockValues, SettingsMockChanges] {
  const values: SettingsMockValues = {
    downloadOldSubmission: false,
    hideMetaFiles: true,
    updateExercisesAutomatically: false,
    newExercises: "ask",
    javaHome: "",
    logLevel: LogLevel.Errors,
    "experimental.coursesMoocFi": false,
  }

  let onChangeHideMetaFiles: ((hide: boolean) => void) | undefined
  let onChangeCoursesMoocFiEnabled: ((isEnabled: boolean) => void) | undefined

  const mock = {
    getDownloadOldSubmission: vi.fn(() => values.downloadOldSubmission),
    getHideMetaFiles: vi.fn(() => values.hideMetaFiles),
    getAutomaticallyUpdateExercises: vi.fn(() => values.updateExercisesAutomatically),
    getNewExerciseHandling: vi.fn(() => values.newExercises),
    getJavaHome: vi.fn(() => values.javaHome),
    getLogLevel: vi.fn(() => values.logLevel),
    isCoursesMoocFiEnabled: vi.fn(() => values["experimental.coursesMoocFi"]),
    dispose: vi.fn(),
    set onChangeHideMetaFiles(callback: (hide: boolean) => void) {
      onChangeHideMetaFiles = callback
    },
    set onChangeCoursesMoocFiEnabled(callback: (isEnabled: boolean) => void) {
      onChangeCoursesMoocFiEnabled = callback
    },
  }

  const changes: SettingsMockChanges = {
    hideMetaFiles: (value) => {
      values.hideMetaFiles = value
      onChangeHideMetaFiles?.(value)
    },
    "experimental.coursesMoocFi": (value) => {
      values["experimental.coursesMoocFi"] = value
      onChangeCoursesMoocFiEnabled?.(value)
    },
  }

  return [mock as unknown as Settings, values, changes]
}
