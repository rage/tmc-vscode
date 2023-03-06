import { createIs } from "typia";
import * as vscode from "vscode";

import { LocalCourseData } from "../api/storage";
import {
    LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
    LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
    LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
} from "../config/constants";

import { MigratedData } from "./types";
import validateData from "./validateData";

const UNSTABLE_EXERCISE_DATA_KEY = "exerciseData";
const USER_DATA_KEY_V0 = "userData";
const USER_DATA_KEY_V1 = "user-data-v1";

export interface LocalCourseDataV0 {
    id: number;
    name: string;
    description: string;
    organization: string;
    availablePoints?: number;
    awardedPoints?: number;
    disabled?: boolean;
    exercises: Array<{
        id: number;
        passed: boolean;
        name?: string;
        deadline?: string | null;
        softDeadline?: string | null;
    }>;
    newExercises?: number[];
    perhapsExamMode?: boolean;
    title?: string;
    notifyAfter?: number;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    material_url?: string | null;
}

export interface LocalCourseDataV1 {
    id: number;
    name: string;
    title: string;
    description: string;
    organization: string;
    exercises: Array<{
        id: number;
        awardedPoints?: number;
        availablePoints?: number;
        name: string;
        deadline: string | null;
        passed: boolean;
        softDeadline: string | null;
    }>;
    availablePoints: number;
    awardedPoints: number;
    perhapsExamMode: boolean;
    newExercises: number[];
    notifyAfter: number;
    disabled: boolean;
    materialUrl: string | null;
}

function courseDataFromV0ToV1(
    unstableData: LocalCourseDataV0[],
    memento: vscode.Memento,
): LocalCourseDataV1[] {
    interface LocalExerciseDataPartial {
        id: number;
        deadline?: string | undefined;
        name?: string;
        softDeadline?: string | undefined;
    }

    const localExerciseData = memento.get<LocalExerciseDataPartial[]>(UNSTABLE_EXERCISE_DATA_KEY);
    const courseExercises = localExerciseData && new Map(localExerciseData.map((x) => [x.id, x]));

    return unstableData.map<LocalCourseDataV1>((x) => {
        const exercises = x.exercises.map<LocalCourseDataV1["exercises"][0]>((e) => {
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

export function resolveMissingFields(localCourseData: LocalCourseDataV1[]): LocalCourseData[] {
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

export default function migrateUserData(
    memento: vscode.Memento,
): MigratedData<{ courses: LocalCourseData[] }> {
    const obsoleteKeys: string[] = [];
    const dataV0 = validateData(
        memento.get(USER_DATA_KEY_V0),
        createIs<{ courses: LocalCourseDataV0[] }>(),
    );
    if (dataV0) {
        obsoleteKeys.push(USER_DATA_KEY_V0);
    }

    const dataV1 = dataV0
        ? { courses: courseDataFromV0ToV1(dataV0.courses, memento) }
        : validateData(memento.get(USER_DATA_KEY_V1), createIs<{ courses: LocalCourseDataV1[] }>());

    const data = dataV1 ? { ...dataV1, courses: resolveMissingFields(dataV1?.courses) } : undefined;

    return { data, obsoleteKeys };
}
