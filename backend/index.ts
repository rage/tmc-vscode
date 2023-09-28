import bodyParser from "body-parser";
import express, { Response } from "express";

import {
    Course,
    CourseDetails,
    CourseExercise,
    CourseSettings,
    ExerciseDetails,
    OldSubmission,
    Organization,
    SubmissionFeedbackResponse,
    SubmissionResponse,
    SubmissionStatusReport,
} from "../src/api/types";

import { applicationRouter, langsRounter, oauthRouter } from "./controllers";
import {
    BackendCourse,
    createCourse,
    createExercise,
    createFinishedSubmission,
    createOldSubmission,
    createOrganization,
    ExerciseWithFile,
    respondWithFile,
} from "./utils";

const PORT = 4001;

interface DetailsForLangs {
    exercises: Array<{
        id: number;
        checksum: string;
        course_name: string;
        exercise_name: string;
        hide_submission_results: boolean;
    }>;
}

// ==== orgs ====

const testOrganization = createOrganization({
    information: "This is a test organization from a local development server.",
    name: "Test Organization",
    slug: "test",
});

const organizations = [testOrganization];

// ==== courses ====

let courseId = 1;

const pythonCourse = createCourse({
    description: "This is a test python course from local development server.",
    id: courseId++,
    name: "python-course",
    title: "Python Course",
});

const javaCourse = createCourse({
    description: "This is a test java course from local development server.",
    id: courseId++,
    name: "java-course",
    title: "Java Course",
});

const testCourses = [pythonCourse, javaCourse];

const organizationCourses = [
    {
        organization: testOrganization,
        courses: testCourses,
    },
];

// ==== exercises ====

let exerciseId = 1;

const pythonExercisePassing = createExercise({
    checksum: "abc123",
    id: exerciseId++,
    name: "part01-01_passing_exercise",
    points: [{ id: 0, name: "1.passing_exercise" }],
    path: ["test-python-course", "part01-01_passing_exercise.zip"],
});

const pythonExerciseFailing = createExercise({
    checksum: "bcd234",
    id: exerciseId++,
    name: "part01-02_failing_exercise",
    points: [{ id: 1, name: "2.failing_exercise" }],
    path: ["test-python-course", "part01-02_failing_exercise.zip"],
});

const pythonExercises = [pythonExercisePassing, pythonExerciseFailing];

const javaExercisePassing = createExercise({
    checksum: "abc123",
    id: exerciseId++,
    name: "part01-01_passing_exercise",
    points: [{ id: 0, name: "1.passing_exercise" }],
    path: ["test-java-course", "part01-01_passing_exercise.zip"],
});

const javaExercises = [javaExercisePassing];

type CourseWithExercises = {
    course: BackendCourse;
    exercises: Array<ExerciseWithFile>;
};
const courseExercises: Array<CourseWithExercises> = [
    { course: pythonCourse, exercises: pythonExercises },
    { course: javaCourse, exercises: javaExercises },
];

// ==== submissions ====

let submissionId = 1;

const submissions: Array<OldSubmission & { file: string }> = [
    {
        ...createOldSubmission({
            courseId: pythonCourse.id,
            exerciseName: pythonExercisePassing.exercise.name,
            id: submissionId++,
            passed: true,
            timestamp: new Date(2000, 1, 1),
            userId: 1,
        }),
        file: pythonExercisePassing.file,
    },
];

// ==== routes ====

const app = express();
app.use((req, res, next) => {
    const [url, params] = req.url.split("?");
    console.log(req.method, url, params ?? "");
    next();
});
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use("/langs", langsRounter);
app.use("/oauth", oauthRouter);
app.use("/api/v8/application", applicationRouter);

// getCourseSettings(0)
for (const course of testCourses) {
    app.get(`/api/v8/courses/${course.id}`, (req, res: Response<CourseSettings>) =>
        res.json(course),
    );
}

// getCourseExercises(0)
for (const { course, exercises } of courseExercises) {
    app.get(`/api/v8/courses/${course.id}/exercises`, (req, res: Response<CourseExercise[]>) =>
        res.json(exercises.map((e) => e.exercise)),
    );
}

// getOrganizations()
app.get("/api/v8/org.json", (req, res: Response<Organization[]>) => res.json(organizations));

// getOrganizations("test")
for (const org of organizations) {
    app.get(`/api/v8/org/${org.slug}.json`, (req, res: Response<Organization>) => {
        res.json(org);
    });
}

// getCourseDetails(0)
for (const { course, exercises } of courseExercises) {
    app.get(`/api/v8/core/courses/${course.id}`, (req, res: Response<CourseDetails>) =>
        res.json({
            course: {
                ...course,
                exercises: exercises.map((e) => e.exercise),
            },
        }),
    );
}

