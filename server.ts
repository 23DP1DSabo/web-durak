import { createAuthApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const app = createAuthApp(prisma);

app.get("/", (_req: Request, res: Response) =>
  res.redirect("src/pages%20+%20css%20stylesheet/index.html"),
);

const distPath = resolve(process.cwd(), "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
} else {
  console.warn(`Static files directory not found: ${distPath}`);
}

const port = Number(process.env.PORT ?? 3002);
app.listen(port, "0.0.0.0", () => {
  console.log(`Server: http://localhost:${port}`);
});



// import { createAuthApp } from "./app.js";
// import { prisma } from "./lib/prisma.js";
// import { type Request, type Response } from "express";

// const app = createAuthApp(prisma);

// app.get("/", (_req: Request, res: Response) => {
//   res.send("Server is running");
// });

// const port = Number(process.env.PORT ?? 3002);
// app.listen(port, "0.0.0.0", () => {
//   console.log(`Server: http://localhost:${port}`);
// });
