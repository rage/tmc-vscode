export type Course = {
    id: number;
    name: string;
    title: string;
    description: string;
    details_url: string;
    unlock_url: string;
    reviews_url: string;
    comet_url: string;
    spyware_urls: string[];
};

export type CourseDetails = {
    course: Course & {
        unlockables: string[],
        exercises: Exercise[],
    };
};

export type Exercise = {
    id: number;
    name: string;
    locked: boolean;
    deadline_description: string | null;
    deadline: string | null;
    soft_deadline: string | null;
    soft_deadline_description: string | null;
    checksum: string;
    return_url: string;
    zip_url: string;
    returnable: boolean;
    requires_review: boolean;
    attempted: boolean;
    completed: boolean;
    reviewed: boolean;
    all_review_points_given: boolean;
    memory_limit: number | null;
    runtime_params: string[];
    valgrind_strategy: string;
    code_review_requests_enabled: boolean;
    run_tests_locally_action_enabled: boolean;
    latest_submission_url?: string;
    latest_submission_id?: number;
    solution_zip_url?: string;
};

export type Organization = {
    name: string;
    information: string;
    slug: string;
    logo_path: string;
    pinned: boolean;
};

export type ExerciseDetails = {
    course_name: string;
    course_id: number;
    code_review_requests_enabled: boolean;
    run_tests_locally_action_enabled: boolean;
    exercise_name: string;
    exercise_id: number;
    unlocked_at: string | null;
    deadline: string | null;
    submissions: any[];
};

export type SubmissionResponse = {
    submission_url: string;
    paste_url: string;
    show_submission_url: string;
};

export type SubmissionFeedbackResponse = {
    api_version: number;
    status: "ok";
};

export type TMCApiResponse = Course[] | CourseDetails | Organization[] | Organization | ExerciseDetails |
                             SubmissionResponse | SubmissionFeedbackResponse | SubmissionStatusReport;

export type TmcLangsAction = {
    action: "extract-project" | "compress-project",
    archivePath: string,
    exerciseFolderPath: string,
} | {
    action: "run-tests",
    exerciseFolderPath: string,
};

export type TmcLangsTestResult = {
    name: string,
    successful: boolean,
    message: string,
    valgrindFailed: boolean,
    points: string[],
    exception: string[],
};

export type TmcLangsTestResults = {
    status: string,
    testResults: TmcLangsTestResult[],
    logs: any;
};

export type TmcLangsResponse = string | TmcLangsTestResults;

export type SubmissionProcessingReport = {
    status: "processing";
    sandbox_status: "created" | "sending_to_sandbox" | "processing_on_sandbox";
};

export type SubmissionResultReport = {
    api_version: number;
    all_tests_passed: boolean;
    user_id: number;
    login: string;
    course: string;
    exercise_name: string;
    status: "fail" | "ok";
    points: string[];
    validations: any;
    valgrind: string;
    submission_url: string;
    solution_url: string | null;
    submitted_at: string;
    processing_time: number;
    reviewed: boolean;
    requests_review: boolean;
    paste_url: string | null;
    message_for_paste: string | null;
    missing_review_points: string[];
    test_cases: Array<{
        name: string;
        successful: boolean;
        message: string;
        exception: string[] | null;
        detailed_message: string | null;
    }>;
    feedback_questions?: SubmissionFeedbackQuestion[];
    feedback_answer_url?: string;
};

export type SubmissionFeedbackQuestion = {
    id: number;
    question: string;
    kind: string;
};

export type SubmissionFeedbackAnswer = {
    question_id: number;
    answer: string;
};

export type SubmissionFeedback = {
    status: SubmissionFeedbackAnswer[];
};

export type SubmissionStatusReport = SubmissionProcessingReport | SubmissionResultReport;
