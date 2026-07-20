import {
    Course,
    CourseDetails,
    CourseExercise,
    CourseSettings,
    Exercise,
    ExerciseDetails,
    OldSubmission,
    Organization,
    SubmissionResultReport,
} from "../src/api/types";
import { Response } from "express";
import path from "path";

interface CreateOrganizationParams {
    information: string;
    name: string;
    slug: string;
}

const createOrganization = (params: CreateOrganizationParams): Organization => ({
    information: params.information,
    logo_path: "",
    name: params.name,
    pinned: false,
    slug: params.slug,
});

interface CreateCourseParams {
    description: string;
    id: number;
    name: string;
    title: string;
}

export type BackendCourse = Omit<Course & CourseDetails["course"] & CourseSettings, "exercises">;

const createCourse = (params: CreateCourseParams): BackendCourse => ({
    certificate_downloadable: false,
    comet_url: "",
    description: params.description,
    details_url: "",
    hidden: false,
    hide_submission_results: false,
    id: params.id,
    locked_exercise_points_visible: true,
    material_url: "",
    name: params.name,
    reviews_url: "",
    spyware_urls: [],
    title: params.title,
    unlock_url: "",
    unlockables: [],
    disabled_status: "enabled",
});

interface CreateExerciseParams {
    id: number;
    checksum: string;
    name: string;
    points: Array<{ id: number; name: string }>;
    path: Array<string>;
}

export type ExerciseWithFile = {
    exercise: BackendExercise;
    file: string;
};
export type BackendExercise = Omit<
    CourseExercise & Exercise & ExerciseDetails,
    "course_id" | "course_name"
>;

const createExercise = (params: CreateExerciseParams): ExerciseWithFile => {
    const exercise = {
        all_review_points_given: false,
        available_points: params.points.map((x) => ({
            ...x,
            exercise_id: params.id,
            requires_review: false,
        })),
        awarded_points: [],
        attempted: false,
        checksum: params.checksum,
        code_review_requests_enabled: false,
        completed: false,
        deadline: "",
        deadline_description: "",
        disabled: false,
        exercise_id: params.id,
        exercise_name: params.name,
        id: params.id,
        locked: false,
        memory_limit: 200,
        name: params.name,
        publish_time: "",
        requires_review: false,
        returnable: true,
        return_url: "",
        reviewed: false,
        run_tests_locally_action_enabled: true,
        runtime_params: [],
        soft_deadline: "",
        soft_deadline_description: "",
        solution_visible_after: "",
        submissions: [],
        unlocked: true,
        unlocked_at: "",
        valgrind_strategy: "",
        zip_url: "",
    };
    const file = path.resolve(__dirname, "resources", ...params.path);
    return { exercise, file };
};

interface CreateFinishedSubmissionParams {
    courseName: string;
    exerciseName: string;
    id: number;
    missingReviewPoints?: string[];
    points?: string[];
    testCases: Array<{ name: string; successful: boolean }>;
}

const createFinishedSubmission = (
    params: CreateFinishedSubmissionParams,
): SubmissionResultReport => {
    const allPassed = params.testCases.every((x) => x.successful);

    return {
        all_tests_passed: allPassed,
        api_version: 7,
        course: params.courseName,
        error: null,
        exercise_name: params.exerciseName,
        feedback_answer_url: null,
        feedback_questions: [],
        login: "batman-1337",
        message_for_paste: null,
        missing_review_points: params.missingReviewPoints ?? [],
        paste_url: null,
        points: params.points ?? [],
        processing_time: 1000,
        requests_review: false,
        reviewed: false,
        solution_url: "fake-url",
        status: allPassed ? "ok" : "fail",
        submission_url: "",
        submitted_at: "",
        test_cases: params.testCases.map((x) => ({
            name: x.name,
            successful: x.successful,
            message: "",
            exception: [],
            detailed_message: null,
        })),
        user_id: 0,
        valgrind: "",
        validations: null,
    };
};

interface CreateOldSubmissionParams {
    courseId: number;
    exerciseName: string;
    id: number;
    passed: boolean;
    timestamp: Date;
    userId: number;
}

export const passingExerciseId = 1;

export const failingExerciseId = 2;

const createOldSubmission = (params: CreateOldSubmissionParams): OldSubmission => {
    const timestamp = params.timestamp.toISOString();
    const points = params.id === passingExerciseId ? "part01-01_passing_exercise" : "";
    return {
        all_tests_passed: params.passed,
        course_id: params.courseId,
        created_at: timestamp,
        exercise_name: params.exerciseName,
        id: params.id,
        message_for_paste: "",
        message_for_reviewer: "",
        newer_submission_reviewed: false,
        params_json: "",
        paste_available: false,
        paste_key: "",
        points,
        pretest_error: "",
        processed: true,
        processing_attempts_started_at: timestamp,
        processing_began_at: timestamp,
        processing_completed_at: timestamp,
        processing_tried_at: timestamp,
        requests_review: false,
        requires_review: false,
        review_dismissed: false,
        reviewed: false,
        times_sent_to_sandbox: 1,
        user_id: 0,
    };
};

const respondWithFile = (res: Response, file: string): void =>
    res.sendFile(file, (error) => {
        if (!error) {
            console.log("Sent", file);
        } else {
            console.error("Failed to send requested file:", JSON.stringify(error));
        }
    });

export {
    createCourse,
    createExercise,
    createFinishedSubmission,
    createOldSubmission,
    createOrganization,
    respondWithFile,
};
