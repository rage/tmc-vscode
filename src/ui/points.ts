/** Points as a row shows them ("3/5") and as a screen reader says them ("3 of 5 points"). */
export interface PointsText {
  short: string
  spoken: string
}

/** The points of an exercise or course, or `undefined` when there are none to earn. */
export function pointsText(awarded: number, available: number): PointsText | undefined {
  return available > 0
    ? { short: `${awarded}/${available}`, spoken: `${awarded} of ${available} points` }
    : undefined
}
