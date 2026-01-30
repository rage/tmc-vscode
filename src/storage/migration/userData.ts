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

export function v3_migrateFromV2(data: data.v2.UserData): data.v3.UserData {
    return {
        courses: data.courses,
        mooc_courses: [],
    };
}

export default function migrateUserDataToLatest(
    memento: vscode.Memento,
): MigratedData<data.v3.UserData> {
    const obsoleteKeys: string[] = [];

    // v0 => v1
    const dataV0 = validateData(memento.get(data.v0.USER_DATA_KEY), createIs<data.v0.UserData>());
    if (dataV0) {
        obsoleteKeys.push(data.v0.USER_DATA_KEY);
    }
    const dataV1 = dataV0
        ? { courses: v1_migrateFromV0(dataV0.courses, memento) }
        : validateData(memento.get(data.v1.USER_DATA_KEY), createIs<data.v1.UserData>());

    // v1 => v2
    const dataV2 = dataV1
        ? { ...dataV1, courses: v1_resolveMissingFields(dataV1?.courses) }
        : validateData(memento.get(data.v2.USER_DATA_KEY), createIs<data.v2.UserData>());

    // v2 => v3
    const dataV3 = dataV2
        ? v3_migrateFromV2(dataV2)
        : validateData(memento.get(data.v3.USER_DATA_KEY), createIs<data.v3.UserData>());

    return { data: dataV3, obsoleteKeys };
}
