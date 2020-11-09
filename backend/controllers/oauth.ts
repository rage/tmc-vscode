import { Response, Router } from "express";

interface Token {
    access_token: string;
    token_type: "bearer";
    scope: "public";
    created_at: number;
}

const USER = {
    username: "TestMyExtension",
    password: "hunter2",
};

const oauthRouter = Router();

oauthRouter.post("/token", (req, res: Response<Token>) => {
    const { username, password } = req.body;
    console.log("Username:" + username, "Password:", password);

    return username === USER.username && password === USER.password
        ? res.json({
              access_token: "1234",
              token_type: "bearer",
              scope: "public",
              created_at: 1234567890,
          })
        : res.status(401).end();
});

export default oauthRouter;
