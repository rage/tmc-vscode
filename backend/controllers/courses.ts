import { Response, Router } from "express";

import { CourseExercise, CourseSettings } from "../../src/api/types";
import db from "../db";

const { courses, exercises, organizations } = db;

const coursesRouter = Router();

coursesRouter.get("/:id", (req, res: Response<CourseSettings>, next) => {
    const course = courses.find((c) => c.id.toString() === req.params.id);
    const organization = organizations.find((o) => o.id === course.id);
    return course && organization
        ? res.json({
              ...course,
              organization_slug: organization.slug,
          })
        : next();
});

coursesRouter.get("/:id/exercises", (req, res) => {
    const data = exercises
        .filter((e) => e.course_id.toString() === req.params.id)
        .map<CourseExercise>((e) => ({
            ...e,
            id: e.exercise_id,
            name: e.exercise_name,
        }));
    return res.json(data);
});

export default coursesRouter;
