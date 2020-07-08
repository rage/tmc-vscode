import express from "express";

import { langsRounter, orgsRouter } from "./controllers";

const PORT = 4001;

const app = express();

app.use("/langs", langsRounter);

app.use("/org", orgsRouter);
app.use("/org.json", orgsRouter);
app.use("/core/org", orgsRouter);

app.listen(PORT, () => {
    console.log("Server listening to", PORT);
});
