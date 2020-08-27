import { Router } from "express";
import * as path from "path";

const langsRouter = Router();

langsRouter.get("/:version", async (req, res) => {
    return res.sendFile(path.resolve(__dirname, "..", "cli", req.params.version), (error) => {
        if (!error) {
            console.log("Sent", req.params.version);
        } else {
            console.error("Failed to send requested file:", JSON.stringify(error));
        }
    });
});

export default langsRouter;
