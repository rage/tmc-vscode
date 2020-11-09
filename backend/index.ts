import bodyParser from "body-parser";
import express, { Response } from "express";

import {
    Course,
    CourseDetails,
    CourseExercise,
    CourseSettings,
    ExerciseDetails,
    Organization,
} from "../src/api/types";

import { applicationRouter, langsRounter, oauthRouter } from "./controllers";
import { createCourse, createExercise, createOrganization } from "./utils";

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
const failingExercise = createExercise({
    checksum: "bcd234",
    id: 2,
    name: "part01-02_failing_exercise",
    points: [{ id: 1, name: "2.failing_exercise" }],
});

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
app.get(`/api/v8/core/exercises/${passingExercise.id}`, (req, res: Response<ExerciseDetails>) => {
    const r = { ...passingExercise, course_id: pythonCourse.id, course_name: pythonCourse.name };
    console.log(r);
    return res.json(r);
});

// getExerciseDetails(2)
app.get(`/api/v8/core/exercises/${failingExercise.id}`, (req, res: Response<ExerciseDetails>) =>
    res.json({ ...failingExercise, course_id: pythonCourse.id, course_name: pythonCourse.name }),
);

// getCourses("test")
app.get(`/api/v8/core/org/${testOrganization.slug}/courses`, (req, res: Response<Course[]>) =>
    res.json([pythonCourse]),
);

app.use((req, res) => {
    console.log("Unknown endpoint");
    res.status(404).json({ error: "Unhandled endpoint" });
});

app.listen(PORT, () => {
    console.log("Server listening to", PORT);
});
