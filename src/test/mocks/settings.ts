// oxlint-disable accessor-pairs -- mirrors Settings' write-only callback registration API
import { vi } from "vitest"

import type Settings from "../../config/settings"
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
  javaHome: string
  logLevel: LogLevel
}

/**
 * Delivers a setting change the way `Settings` does on `onDidChangeConfiguration`: the new
 * value takes effect, and reaches the subscriber of a setting that has one, so a subscriber
 * and a later read cannot disagree.
 */
export interface SettingsMockChanges {
  hideMetaFiles: (value: boolean) => void
}

export function createSettingsMock(): [Settings, SettingsMockValues, SettingsMockChanges] {
  const values: SettingsMockValues = {
    downloadOldSubmission: false,
    hideMetaFiles: true,
    updateExercisesAutomatically: false,
    javaHome: "",
    logLevel: LogLevel.Errors,
  }

  let onChangeHideMetaFiles: ((hide: boolean) => void) | undefined

  const mock = {
    getDownloadOldSubmission: vi.fn(() => values.downloadOldSubmission),
    getHideMetaFiles: vi.fn(() => values.hideMetaFiles),
    getAutomaticallyUpdateExercises: vi.fn(() => values.updateExercisesAutomatically),
    getJavaHome: vi.fn(() => values.javaHome),
    getLogLevel: vi.fn(() => values.logLevel),
    dispose: vi.fn(),
    set onChangeHideMetaFiles(callback: (hide: boolean) => void) {
      onChangeHideMetaFiles = callback
    },
  }

  const changes: SettingsMockChanges = {
    hideMetaFiles: (value) => {
      values.hideMetaFiles = value
      onChangeHideMetaFiles?.(value)
    },
  }

  return [mock as unknown as Settings, values, changes]
}