// downloadExercises()
app.get("/api/v8/core/exercises/details", (req, res: Response<DetailsForLangs>) => {
    const rawIds = req.query.ids;
    const ids = Array.isArray(rawIds) ? rawIds : [rawIds];
    const downloadTargets = [];
    courseExercises.forEach((ce) => {
        ce.exercises
            .filter(({ exercise: e }) => ids.includes(e.id.toString()))
            .forEach(({ exercise: e }) => {
                downloadTargets.push({
                    id: e.id,
                    checksum: e.checksum,
                    course_name: ce.course.name,
                    exercise_name: e.name,
                    hide_submission_results: false,
                });
            });
    });
    return res.json({
        exercises: downloadTargets,
    });
});

// getExerciseDetails(1)
for (const { course, exercises } of courseExercises) {
    for (const { exercise } of exercises) {
        app.get(`/api/v8/core/exercises/${exercise.id}`, (req, res: Response<ExerciseDetails>) =>
            res.json({ ...exercise, course_id: course.id, course_name: course.name }),
        );
    }
}

// downloadExercise(1)
for (const { exercises } of courseExercises) {
    for (const { exercise, file } of exercises) {
        app.get(`/api/v8/core/exercises/${exercise.id}/download`, (req, res) => {
            return respondWithFile(res, file);
        });
    }
}

// submitExercise(1)
// submitExerciseToPaste(1, ...)
for (const { course, exercises } of courseExercises) {
    for (const { exercise, file } of exercises) {
        app.post(
            `/api/v8/core/exercises/${exercise.id}/submissions`,
            (req, res: Response<SubmissionResponse>) => {
                const submissionId = submissions.length + 1;
                submissions.push({
                    ...createOldSubmission({
                        courseId: course.id,
                        exerciseName: exercise.name,
                        id: submissionId,
                        passed: true,
                        timestamp: new Date(),
                        userId: 0,
                    }),
                    file,
                });
                return res.json({
                    paste_url: `http://localhost:${PORT}/paste/${submissionId}`,
                    show_submission_url: `http://localhost:${PORT}/submissions/${submissionId}`,
                    submission_url: `http://localhost:${PORT}/api/v8/core/exercises/${exercise.id}/submissions/${submissionId}`,
                });
            },
        );
    }
}

for (const { course, exercises } of courseExercises) {
    for (const { exercise } of exercises) {
        app.get(
            `/api/v8/core/exercises/${exercise.id}/submissions/:id`,
            (req, res: Response<SubmissionStatusReport>, next) => {
                const id = req.params.id;
                const submission = submissions.find((s) => s.id.toString() === req.params.id);
                if (!submission) {
                    return next();
                }

                const timePassed = Date.now() - Date.parse(submission.processing_began_at);
                if (timePassed < 300) {
                    console.log(`Submission ${id} created at ${timePassed}s`);
                    return res.json({
                        status: "processing",
                        sandbox_status: "created",
                    });
                } else if (timePassed < 600) {
                    console.log(`Submission ${id} sent to sandbox at ${timePassed}s`);
                    return res.json({
                        status: "processing",
                        sandbox_status: "sending_to_sandbox",
                    });
                } else if (timePassed < 1000) {
                    console.log(`Submission ${id} is processing at ${timePassed}s`);
                    return res.json({
                        status: "processing",
                        sandbox_status: "processing_on_sandbox",
                    });
                }

                const finishedSubmission = createFinishedSubmission({
                    courseName: course.name,
                    exerciseName: exercise.name,
                    id: parseInt(id),
                    testCases: [
                        {
                            name: "test.test_parsing_exercise.PassingExercise.test_passing",
                            successful: true,
                        },
                    ],
                });

                return res.json(finishedSubmission);
            },
        );
    }
}

// getOldSubmissions(1)
for (const { exercises } of courseExercises) {
    for (const { exercise } of exercises) {
        app.get(
            `/api/v8/exercises/${exercise.id}/users/current/submissions`,
            (req, res: Response<OldSubmission[]>) =>
                res.json(submissions.filter((s) => s.exercise_name === exercise.name)),
        );
    }
}

// getExerciseDetails(2)
for (const { course, exercises } of courseExercises) {
    for (const { exercise } of exercises) {
        app.get(`/api/v8/core/exercises/${exercise.id}`, (req, res: Response<ExerciseDetails>) =>
            res.json({ ...exercise, course_id: course.id, course_name: course.name }),
        );
    }
}

// getCourses("test")
for (const { organization, courses } of organizationCourses) {
    app.get(`/api/v8/core/org/${organization.slug}/courses`, (req, res: Response<Course[]>) =>
        res.json(courses),
    );
}

// If submission exists, return arbitrary archive
app.get("/api/v8/core/submissions/:id/download", (req, res, next) => {
    const submission = submissions.find((s) => s.id.toString() === req.params.id);
    if (!submission) {
        return next();
    }
    return respondWithFile(res, submission.file);
});

// submitSubmissionFeedback(...)
app.post("/feedback", (req, res: Response<SubmissionFeedbackResponse>) =>
    res.json({ api_version: 8, status: "ok" }),
);

app.use((req, res) => {
    console.log("Unknown endpoint");
    res.status(404).json({ error: "Unhandled endpoint" });
});

app.listen(PORT, () => {
    console.log("Server listening to", PORT);
});
