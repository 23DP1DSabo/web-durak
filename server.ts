import { createAuthApp } from "./app.js";
import { prisma } from "./lib/prisma.ts";
import express from "express";
import { fileURLToPath } from "node:url";
const app = createAuthApp(prisma);
app.get("/", (_req, res) => res.redirect("/pages%20+%20css%20stylesheet/index.html"));
app.use(express.static(fileURLToPath(new URL("./dist", import.meta.url))));
const port = Number(process.env.PORT ?? 3002);
app.listen(port, () => console.log(`Server: http://localhost:${port}`));
