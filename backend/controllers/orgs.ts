import { Response, Router } from "express";

import { Course, Organization } from "../../src/api/types";
import db from "../db";

const { courses, organizations } = db;

const orgsRouter = Router();

orgsRouter.get("/", (req, res: Response<Organization[]>) => {
    return res.status(200).json(organizations);
});

orgsRouter.get("/:org.json", (req, res: Response<Organization>) => {
    const organization = organizations.find((o) => o.slug === req.params.org);
    return organization ? res.status(200).json(organization) : res.status(404).end();
});

orgsRouter.get("/:org/courses/", (req, res: Response<Course[]>, next) => {
    const organization = organizations.find((o) => o.slug === req.params.org);
    return organization
        ? res.status(200).json(courses.filter((x) => x.organization_id === organization.id))
        : next();
});

export default orgsRouter;
