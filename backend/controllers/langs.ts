import { Router } from "express";
import path from "path";

const langsRouter = Router();

langsRouter.get("/", (request, response) => {
    return response.sendFile(
        path.resolve(__dirname, "..", "resources", "tmc-langs-cli-0.8.5-SNAPSHOT.jar"),
    );
});

export default langsRouter;
