import { Router } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { batches, screenshots } from "../store/db.js";
import { PATHS } from "../config.js";
import { newId, nowIso } from "../util/id.js";
import { writeAudit } from "../audit/writer.js";

export const screenshotsRouter = Router();

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PATHS.uploads),
  filename: (_req, file, cb) => {
    const id = newId("shot");
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`unsupported_file_type: ${file.mimetype}`));
  },
});

function sha256OfFile(p: string): string {
  const buf = fs.readFileSync(p);
  return createHash("sha256").update(buf).digest("hex");
}

screenshotsRouter.post("/:batchId/screenshots", upload.array("screenshots", 50), async (req, res) => {
  const batch = await batches.get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: "batch_not_found" });

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    return res.status(400).json({ error: "no_files_uploaded" });
  }

  const created = [];
  for (const file of files) {
    if (!file.path || !file.filename) continue;
    const sha = sha256OfFile(file.path);
    const shot = {
      id: newId("shot"),
      batchId: batch.id,
      originalFilename: file.originalname,
      storedFilename: file.filename,
      storagePath: path.relative(PATHS.repoRoot, file.path).replace(/\\/g, "/"),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      sha256: sha,
      uploadedAt: nowIso(),
    };
    await screenshots.set(shot);
    await writeAudit({
      eventType: "screenshot_uploaded",
      companyId: batch.companyId,
      batchId: batch.id,
      screenshotId: shot.id,
      detail: `${shot.originalFilename} (${shot.sizeBytes} bytes, sha256 ${shot.sha256.slice(0, 12)}…)`,
    });
    created.push(shot);
  }

  res.status(201).json({ batchId: batch.id, screenshots: created });
});

screenshotsRouter.get("/:batchId/screenshots", async (req, res) => {
  const batch = await batches.get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: "batch_not_found" });
  const all = await screenshots.all();
  res.json(all.filter((s) => s.batchId === batch.id));
});
