// Load .env before any config — never expose the key
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Walk up from dist/ to find repo root .env
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
let envDir = scriptDir;
for (let i = 0; i < 10; i++) {
  if (fs.existsSync(path.join(envDir, ".env.example"))) {
    dotenv.config({ path: path.join(envDir, ".env") });
    break;
  }
  const parent = path.dirname(envDir);
  if (parent === envDir) break;
  envDir = parent;
}

import { createApp } from "./app.js";
import { PORT } from "./config.js";
import { PATHS } from "./config.js";

const app = createApp();

const server = app.listen(PORT, () => {
  console.log(`[crm-feed-api] listening on http://localhost:${PORT}`);
  console.log(`[crm-feed-api] uploads: ${PATHS.uploads}`);
  console.log(`[crm-feed-api] db:      ${PATHS.db}`);
  console.log(`[crm-feed-api] exports: ${PATHS.exports}`);
  if (process.env.GEMINI_API_KEY) {
    console.log(`[crm-feed-api] extraction: gemini key present`);
  } else {
    console.log(`[crm-feed-api] extraction: pending credentials — attach payloads via /api/extraction-runs/:id/payload`);
  }
});

server.on("error", (err) => {
  console.error("[crm-feed-api] failed to start:", err);
  process.exit(1);
});
