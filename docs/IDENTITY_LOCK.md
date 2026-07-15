# Identity Lock

## Rule
**All** Google, Firebase, Google Cloud Platform (GCP), Gemini, Google ADK (Agent Development Kit), and Hostinger resources for the CRM Feed project must be owned, created, billed, administered, and configured **only** through:

```
nilhan.dev@gmail.com
```

## Scope
This rule applies to, but is not limited to:
- Google Cloud projects, billing accounts, IAM identities, service accounts, API keys, OAuth clients.
- Firebase projects and apps.
- Gemini API keys and Vertex AI resources.
- Google ADK agent runtime, Agent Engine, and deployment targets.
- Hostinger accounts, hosting panels, domains, and DNS.
- Any future cloud resource this project touches.

## Enforcement
- No other Google identity may be used unless Nilhan explicitly changes this rule in writing in this file.
- No cloud resources are created in Round 1. This is a documentation-only lock for now.
- When cloud resources are introduced in later rounds, they must be created from the `nilhan.dev@gmail.com` identity, and evidence of ownership must be recorded in the Evidence folder.
- Service accounts, where used, must be created inside a project owned by `nilhan.dev@gmail.com`.

## Why
This guarantees a single accountable owner for all production resources, avoids orphaned cloud billing, and keeps the audit trail clean.
