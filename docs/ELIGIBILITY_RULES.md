# Eligibility Rules

These rules are implemented as **deterministic real code** in `packages/shared/src/rules/eligibility.ts` and unit-tested. They are not AI-generated and not configurable by prompts.

## Inclusion criteria (ALL must hold)
1. **Currently at target company.** The person must have at least one `currentRoles[]` entry whose `company` matches the batch's `targetCompanyName` (case-insensitive, trimmed). Past-only people are **excluded**.
2. **At least one named mutual contact.** The person must have ≥1 entry in `mutualContacts.named[]`. People with only a `vagueCount` and no named mutuals are **excluded**.

## Exclusion rules
- **Past-only people:** excluded (see above). Retained in DB for audit, never emailed.
- **Vague mutual counts** (e.g. "2 other mutual connections"): recorded as `MutualContact { excludedFromEmail: true }`. **Never** included in email text. Never counted toward the "named mutual" requirement.
- **Duplicates:** the same person (matched by normalised name + target company) must not appear twice in selected output. De-duplicate, keeping the higher-confidence record.

## Caps
- **Max 7 named mutual contacts per target person** in email output. If more than 7 named mutuals exist, keep the first 7 (stable order: as extracted).
- **Max 10 selected target people per company** in a single email draft. If more than 10 are eligible+approved, take the top 10 by ranking score (see below).

## Role prioritisation (ranking)
Ranking scores target relevance. Higher score = more relevant. Used to order and cap people, and to break ties.

**Prioritise (higher weight):**
CEO, COO, CTO, CIO, Head of IT, IT Director, Infrastructure, Cyber, Digital, Transformation, Operations, Procurement, Vendor, Supplier.

**De-prioritise (lower weight) unless no better option or strategically useful:**
HR, Marketing, Talent, Comms, Recruiting, People.

Scoring approach (deterministic):
- Base score from the highest-priority role keyword found in the person's `title`/`headline`/`currentRoles`.
- Priority roles: +100 weight (tier weights vary by exactness, e.g. C-suite title start = highest).
- De-prioritised roles: +10 weight.
- No matching keyword: +30 weight (neutral, above de-prioritised, below priority).
- Tie-break by `confidence` desc, then normalised name asc.

## Email cleanliness (enforced by formatter, not by eligibility)
- The final email must never mention screenshots, OCR, extraction, analysis, or "found via".
- The final email must never print "no mutual contacts" or vague mutual counts.
- Only named mutuals appear, capped at 7.
- Only approved + currently-at-target + named-mutual people appear, capped at 10.
- **No Markdown bold** (`**` or `__`) in the email — plain names only.
- **No screenshot/OCR/source wording** in the email.

## Latest review state (Round 2)
- Only the **latest** `ReviewDecision` per `ExtractedPerson` is authoritative.
- If a person is approved then later rejected, the latest rejection wins — they are excluded.
- If a person is rejected then later approved, the latest approval wins — they are included (if otherwise eligible).
- `needs_review` is treated as not-approved (person is excluded from email/export until explicitly approved).
- The latest reviewer note is retained on the current review state.
- This rule is implemented by `projectLatestReviewState` in `packages/shared` and used by API email, export, and review queue endpoints.

## Determinism
Given the same inputs, eligibility and ranking always produce identical output. No randomness, no LLM judgement in this stage.
