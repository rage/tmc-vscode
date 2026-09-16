// oxlint-disable accessor-pairs -- mirrors Settings' write-only callback registration API
import { vi } from "vitest"

import type Settings from "../../config/settings"
import { LogLevel } from "../../utilities/logger"

/** What the settings currently read as; assign to any field to change one. */
export interface SettingsMockValues {
  getDownloadOldSubmission: boolean
  getAutomaticallyUpdateExercises: boolean
  getJavaHome: string
  getLogLevel: LogLevel
  isInsider: boolean
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
    getDownloadOldSubmission: false,
    getAutomaticallyUpdateExercises: false,
    getJavaHome: "",
    getLogLevel: LogLevel.Errors,
    isInsider: false,
  }

  let onChangeDownloadOldSubmission: ((value: boolean) => void) | undefined
  let onChangeHideMetaFiles: ((value: boolean) => void) | undefined
  let onChangeUpdateExercisesAutomatically: ((value: boolean) => void) | undefined

  const mock = {
    getDownloadOldSubmission: vi.fn(() => values.getDownloadOldSubmission),
    getAutomaticallyUpdateExercises: vi.fn(() => values.getAutomaticallyUpdateExercises),
    getJavaHome: vi.fn(() => values.getJavaHome),
    getLogLevel: vi.fn(() => values.getLogLevel),
    isInsider: vi.fn(() => values.isInsider),
    configureIsInsider: vi.fn(async (value: boolean) => {
      values.isInsider = value
    }),
    updateExtensionSettingsToStorage: vi.fn(async () => {}),
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
      values.getDownloadOldSubmission = value
      onChangeDownloadOldSubmission?.(value)
    },
    hideMetaFiles: (value) => onChangeHideMetaFiles?.(value),
    updateExercisesAutomatically: (value) => {
      values.getAutomaticallyUpdateExercises = value
      onChangeUpdateExercisesAutomatically?.(value)
    },
  }

  return [mock as unknown as Settings, values, changes]
}
