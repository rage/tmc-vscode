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
  updateExercisesAutomatically: boolean
  javaHome: string
  logLevel: LogLevel
  insiderVersion: boolean
}

/**
 * Delivers a setting change the way `Settings` does on
 * `onDidChangeConfiguration`: the new value both takes effect and reaches
 * whatever the subject subscribed, so a subscriber and a later read cannot
 * disagree.
 */
export interface SettingsMockChanges {
  downloadOldSubmission: (value: boolean) => void
  hideMetaFiles: (value: boolean) => void
  updateExercisesAutomatically: (value: boolean) => void
}

export function createSettingsMock(): [Settings, SettingsMockValues, SettingsMockChanges] {
  const values: SettingsMockValues = {
    downloadOldSubmission: false,
    updateExercisesAutomatically: false,
    javaHome: "",
    logLevel: LogLevel.Errors,
    insiderVersion: false,
  }

  let onChangeDownloadOldSubmission: ((value: boolean) => void) | undefined
  let onChangeHideMetaFiles: ((value: boolean) => void) | undefined
  let onChangeUpdateExercisesAutomatically: ((value: boolean) => void) | undefined

  const mock = {
    getDownloadOldSubmission: vi.fn(() => values.downloadOldSubmission),
    getAutomaticallyUpdateExercises: vi.fn(() => values.updateExercisesAutomatically),
    getJavaHome: vi.fn(() => values.javaHome),
    getLogLevel: vi.fn(() => values.logLevel),
    isInsider: vi.fn(() => values.insiderVersion),
    configureIsInsider: vi.fn(async (value: boolean) => {
      values.insiderVersion = value
    }),
    dispose: vi.fn(),
    set onChangeDownloadOldSubmission(callback: (value: boolean) => void) {
      onChangeDownloadOldSubmission = callback
    },
    set onChangeHideMetaFiles(callback: (value: boolean) => void) {
      onChangeHideMetaFiles = callback
    },
    set onChangeUpdateExercisesAutomatically(callback: (value: boolean) => void) {
      onChangeUpdateExercisesAutomatically = callback
    },
  }

  const changes: SettingsMockChanges = {
    downloadOldSubmission: (value) => {
      values.downloadOldSubmission = value
      onChangeDownloadOldSubmission?.(value)
    },
    hideMetaFiles: (value) => onChangeHideMetaFiles?.(value),
    updateExercisesAutomatically: (value) => {
      values.updateExercisesAutomatically = value
      onChangeUpdateExercisesAutomatically?.(value)
    },
  }

  return [mock as unknown as Settings, values, changes]
}
