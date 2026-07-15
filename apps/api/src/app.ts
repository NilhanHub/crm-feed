import express from "express";
import cors from "cors";
import { WEB_ORIGIN, PATHS } from "./config.js";
import { healthRouter } from "./routes/health.js";
import { companiesRouter } from "./routes/companies.js";
import { batchesRouter } from "./routes/batches.js";
import { screenshotsRouter } from "./routes/screenshots.js";
import { extractionRouter } from "./routes/extraction.js";
import { extractionRunRouter } from "./routes/extractionRun.js";
import { reviewsRouter } from "./routes/reviews.js";
import { emailRouter } from "./routes/email.js";
import { exportsRouter } from "./routes/exports.js";
import { statusRouter } from "./routes/status.js";
import { auditRouter } from "./routes/audit.js";
import { intakeRouter } from "./routes/intake.js";
import { masterDbRouter } from "./routes/masterDb.js";

export function createApp(): express.Express {
  const app = express();
  app.use(cors({ origin: [WEB_ORIGIN, "http://127.0.0.1:5173"] }));
  app.use(express.json({ limit: "5mb" }));

  app.get("/", (_req, res) =>
    res.json({ service: "crm-feed-api", docs: "/api/health" })
  );

  // Serve permanently stored screenshots to the web UI (local dev only).
  app.use("/data/uploads", express.static(PATHS.uploads));

  app.use("/api/health", healthRouter);
  app.use("/api/companies", companiesRouter);
  app.use("/api/batches", batchesRouter);
  app.use("/api/batches", screenshotsRouter);
  app.use("/api/extraction-runs", extractionRouter);
  app.use("/api/extraction", extractionRunRouter);
  app.use("/api/reviews", reviewsRouter);
  app.use("/api/email-drafts", emailRouter);
  app.use("/api/exports", exportsRouter);
  app.use("/api/status", statusRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/intake", intakeRouter);
  app.use("/api/master", masterDbRouter);

  // Central error handler — never expose stack traces to the client.
  app.use(
    (
      err: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      const status = err.status ?? 400;
      res.status(status).json({ error: "request_failed", detail: err.message });
    }
  );

  return app;
}
