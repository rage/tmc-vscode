import validateData, { MigratedData } from ".";
import {
    LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
    LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
    LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
} from "../../config/constants";
import { Logger } from "../../utilities/logger";
import * as data from "../data";
import { createHash } from "crypto";
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

const isV2Course = createIs<data.v2.LocalCourseData>();

/**
 * The tmc courses of 4.x user data in the shape this version stores, without the fields it
 * cannot express. A course that does not fit the shape is left out.
 */
export function v2_fromV3(userData: data.v3.UserData): data.v2.UserData {
    const courses: data.v2.LocalCourseData[] = [];
    for (const course of userData.courses) {
        if (!isV2Course(course)) {
            Logger.warn("Left out a course stored by a newer version:", JSON.stringify(course));
            continue;
        }
        courses.push({
            id: course.id,
            name: course.name,
            title: course.title,
            description: course.description,
            organization: course.organization,
            exercises: course.exercises.map((exercise) => ({
                id: exercise.id,
                availablePoints: exercise.availablePoints,
                awardedPoints: exercise.awardedPoints,
                name: exercise.name,
                deadline: exercise.deadline,
                passed: exercise.passed,
                softDeadline: exercise.softDeadline,
            })),
            availablePoints: course.availablePoints,
            awardedPoints: course.awardedPoints,
            perhapsExamMode: course.perhapsExamMode,
            newExercises: course.newExercises,
            notifyAfter: course.notifyAfter,
            disabled: course.disabled,
            materialUrl: course.materialUrl,
        });
    }
    return { courses };
}

/** Identifies a stored `user-data-v3` value, to tell whether 4.x changed it since the import. */
export function v3_fingerprint(userData: unknown): string {
    return createHash("sha256").update(JSON.stringify(userData)).digest("hex");
}

/** {@link MigratedData}, plus the fingerprint to record once `data` imported 4.x user data. */
export interface MigratedUserData extends MigratedData<data.v2.UserData> {
    importedV3Fingerprint?: string;
}

/**
 * User data in the latest shape this version stores. 4.x user data, which is newer than any
 * `user-data-v1`, wins until it has been imported; after that `user-data-v1` holds the changes
 * made here, until 4.x changes its data again. An import keeps the courses only `user-data-v1`
 * has: 3.5.x run after 4.x adds courses there without recording an import.
 */
export default function migrateUserDataToLatest(memento: vscode.Memento): MigratedUserData {
    const local = migrateLocalUserData(memento);
    const storedV3 = memento.get(data.v3.USER_DATA_KEY);
    if (storedV3 === undefined) {
        return local;
    }
    const fingerprint = v3_fingerprint(storedV3);
    if (memento.get(data.v3.IMPORTED_USER_DATA_FINGERPRINT_KEY) === fingerprint) {
        return local;
    }
    if (!createIs<data.v3.UserData>()(storedV3)) {
        Logger.warn("Ignored unreadable user data stored by a newer version.");
        return local;
    }
    const imported = v2_fromV3(storedV3).courses;
    const importedIds = new Set(imported.map((course) => course.id));
    const localOnly = (local.data?.courses ?? []).filter((course) => !importedIds.has(course.id));
    return {
        data: { courses: [...imported, ...localOnly] },
        obsoleteKeys: local.obsoleteKeys,
        importedV3Fingerprint: fingerprint,
    };
}

function migrateLocalUserData(memento: vscode.Memento): MigratedData<data.v2.UserData> {
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
