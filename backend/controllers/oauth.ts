import { Response, Router } from "express";

/* eslint-disable @typescript-eslint/naming-convention */
interface Token {
    access_token: string;
    token_type: "bearer";
    scope: "public";
    created_at: number;
}
/* eslint-enable @typescript-eslint/naming-convention */

const USER = {
    username: "TestMyExtension",
    password: "hunter2",
};

const oauthRouter = Router();

oauthRouter.post("/token", (req, res: Response<Token>) => {
    const { username, password } = req.body;
    console.log("Username:" + username, "Password:", password);

    if (username === password) {
        return res.json({
            access_token: username,
            token_type: "bearer",
            scope: "public",
            created_at: 1234567890,
        });
    }

    const isTestUser = username === USER.username && password === USER.password;
    const isStudent = username === "student" && password === "student";
    if (isTestUser || isStudent) {
        return res.json({
            access_token: "token",
            token_type: "bearer",
            scope: "public",
            created_at: 1234567890,
        });
    } else {
        return res.status(401).end();
    }
});

export default oauthRouter;
