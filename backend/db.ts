import {
    Course,
    CourseDetails,
    CourseExercise,
    CourseSettings,
    Exercise,
    ExerciseDetails,
    Organization,
} from "../src/api/types";

const dummyCourse = {
    cache_version: 0,
    certificate_downloadable: false,
    certificate_unlock_spec: "",
    comet_url: "",
    course_template_id: 0,
    details_url: "",
    external_scoreboard_url: "",
    formal_name: "",
    hidden_if_registered_after: "",
    hide_after: "",
    locked_exercise_points_visible: true,
    paste_visibility: "visible",
    refreshed_at: "",
    reviews_url: "",
    spreadsheet_key: "",
    spyware_urls: [],
    unlock_url: "",
    unlockables: [],
};

const courses: Array<Omit<
    Course & CourseDetails["course"] & CourseSettings,
    "exercises" | "organization_slug"
>> = [
    {
        ...dummyCourse,
        description: "This is a mock course provided from a local development server.",
        disabled_status: "enabled",
        hidden: false,
        hide_submission_results: false,
        id: 0,
        material_url: "",
        name: "mock-course",
        organization_id: 0,
        title: "Mock Course",
    },
];

const dummyExercise = {
    all_review_points_given: false,
    attempted: false,
    code_review_requests_enabled: false,
    deadline_description: "",
    memory_limit: 200,
    publish_time: "",
    requires_review: false,
    returnable: true,
    return_url: "",
    reviewed: false,
    run_tests_locally_action_enabled: true,
    runtime_params: [],
    soft_deadline_description: "",
    solution_visible_after: "",
    submissions: "",
    unlocked_at: "",
    valgrind_strategy: "",
    zip_url: "",
};

const exercises: Array<Omit<
    CourseExercise & Exercise & ExerciseDetails,
    "course_name" | "id" | "locked" | "name"
>> = [
    {
        ...dummyExercise,
        available_points: [
            {
                exercise_id: 0,
                id: 0,
                name: "1.0",
                requires_review: false,
            },
        ],
        awarded_points: [],
        checksum: "1234",
        completed: false,
        course_id: 0,
        deadline: "",
        disabled: false,
        exercise_id: 0,
        exercise_name: "osa01-hello_ui_tests",
        soft_deadline: "",
        unlocked: true,
    },
];

const organizations: Array<Organization & { id: number }> = [
    {
        id: 0,
        name: "Mock Organization",
        information: "This is a mock organization provided from a local development server.",
        slug: "mock",
        logo_path: "",
        pinned: true,
    },
    {
        id: 1,
        name: "Test organization",
        information: "Another organization to populate the list.",
        slug: "test",
        logo_path: "",
        pinned: false,
    },
];

interface User {
    id: number;
    username: string;
    password: string;
}

const users: User[] = [
    {
        id: 0,
        username: "TestMyExtension",
        password: "hunter2",
    },
];

export default {
    courses,
    exercises,
    organizations,
    users,
};
