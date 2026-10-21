import { createServer } from "node:http";
import { attachRealtime } from "./lib/realtime.js";
import { createAuthApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Establish the pool before reporting readiness so the first player does not
// pay the connection handshake and capability-discovery cost.
await prisma.$connect();

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

const port = Number(process.env.PORT ?? 3003);
const httpServer = createServer(app);
attachRealtime(httpServer, app.locals.matches);
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Server: http://localhost:${port}`);
});
