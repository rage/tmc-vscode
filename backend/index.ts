import bodyParser from "body-parser";
import express from "express";

import {
    coreCoursesRouter,
    coursesRouter,
    langsRounter,
    oauthRouter,
    orgsRouter,
} from "./controllers";

const PORT = 4001;

const app = express();

app.use((req, res, next) => {
    console.log(req.method, req.url);
    next();
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use("/oauth", oauthRouter);

app.use("/langs", langsRounter);

app.use("/core/courses", coreCoursesRouter);
app.use("/courses", coursesRouter);

app.use("/org", orgsRouter);
app.use("/org.json", orgsRouter);
app.use("/core/org", orgsRouter);

app.use((req, res) => {
    console.log("Unknown endpoint");
    res.status(404).json({ error: "Unhandled endpoint" });
});

app.listen(PORT, () => {
    console.log("Server listening to", PORT);
});
