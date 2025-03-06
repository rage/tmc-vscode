import { createIs } from "typia";
import * as vscode from "vscode";

import { LocalTmcCourseData, UserData } from "../api/storage";
import {
    LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
    LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
    LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
} from "../config/constants";

import { EXERCISE_DATA_KEY_V0 } from "./migrateExerciseData";
import { MigratedData } from "./types";
import validateData from "./validateData";

const USER_DATA_KEY_V0 = "userData";
const USER_DATA_KEY_V1 = "user-data-v1";
const USER_DATA_KEY_V2 = "user-data-v2";

interface UserDataV0 {
    courses: LocalCourseDataV0[];
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
    material_url?: string | null;
}

interface UserDataV1 {
    courses: LocalCourseDataV1[];
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

function coursesFromV0ToV1(
    unstableData: LocalCourseDataV0[],
    memento: vscode.Memento,
): LocalCourseDataV1[] {
    interface LocalExerciseDataPartial {
        id: number;
        deadline?: string | undefined;
        name?: string;
        softDeadline?: string | undefined;
    }

    const localExerciseData = memento.get<LocalExerciseDataPartial[]>(EXERCISE_DATA_KEY_V0);
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

function localCourseDataFromV1ToV2(old: UserDataV1): UserData {
    const defined = resolveMissingFieldsInV1(old.courses);
    return {
        courses: defined,
        moocCourses: [],
    };
}

export function resolveMissingFieldsInV1(
    localCourseData: LocalCourseDataV1[],
): LocalTmcCourseData[] {
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

// migrates stored user data to the latest version
export default function migrateUserData(memento: vscode.Memento): MigratedData<UserData> {
    // check latest version first, no need to do anything if we're already on the latest userdata ver
    const userDataV2 = validateData(memento.get(USER_DATA_KEY_V2), createIs<UserData>());
    if (userDataV2 !== undefined) {
        return { data: userDataV2, obsoleteKeys: [] };
    }

    // check v1
    const userDataV1 = validateData(memento.get(USER_DATA_KEY_V1), createIs<UserDataV1>());
    if (userDataV1 !== undefined) {
        // migrate from v1 to v2
        const migratedData = localCourseDataFromV1ToV2(userDataV1);
        return { data: migratedData, obsoleteKeys: [USER_DATA_KEY_V1] };
    }

    // check v0
    const userDataV0 = validateData(memento.get(USER_DATA_KEY_V0), createIs<UserDataV0>());
    if (userDataV0 !== undefined) {
        // migrate from v0 to v1
        const coursesV1 = coursesFromV0ToV1(userDataV0.courses, memento);
        const userDataV1 = { courses: coursesV1 };
        // migrate from v1 to v2
        const userDataV2 = localCourseDataFromV1ToV2(userDataV1);
        return { data: userDataV2, obsoleteKeys: [USER_DATA_KEY_V0] };
    }

    // no data
    return { data: undefined, obsoleteKeys: [] };
}
