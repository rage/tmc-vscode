import type { Response } from "express"
import { Router } from "express"

import { MOCK_TMC_ACCESS_TOKEN } from "./accessToken"

interface Token {
  access_token: string
  token_type: "bearer"
  scope: "public"
  created_at: number
}

const USER = {
  username: "TestMyExtension",
  password: "hunter2",
}

const oauthRouter = Router()

const issuedToken: Token = {
  access_token: MOCK_TMC_ACCESS_TOKEN,
  token_type: "bearer",
  scope: "public",
  created_at: 1234567890,
}

oauthRouter.post("/token", (req, res: Response<Token>) => {
  const { username, password } = req.body
  console.log("Username:", username, "Password:", password)

  const isMatchingPair = username === password
  const isTestUser = username === USER.username && password === USER.password
  const isStudent = username === "student" && password === "student"
  if (isMatchingPair || isTestUser || isStudent) {
    return res.json(issuedToken)
  }
  return res.status(401).end()
})

export default oauthRouter
