import { Router } from "express";

import { Course, Organization } from "../../src/api/types";

const organizations: Organization[] = [
    {
        name: "Mock Organization",
        information: "This is a mock organization provided from a local development server.",
        slug: "mock",
        logo_path: "",
        pinned: true,
    },
    {
        name: "Test organization",
        information: "Another organization to populate the list.",
        slug: "test",
        logo_path: "",
        pinned: false,
    },
];

const courses: Course[] = [
    {
        comet_url: "",
        description: "This is a mock course provided from a local development server.",
        details_url: "",
        id: 1,
        name: "mock-course",
        reviews_url: "",
        spyware_urls: [],
        title: "Mock Course",
        unlock_url: "",
    },
];

const orgsRouter = Router();

orgsRouter.get("/", (request, response) => {
    console.log(request.url);
    return response.status(200).json(organizations);
});

orgsRouter.get("/:org.json", (request, response) => {
    console.log(request.url);
    const organization = organizations.find((o) => o.slug === request.params.org);
    return organization ? response.status(200).json(organization) : response.status(404).end();
});

orgsRouter.get("/:org/courses/", (request, response) => {
    console.log(request.url);
    return response.status(200).json(courses);
});

export default orgsRouter;
