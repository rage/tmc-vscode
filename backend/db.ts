import { Course, Organization } from "../src/api/types";

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

interface User {
    id: number;
    username: string;
    password: string;
}

const users: User[] = [
    {
        id: 0,
        username: "TestMyExtension",
        password: "hunter2",
    },
];

export default {
    courses,
    organizations,
    users,
};
