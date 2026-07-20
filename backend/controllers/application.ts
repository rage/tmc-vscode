import { Router } from "express"

const applicationRounter = Router()

applicationRounter.get("/vscode_plugin/credentials", (_req, res) => {
  return res.json({
    application_id: "1337",
    secret: "mainframe",
  })
})

export default applicationRounter
