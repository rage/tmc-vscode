import * as vscode from "vscode"

import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { idOfTmcCourse, idOfTmcExercise } from "./identifiers"

export const exerciseHelloWorld: WorkspaceExercise = {
  id: idOfTmcExercise(1),
  courseId: idOfTmcCourse(0),
  backend: "tmc",
  courseSlug: "test-python-course",
  exerciseSlug: "hello_world",
  status: ExerciseStatus.Open,
  uri: vscode.Uri.file("/tmc/vscode/test-python-course/hello_world"),
}

export const exerciseOtherWorld: WorkspaceExercise = {
  id: idOfTmcExercise(2),
  courseId: idOfTmcCourse(0),
  backend: "tmc",
  courseSlug: "test-python-course",
  exerciseSlug: "other_world",
  status: ExerciseStatus.Closed,
  uri: vscode.Uri.file("/tmc/vscode/test-python-course/other_world"),
}

export const workspaceExercises: WorkspaceExercise[] = [exerciseHelloWorld, exerciseOtherWorld]
