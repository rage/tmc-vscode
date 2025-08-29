import validateData, { MigratedData } from ".";
import {
    LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
    LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
    LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
} from "../../config/constants";
import * as data from "../data";
import { createIs } from "typia";
import * as vscode from "vscode";

export function v1_migrateFromV0(
    unstableData: data.v0.LocalCourseData[],
    memento: vscode.Memento,
): data.v1.LocalCourseData[] {
    interface LocalExerciseDataPartial {
        id: number;
        deadline?: string | undefined;
        name?: string;
        softDeadline?: string | undefined;
    }

    const localExerciseData = memento.get<LocalExerciseDataPartial[]>(data.v0.EXERCISE_DATA_KEY);
    const courseExercises = localExerciseData && new Map(localExerciseData.map((x) => [x.id, x]));

    return unstableData.map<data.v1.LocalCourseData>((x) => {
        const exercises = x.exercises.map<data.v1.LocalCourseData["exercises"][0]>((e) => {
            const fallback = courseExercises?.get(e.id);
            return {
                ...e,
                deadline: e.deadline ?? fallback?.deadline ?? null,
                name: e.name ?? fallback?.name ?? e.id.toString(),
                softDeadline: e.softDeadline ?? fallback?.softDeadline ?? null,
            };
        });

        return {
            ...x,
            availablePoints: x.availablePoints ?? 0,
            awardedPoints: x.awardedPoints ?? 0,
            description: x.description,
            disabled: x.disabled ?? false,
            exercises: exercises,
            materialUrl: x.material_url ?? null,
            newExercises: x.newExercises ?? [],
            notifyAfter: x.notifyAfter ?? 0,
            organization: x.organization,
            perhapsExamMode: x.perhapsExamMode ?? false,
            title: x.title ?? x.name,
        };
    });
}

export function v1_resolveMissingFields(
    localCourseData: data.v1.LocalCourseData[],
): data.v2.LocalCourseData[] {
    return localCourseData.map((course) => {
        const exercises = course.exercises.map((x) => {
            const resolvedAwardedPoints = x.passed
                ? LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER
                : LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER;
            return {
                ...x,
                availablePoints: x.availablePoints ?? LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
                awardedPoints: x.awardedPoints ?? resolvedAwardedPoints,
            };
        });
        return { ...course, exercises };
    });
}

export default function migrateUserDataToLatest(
    memento: vscode.Memento,
): MigratedData<{ courses: data.v2.LocalCourseData[] }> {
    const obsoleteKeys: string[] = [];
    const dataV0 = validateData(
        memento.get(data.v0.USER_DATA_KEY),
        createIs<{ courses: data.v0.LocalCourseData[] }>(),
    );
    if (dataV0) {
        obsoleteKeys.push(data.v0.USER_DATA_KEY);
    }

    const dataV1 = dataV0
        ? { courses: v1_migrateFromV0(dataV0.courses, memento) }
        : validateData(
              memento.get(data.v1.USER_DATA_KEY),
              createIs<{ courses: data.v1.LocalCourseData[] }>(),
          );

    const dataV2 = dataV1
        ? { ...dataV1, courses: v1_resolveMissingFields(dataV1?.courses) }
        : undefined;

    return { data: dataV2, obsoleteKeys };
}
