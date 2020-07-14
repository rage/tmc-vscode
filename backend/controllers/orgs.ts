import { Router } from "express";

import db from "../db";

const { courses, organizations } = db;

const orgsRouter = Router();

orgsRouter.get("/", (req, res) => {
    return res.status(200).json(organizations);
});

orgsRouter.get("/:org.json", (req, res) => {
    const organization = organizations.find((o) => o.slug === req.params.org);
    return organization ? res.status(200).json(organization) : res.status(404).end();
});

orgsRouter.get("/:org/courses/", (req, res) => {
    return res.status(200).json(courses);
});

export default orgsRouter;
