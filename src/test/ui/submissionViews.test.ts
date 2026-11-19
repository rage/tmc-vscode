import type { ExerciseSubmissionPanel, SubmissionView } from "../../../shared/lib"
import { testedLocallyView } from "../../panels/submissionView"
import { submissionViews } from "../../ui/submissionViews"
import { idOfTmcExercise } from "../fixtures/identifiers"

function panelOf(id: number, exerciseId = 1): ExerciseSubmissionPanel {
  return {
    id,
    type: "ExerciseSubmission",
    exerciseId: idOfTmcExercise(exerciseId),
    backend: "tmc",
    exerciseName: `exercise-${exerciseId}`,
    courseTitle: "Course",
  }
}

const view: SubmissionView = testedLocallyView(0)

suite("submission views", () => {
  beforeEach(() => {
    submissionViews.clear()
    submissionViews.setShown(undefined)
  })

  test("finds an exercise's latest panel, which a newer submission supersedes", () => {
    submissionViews.update({ panel: panelOf(1), view, shouldReopen: false })
    submissionViews.update({ panel: panelOf(2, 2), view, shouldReopen: false })
    expect(submissionViews.latestFor(idOfTmcExercise(1))?.panel.id).toBe(1)

    submissionViews.open(panelOf(3))
    expect(submissionViews.latestFor(idOfTmcExercise(1))).toBeUndefined()
    submissionViews.update({ panel: panelOf(3), view, shouldReopen: false })

    expect(submissionViews.latestFor(idOfTmcExercise(1))?.panel.id).toBe(3)
    expect(submissionViews.latestFor(idOfTmcExercise(2))?.panel.id).toBe(2)
  })

  test("tells the panel on screen only for its own exercise", () => {
    submissionViews.setShown(panelOf(1))

    expect(submissionViews.shownFor(idOfTmcExercise(1))?.id).toBe(1)
    expect(submissionViews.shownFor(idOfTmcExercise(2))).toBeUndefined()
  })

  test("fires when the panel on screen changes, not when it is recorded again", () => {
    let changes = 0
    const subscription = submissionViews.onDidChangeShown(() => changes++)

    submissionViews.setShown(panelOf(1))
    submissionViews.setShown(panelOf(1))
    submissionViews.setShown(undefined)
    subscription.dispose()

    expect(changes).toBe(2)
  })

  test("a reveal carries the section with a number newer than the last one's", () => {
    const reveals: { serial: number | undefined }[] = []
    const subscription = submissionViews.onDidRequestReveal(({ section }) =>
      reveals.push({ serial: section?.serial }),
    )
    onTestFinished(() => subscription.dispose())

    submissionViews.reveal(panelOf(1), { name: "history", shouldPaste: false })
    submissionViews.reveal(panelOf(1))
    submissionViews.reveal(panelOf(1), { name: "getHelp", shouldPaste: true })

    expect(reveals[1]?.serial).toBeUndefined()
    expect(reveals[2]!.serial!).toBeGreaterThan(reveals[0]!.serial!)
  })
})
