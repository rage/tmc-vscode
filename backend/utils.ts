import {
    Course,
    CourseDetails,
    CourseExercise,
    CourseSettings,
    Exercise,
    ExerciseDetails,
    Organization,
} from "../src/api/types";

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

type BackendCourse = Omit<Course & CourseDetails["course"] & CourseSettings, "exercises">;

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
});

interface CreateExerciseParams {
    id: number;
    checksum: string;
    name: string;
    points: Array<{ id: number; name: string }>;
}

type BackendExercise = Omit<
    CourseExercise & Exercise & ExerciseDetails,
    "course_id" | "course_name"
>;

const createExercise = (params: CreateExerciseParams): BackendExercise => ({
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
});

export { createCourse, createExercise, createOrganization };
