/**
 * TMC Api Response types
 */
export type TMCApiResponse =
    | Course[]
    | CourseDetails
    | CourseExercise[]
    | Organization[]
    | Organization
    | ExerciseDetails
    | SubmissionResponse
    | SubmissionFeedbackResponse
    | SubmissionStatusReport
    | OldSubmission[];

/**
 * GET /api/v8/core/org/{organization_slug}/courses
 */
export type Course = {
    id: number;
    name: string;
    title: string;
    description: string | null;
    details_url: string;
    unlock_url: string;
    reviews_url: string;
    comet_url: string;
    spyware_urls: string[];
};

/**
 * GET /api/v8/core/courses/{course_id}
 */
export type CourseDetails = {
    course: Course & {
        unlockables: string[];
        exercises: Exercise[];
    };
};

export type Exercise = {
    id: number;
    name: string;
    locked: boolean;
    deadline_description: string | null;
    deadline: string | null;
    soft_deadline: string | null;
    soft_deadline_description: string | null;
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

/**
 * GET /api/v8/courses/{course_id}/exercises
 */
export type CourseExercise = {
    id: number;
    available_points: ExercisePoint[];
    awarded_points: string[];
    name: string;
    publish_time: string | null;
    solution_visible_after: string | null;
    deadline: string | null;
    soft_deadline: string | null;
    disabled: boolean;
    unlocked: boolean;
};

export type ExercisePoint = {
    id: number;
    exercise_id: number;
    name: string;
    requires_review: boolean;
};

/**
 * GET /api/v8/org.json
 * GET /api/v8/org/{organization_slug}.json
 */
export type Organization = {
    name: string;
    information: string;
    slug: string;
    logo_path: string;
    pinned: boolean;
};

/**
 * GET /api/v8/core/exercises/{exercise_id}
 */
export type ExerciseDetails = {
    course_name: string;
    course_id: number;
    code_review_requests_enabled: boolean;
    run_tests_locally_action_enabled: boolean;
    exercise_name: string;
    exercise_id: number;
    unlocked_at: string | null;
    deadline: string | null;
    submissions: unknown;
};

/**
 * POST /api/v8/core/exercises/{exercise_id}/submissions
 */
export type SubmissionResponse = {
    submission_url: string;
    paste_url: string;
    show_submission_url: string;
};

export type SubmissionFeedbackResponse = {
    api_version: number;
    status: "ok";
};

/**
 * GET /api/v8/core/submissions/{submission_id}
 */
export type SubmissionStatusReport = SubmissionProcessingReport | SubmissionResultReport;

export type SubmissionProcessingReport = {
    status: "processing";
    sandbox_status: "created" | "sending_to_sandbox" | "processing_on_sandbox";
};

export type SubmissionResultReport = {
    api_version: number;
    all_tests_passed: boolean | null;
    user_id: number;
    login: string;
    course: string;
    exercise_name: string;
    status: "fail" | "ok" | "error";
    points: string[];
    validations: unknown;
    valgrind: string | null;
    submission_url: string;
    solution_url: string | null;
    submitted_at: string;
    processing_time: number;
    reviewed: boolean;
    requests_review: boolean;
    paste_url: string | null;
    message_for_paste: string | null;
    missing_review_points: string[];
    test_cases?: Array<{
        name: string;
        successful: boolean;
        message: string | null;
        exception: string[] | null;
        detailed_message: string | null;
    }>;
    feedback_questions?: SubmissionFeedbackQuestion[];
    feedback_answer_url?: string;
    error?: string;
};

export type SubmissionFeedbackQuestion = {
    id: number;
    question: string;
    kind: string;
};

/**
 * POST /api/v8/core/submissions/{submission_id}/feedback
 */
export type SubmissionFeedback = {
    status: SubmissionFeedbackAnswer[];
};

export type SubmissionFeedbackAnswer = {
    question_id: number;
    answer: string;
};

export type OldSubmission = {
    id: number;
    user_id: number;
    pretest_error: string | null;
    created_at: string;
    exercise_name: string;
    course_id: number;
    processed: boolean;
    all_tests_passed: boolean;
    points: string | null;
    processing_tried_at: string | null;
    processing_began_at: string | null;
    processing_completed_at: string | null;
    times_sent_to_sandbox: number;
    processing_attempts_started_at: string;
    params_json: string | null;
    requires_review: boolean;
    requests_review: boolean;
    reviewed: boolean;
    message_for_reviewer: string;
    newer_submission_reviewed: boolean;
    review_dismissed: boolean;
    paste_available: boolean;
    message_for_paste: string;
    paste_key: string | null;
};

/**
 * TMC-langs.jar Actions
 */
export type TmcLangsAction =
    | {
          action: "extract-project" | "compress-project";
          archivePath: string;
          exerciseFolderPath: string;
      }
    | {
          action: "run-tests";
          exerciseFolderPath: string;
      }
    | {
          action: "get-exercise-packaging-configuration";
          exerciseFolderPath: string;
      };

export type TmcLangsLogs = {
    logs: {
        stdout: string;
        stderr: string;
    };
};

export type TmcLangsTestResult = {
    name: string;
    successful: boolean;
    message: string;
    valgrindFailed: boolean;
    points: string[];
    exception?: string[];
};

export type TmcLangsTestResults = {
    response: {
        status: string;
        testResults: TmcLangsTestResult[];
        logs: {
            stdout?: number[];
            stderr?: number[];
        };
    } | null;
} & TmcLangsLogs;

export type TmcLangsPath = {
    response: string;
} & TmcLangsLogs;

export type TmcLangsFilePath = {
    response: {
        studentFilePaths: string[];
        exerciseFilePaths: string[];
    };
} & TmcLangsLogs;

export type TmcLangsResponse = TmcLangsPath | TmcLangsTestResults | TmcLangsFilePath;
