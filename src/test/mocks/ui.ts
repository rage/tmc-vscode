import type UI from "../../ui/ui"
import { autoMock } from "../support/mock"

export type UIMockValues = unknown

export function createUIMock(): [UI, UIMockValues] {
  return [{ treeDP: autoMock<UI["treeDP"]>() } as unknown as UI, {}]
}
