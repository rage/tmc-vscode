import * as path from "path"

import { Router } from "express"

import { respondWithFile } from "../utils"

const CLI_DIR = path.resolve(__dirname, "..", "cli")

const langsRouter = Router()

langsRouter.get("/:file", (req, res) => {
  const file = req.params.file
  // Express decodes `%2F` in a param, so `..%2F` would otherwise escape CLI_DIR.
  if (path.basename(file) !== file || file === "..") {
    res.status(404).end()
    return
  }
  respondWithFile(res, path.join(CLI_DIR, file))
})

export default langsRouter
