import { Response, Router } from "express";

import { CourseDetails, Exercise } from "../../src/api/types";
import db from "../db";

const { courses, exercises } = db;

const coreCoursesRouter = Router();

coreCoursesRouter.get("/:id", (req, res: Response<CourseDetails>, next) => {
    const course = courses.find((d) => d.id.toString() === req.params.id);
    const exers = exercises
        .filter((e) => e.course_id.toString() === req.params.id)
        .map<Exercise>((e) => ({
            ...e,
            id: e.exercise_id,
            locked: !e.unlocked,
            name: e.exercise_name,
        }));

    return course
        ? res.json({
              course: {
                  ...course,
                  exercises: exers,
              },
          })
        : next();
});

export default coreCoursesRouter;
