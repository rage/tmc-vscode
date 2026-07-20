import { vi } from "vitest"

import type Settings from "../../config/settings"

export interface SettingsMockValues {
  getDownloadOldSubmission: boolean
}

export function createSettingsMock(): [Settings, SettingsMockValues] {
  const values: SettingsMockValues = {
    getDownloadOldSubmission: false,
  }

  const mock = {
    getDownloadOldSubmission: vi.fn(() => values.getDownloadOldSubmission),
  }

  return [mock as unknown as Settings, values]
}
