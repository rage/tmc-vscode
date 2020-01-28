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

export type TMCApiResponse = Course[] | CourseDetails | Organization[] | Organization;
