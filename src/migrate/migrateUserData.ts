import { createIs } from "typescript-is";
import * as vscode from "vscode";

import { MigratedData, UnstableLocalExerciseData } from "./types";

const UNSTABLE_EXERCISE_DATA_KEY = "exerciseData";
const USER_DATA_KEY_V0 = "userData";
const USER_DATA_KEY_V1 = "user-data-v1";

function validateData<T>(
    data: unknown,
    validator: (object: unknown) => object is T,
): T | undefined {
    if (!data) {
        return undefined;
    }

    if (!validator(data)) {
        throw Error("Data type missmatch.");
    }

    return data;
}

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

const courseDataFromV0ToV1 = (
    unstableData: LocalCourseDataV0[],
    memento: vscode.Memento,
): LocalCourseDataV1[] => {
    const localExerciseData = memento.get<UnstableLocalExerciseData[]>(UNSTABLE_EXERCISE_DATA_KEY);
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
};

export function migrateUserData(
    memento: vscode.Memento,
): MigratedData<{ courses: LocalCourseDataV1[] }> {
    const keys: string[] = [USER_DATA_KEY_V0];
    const dataV0 = validateData(
        memento.get(USER_DATA_KEY_V0),
        createIs<{ courses: LocalCourseDataV0[] }>(),
    );

    keys.push(USER_DATA_KEY_V1);
    const dataV1 = dataV0
        ? { courses: courseDataFromV0ToV1(dataV0.courses, memento) }
        : validateData(memento.get(USER_DATA_KEY_V1), createIs<{ courses: LocalCourseDataV1[] }>());

    return { data: dataV1, keys };
}
