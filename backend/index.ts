import bodyParser from "body-parser";
import express, { Response } from "express";
import path from "path";

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
    createCourse,
    createExercise,
    createFinishedSubmission,
    createOldSubmission,
    createOrganization,
    respondWithFile,
} from "./utils";

const PORT = 4001;

const testOrganization = createOrganization({
    information: "This is a test organization from a local development server.",
    name: "Test Organization",
    slug: "test",
});

const pythonCourse = createCourse({
    description: "This is a test python course from local development server.",
    id: 0,
    name: "python-course",
    title: "Python Course",
});

const passingExercise = createExercise({
    checksum: "abc123",
    id: 1,
    name: "part01-01_passing_exercise",
    points: [{ id: 0, name: "1.passing_exercise" }],
});

const submissions = [
    createOldSubmission({
        courseId: pythonCourse.id,
        exerciseName: passingExercise.name,
        id: 0,
        passed: true,
        timestamp: new Date(2000, 1, 1),
        userId: 0,
    }),
];

const failingExercise = createExercise({
    checksum: "bcd234",
    id: 2,
    name: "part01-02_failing_exercise",
    points: [{ id: 1, name: "2.failing_exercise" }],
});

const onlyActualArchiveOnServer = path.resolve(
    __dirname,
    "resources",
    "test-python-course",
    "part01-01_passing_exercise.zip",
);

const submissionTimestamps = new Map<string, number>(submissions.map((x) => [x.id.toString(), 0]));

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
app.get(`/api/v8/courses/${pythonCourse.id}`, (req, res: Response<CourseSettings>) =>
    res.json(pythonCourse),
);

// getCourseExercises(0)
app.get(`/api/v8/courses/${pythonCourse.id}/exercises`, (req, res: Response<CourseExercise[]>) =>
    res.json([passingExercise, failingExercise]),
);

// getOrganizations()
app.get("/api/v8/org.json", (req, res: Response<Organization[]>) => res.json([testOrganization]));

// getOrganizations("test")
app.get("/api/v8/org/test.json", (req, res: Response<Organization>) => res.json(testOrganization));

// getCourseDetails(0)
app.get(`/api/v8/core/courses/${pythonCourse.id}`, (req, res: Response<CourseDetails>) =>
    res.json({
        course: {
            ...pythonCourse,
            exercises: [passingExercise, failingExercise],
        },
    }),
);

// getExerciseDetails(1)
app.get(`/api/v8/core/exercises/${passingExercise.id}`, (req, res: Response<ExerciseDetails>) =>
    res.json({ ...passingExercise, course_id: pythonCourse.id, course_name: pythonCourse.name }),
);

// downloadExercise(1)
app.get(`/api/v8/core/exercises/${passingExercise.id}/download`, (req, res) => {
    return respondWithFile(res, onlyActualArchiveOnServer);
});

// submitExercise(1)
// submitExerciseToPaste(1, ...)
app.post(
    `/api/v8/core/exercises/${passingExercise.id}/submissions`,
    (req, res: Response<SubmissionResponse>) => {
        const nextId = submissionTimestamps.size + 1000;
        submissionTimestamps.set(nextId.toString(), Date.now());
        submissions.push(
            createOldSubmission({
                courseId: pythonCourse.id,
                exerciseName: passingExercise.name,
                id: passingExercise.id,
                passed: true,
                timestamp: new Date(),
                userId: 0,
            }),
        );

        return res.json({
            paste_url: `http://localhost:${PORT}/paste/${nextId}`,
            show_submission_url: `http://localhost:${PORT}/submissions/${nextId}`,
            submission_url: `http://localhost:${PORT}/api/v8/core/exercises/${passingExercise.id}/submissions/${nextId}`,
        });
    },
);

app.get(
    `/api/v8/core/exercises/${passingExercise.id}/submissions/:id`,
    (req, res: Response<SubmissionStatusReport>, next) => {
        const id = req.params.id;
        const submissionCreated = submissionTimestamps.get(id);
        if (!submissionCreated) {
            return next();
        }

        const timePassed = Date.now() - submissionCreated;
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

        const submission = createFinishedSubmission({
            courseName: pythonCourse.name,
            exerciseName: passingExercise.name,
            id: parseInt(id),
            testCases: [
                {
                    name: "test.test_parsing_exercise.PassingExercise.test_passing",
                    successful: true,
                },
            ],
        });

        return res.json(submission);
    },
);

// getOldSubmissions(1)
app.get(
    `/api/v8/exercises/${passingExercise.id}/users/current/submissions`,
    (req, res: Response<OldSubmission[]>) => res.json(submissions),
);

// getExerciseDetails(2)
app.get(`/api/v8/core/exercises/${failingExercise.id}`, (req, res: Response<ExerciseDetails>) =>
    res.json({ ...failingExercise, course_id: pythonCourse.id, course_name: pythonCourse.name }),
);

// getCourses("test")
app.get(`/api/v8/core/org/${testOrganization.slug}/courses`, (req, res: Response<Course[]>) =>
    res.json([pythonCourse]),
);

// If submission exists, return arbitrary archive
app.get("/api/v8/core/submissions/:id/download", (req, res, next) => {
    if (submissionTimestamps.has(req.params.id)) {
        return respondWithFile(res, onlyActualArchiveOnServer);
    }

    return next();
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
