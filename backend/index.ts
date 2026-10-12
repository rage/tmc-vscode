import express from "express"

import { langsRouter, registerV8Routes } from "./controllers"
import { registerMoocRoutes } from "./mooc/router"

// Env-overridable so a test can run a second, isolated instance beside this one.
const PORT = Number(process.env.PORT ?? 4001)
// Loopback only: the langs route serves files off disk, and nothing reaches the mock from elsewhere.
const HOST = "127.0.0.1"

const app = express()
app.use((req, _res, next) => {
  const [url, params] = req.url.split("?")
  console.log(req.method, url, params ?? "")
  next()
})
app.use("/langs", langsRouter)

const mooc = registerMoocRoutes(app, { baseUrl: `http://localhost:${PORT}` })
registerV8Routes(app, { introspectMoocToken: mooc.introspect })

app.use((_req, res) => {
  console.log("Unknown endpoint")
  res.status(404).json({ error: "Unhandled endpoint" })
})

app.listen(PORT, HOST, (error) => {
  if (error) {
    console.error(`Could not listen on ${HOST}:${PORT}:`, error.message)
    process.exit(1)
  }
  console.log("Server listening to", PORT)
})
