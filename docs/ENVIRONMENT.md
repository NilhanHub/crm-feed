# Environment Configuration

All configuration is read from environment variables only. No secrets are hardcoded in source. A central config module (`apps/api/src/config.ts`) reads these values and exposes them as `GEMINI_CONFIG`, `NODE_ENV`, `PATHS.backups`, and safe storage helpers.

## Environment variables

### `PORT`
- **Default:** `8787`
- **Purpose:** Port the Express API listens on.

### `WEB_ORIGIN`
- **Default:** `http://localhost:5173`
- **Purpose:** Origin allowed by CORS (the web UI origin). In production, restrict to the deployed web UI origin.

### `NODE_ENV`
- **Default:** `development`
- **Allowed:** `development` | `production`
- **Purpose:** Node runtime mode. Affects logging and safe defaults.

### `GEMINI_API_KEY`
- **Required:** for live extraction.
- **Purpose:** Gemini API key for the Generative Language API. Get from Google AI Studio (https://aistudio.google.com/apikey) under `nilhan.dev@gmail.com`.
- **Missing behavior:** extraction returns a `missing_credentials` error, creates 0 people, and the app stays healthy. This is **not fatal**.

### `GOOGLE_APPLICATION_CREDENTIALS`
- **Optional.**
- **Purpose:** Path to a GCP service-account JSON file, an alternative auth mechanism to the API key.

### `GEMINI_MODEL`
- **Default:** `gemini-2.0-flash`
- **Purpose:** Gemini model to use. See https://ai.google.dev/gemini-api/docs/models

### `GEMINI_MAX_RETRIES`
- **Default:** `2`
- **Purpose:** Max automatic retries for transient Gemini failures.

### `GEMINI_TIMEOUT_MS`
- **Default:** `60000`
- **Purpose:** Per-request timeout for Gemini calls, in milliseconds.

### `LAST_INTEGRITY_CHECK_STATUS`
- **Default:** unset.
- **Purpose:** Informational only. Set by the data-integrity script after a run (e.g. `pass` / `fail`) so the latest integrity status can be read back. Not required for the app to run.

## `.env` handling
- `.env` is **gitignored** — use it for local development only.
- `.env.local` and `.env.*.local` are also gitignored.
- A `.env.example` file exists at the repo root with **placeholder values only** (no real secrets). Copy it to `.env` and fill in real values.
- **Never commit `.env`.** **Never put secrets in `Evidence/` or any other committed folder.**

## Where NOT to store secrets
- Never commit secrets to the repository.
- Never hardcode API keys in source files.
- Use environment variables or `.env` files only.

## Identity Lock
All Google/Firebase/GCP/Gemini/ADK/Hostinger resources must be owned, created, billed, administered, and configured **only** through:

```
nilhan.dev@gmail.com
```

No other Google identity is allowed unless Nilhan explicitly changes this rule in `docs/IDENTITY_LOCK.md`.

## How missing credentials fail
If `GEMINI_API_KEY` is not set AND `GOOGLE_APPLICATION_CREDENTIALS` is not set:
- The extraction attempt status is `pending_credentials`.
- The error category is `missing_credentials`.
- A clear error message is stored: "No Gemini credentials configured. Set GEMINI_API_KEY or GOOGLE_APPLICATION_CREDENTIALS."
- **No fake extraction is performed.** The app does not invent people.
- The manual payload attach endpoint remains available as a fallback.
- All other app functionality (upload, review, email, export) works normally.

## Future CRM API environment variables (Round 5+)
- `CRM_API_URL` — CRM API endpoint
- `CRM_API_KEY` — CRM API authentication
- These are not implemented yet. Until they exist, exports use the export contract (JSON/CSV/manifest) and `liveCrmSync=false`.
