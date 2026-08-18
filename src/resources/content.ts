/**
 * @fileoverview Markdown documentation exposed as MCP resources.
 *
 * These strings are the human/agent-readable description of the ShapeShyft API:
 * architecture, route reference, data model, worked examples, error handling,
 * and provider guidance. They are embedded as source so the bundled server stays
 * self-contained.
 */

export const OVERVIEW_MD = `# ShapeShyft API — Overview

ShapeShyft turns an LLM prompt into a **versioned REST endpoint that returns
schema-conformant JSON**. You configure an endpoint once (provider key, model,
instructions, system context, input schema, output schema); callers then POST
(or GET) plain data to a stable URL and get structured JSON back, plus token,
latency, and cost accounting.

- API: Hono on Bun, PostgreSQL (\`shapeshyft\` schema) via Drizzle ORM
- Base path: \`/api/v1\` (health checks live outside it)
- Production base URL: \`https://api.shapeshyft.ai\`
- Supported providers: OpenAI, Anthropic, Google Gemini, Mistral, Cohere, Groq,
  xAI, DeepSeek, Perplexity, and any OpenAI-compatible server via \`lm_studio\`

## The object hierarchy

\`\`\`
User (Firebase account)
└── Personal API keys   shyft_... credentials for CLIs, MCP servers, scripts

Entity (tenant: personal workspace or organization, identified by entitySlug)
├── LLM API keys        provider credentials, encrypted at rest
├── Storage config      optional GCS/S3 bucket for generated media
└── Projects            one caller-facing API key each (sk_live_...)
    └── Endpoints       model + schemas + instructions + access control
        └── Usage analytics   one row per invocation (success or failure)
\`\`\`

\`entitySlug\` (1–12 chars) is the tenant key in every admin URL, and it is also
the \`organizationPath\` segment of the public AI URL.

## Two authentication schemes

| Route family | Credential | Header |
|---|---|---|
| \`/api/v1/ai/*\` | Project API key \`sk_live_...\` | \`Authorization: Bearer sk_live_...\` (or \`?api_key=\`) |
| \`/api/v1/providers/*\`, \`/health*\`, \`/\` | none | — |
| everything else | Personal API key \`shyft_...\` | \`X-API-Key: shyft_...\` |
| everything else | Firebase ID token | \`Authorization: Bearer <firebase-id-token>\` |

**Two different key types.** A *project* key (\`sk_live_...\`) lets anyone invoke
one published AI endpoint. A *personal* key (\`shyft_...\`) authenticates its owner
against the admin routes, carrying exactly the access that user has, across every
entity they belong to. The prefix is what routes an incoming credential.

The admin routes accept either credential and behave identically: a personal key
is resolved by SHA-256 hash to its owner's Firebase UID, and every handler then
sees the same \`userId\`, \`userEmail\`, and \`siteAdmin\` a token would have set.
Two operations are the exception — creating and revealing API keys require a
Firebase ID token, so a leaked key cannot mint further credentials.

Personal keys do not expire, which is what makes non-browser clients (CLIs, MCP
servers, cron jobs) practical; Firebase ID tokens expire in about an hour.

Public routes are registered *before* the admin router, whose wildcard
\`firebaseAuthMiddleware\` would otherwise intercept them. Anonymous Firebase users
are rejected. Verified tokens are cached for ~5 minutes, so a revoked token can
remain usable for up to that long.

On GET AI requests every query parameter becomes part of the endpoint input —
including \`api_key\` and \`testMode\` if you put them there. Prefer the
\`Authorization\` header for GET endpoints.

## Response envelope

Every response, success or failure, is wrapped:

\`\`\`json
{ "success": true,  "data": { }, "timestamp": "2026-08-17T10:00:00.000Z" }
{ "success": false, "error": "Project not found", "timestamp": "..." }
\`\`\`

LLM execution failures add a \`details\` object with provider-specific diagnostics.

## Request lifecycle for \`POST /api/v1/ai/:orgPath/:projectName/:endpointName\`

1. Resolve the entity by slug, then the active project by name.
2. Validate the project API key (timing-safe comparison against the encrypted key).
3. Resolve the active endpoint by name; enforce its IPv4 allowlist if set.
4. Enforce \`http_method\` — a mismatch is \`405\`.
5. Read input: JSON body for POST, query parameters for GET.
6. Enforce per-entity rate limits from the RevenueCat entitlement (site-admin-owned
   entities are exempt; skipped entirely when RevenueCat is not configured).
7. Extract media from the input (data URLs, \`gs://\` URLs), convert unsupported
   image formats to PNG, and validate the model's capabilities.
8. Build the prompt: system context + instructions + schema-derived output
   requirements, then call the provider with its native structured-output mode.
9. Record a usage-analytics row (tokens, latency, estimated cost) and return
   \`{ output, usage, generated_media? }\`.

## Structured output strategy per provider

| Provider | Mechanism |
|---|---|
| OpenAI, Groq, Mistral, xAI, DeepSeek, Perplexity, Cohere | function calling (\`tools\` + \`tool_choice\`) |
| Anthropic | \`tool_use\` |
| Gemini | native \`responseMimeType: application/json\` + \`responseSchema\` |
| LM Studio / custom | prompt instructions + multi-format JSON extraction |

## Reserved input fields

Two field names in the input payload are interpreted rather than passed to the model:

- \`context\` — a non-empty string overrides the endpoint's configured system context for that call.
- \`web_search\` — \`false\` disables web search for that call. It can only turn search
  *off*; an endpoint without \`web_search\` enabled cannot opt in per request.

## Limits and constraints

- Request body limit: 50 MB (base64 media payloads count against it).
- \`entitySlug\`: 1–12 characters.
- \`project_name\` / \`endpoint_name\`: lowercase alphanumeric with interior hyphens.
- \`organization_path\` (user settings): letters, numbers, and underscores only.
- \`instructions\` and \`context\`: 10,000 characters each.
- Media input accepts data URLs and \`gs://\` URLs only — plain \`http(s)\` URLs are
  rejected to prevent SSRF.
- Generated media returned as \`url\` is stored in the entity's bucket with signed
  URLs that expire after 7 days.`;

export const ROUTES_MD = `# ShapeShyft API — Route Reference

Auth legend: **none** = public · **key** = personal API key (\`shyft_...\`) ·
**fb** = Firebase ID token · **fb / key** = either one.

## Health (outside \`/api/v1\`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | \`/\` | none | \`{ name, version, status }\` |
| GET | \`/health\` | none | Liveness only |
| GET | \`/health/ready\` | none | Runs \`SELECT 1\`; \`503\` when the database is unreachable |

## Public — AI invocation

\`:organizationPath\` is the entity slug; \`:projectName\` and \`:endpointName\` are
slugs, not UUIDs. The endpoint's configured \`http_method\` decides which verb is
accepted; the other returns \`405\`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET/POST | \`/api/v1/ai/:organizationPath/:projectName/:endpointName\` | project key | Execute the endpoint → \`{ output, usage, generated_media? }\` |
| GET/POST | \`/api/v1/ai/:organizationPath/:projectName/:endpointName/prompt\` | project key | Build the prompt without calling the LLM → \`{ prompt }\` |

Optional query parameter \`testMode=true\` resolves entitlements against RevenueCat
sandbox purchases. On GET endpoints it also lands in the input payload.

## Public — provider catalog

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | \`/api/v1/providers\` | none | All providers (\`ProviderConfig[]\`), cached 1 h |
| GET | \`/api/v1/providers/:provider\` | none | One provider |
| GET | \`/api/v1/providers/:provider/models\` | none | \`{ provider, models: [{ id, capabilities, pricing }] }\` |

## Entities

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | \`/api/v1/entities\` | fb | Entities the caller belongs to, each with \`userRole\` |
| POST | \`/api/v1/entities\` | fb | Body \`{ displayName, entitySlug?, description? }\` → creator becomes owner |
| GET | \`/api/v1/entities/:entitySlug\` | fb | \`403\` when not a member |
| PUT | \`/api/v1/entities/:entitySlug\` | fb | Owner/manager |
| DELETE | \`/api/v1/entities/:entitySlug\` | fb | Owner; organizations only |

### Members

\`:memberId\` is the member's **Firebase UID**, not the membership row id.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | \`/api/v1/entities/:entitySlug/members\` | fb | Requires view permission |
| PUT | \`/api/v1/entities/:entitySlug/members/:memberId\` | fb | Body \`{ role }\` — \`owner\` \\| \`manager\` \\| \`member\` |
| DELETE | \`/api/v1/entities/:entitySlug/members/:memberId\` | fb | Requires member management permission |

### Invitations

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | \`/api/v1/entities/:entitySlug/invitations\` | fb | Pending invitations for the entity |
| POST | \`/api/v1/entities/:entitySlug/invitations\` | fb | Body \`{ email, role }\`; sends email, returns the accept \`token\` |
| PUT | \`/api/v1/entities/:entitySlug/invitations/:invitationId\` | fb | Renew (fresh 14-day expiry) and resend |
| DELETE | \`/api/v1/entities/:entitySlug/invitations/:invitationId\` | fb | Cancel |
| GET | \`/api/v1/invitations\` | fb | Invitations addressed to the caller's email |
| POST | \`/api/v1/invitations/:token/accept\` | fb | Join the entity |
| POST | \`/api/v1/invitations/:token/decline\` | fb | Decline |

## LLM provider keys

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | \`/api/v1/entities/:entitySlug/keys\` | fb | \`LlmApiKeySafe[]\` — secrets never returned |
| GET | \`/api/v1/entities/:entitySlug/keys/:keyId\` | fb | |
| POST | \`/api/v1/entities/:entitySlug/keys\` | fb | \`{ key_name, provider, api_key?, endpoint_url? }\`; \`lm_studio\` needs \`endpoint_url\`, all others need \`api_key\` |
| PUT | \`/api/v1/entities/:entitySlug/keys/:keyId\` | fb | \`{ key_name?, api_key?, endpoint_url?, is_active? }\` |
| DELETE | \`/api/v1/entities/:entitySlug/keys/:keyId\` | fb | |

## Projects

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | \`/api/v1/entities/:entitySlug/projects\` | fb | |
| GET | \`/api/v1/entities/:entitySlug/projects/:projectId\` | fb | |
| POST | \`/api/v1/entities/:entitySlug/projects\` | fb | \`{ project_name, display_name, description? }\`; generates the project API key |
| PUT | \`/api/v1/entities/:entitySlug/projects/:projectId\` | fb | \`{ project_name?, display_name?, description?, is_active? }\` |
| DELETE | \`/api/v1/entities/:entitySlug/projects/:projectId\` | fb | |
| GET | \`/api/v1/entities/:entitySlug/projects/:projectId/api-key\` | fb | \`{ api_key }\` — full decrypted key |
| POST | \`/api/v1/entities/:entitySlug/projects/:projectId/api-key/refresh\` | fb | Rotate → \`{ api_key, api_key_prefix, api_key_created_at }\` |

## Endpoints

Base: \`/api/v1/entities/:entitySlug/projects/:projectId/endpoints\`

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | \`\` | fb | List |
| GET | \`/:endpointId\` | fb | |
| POST | \`\` | fb | Requires \`endpoint_name\`, \`display_name\`, \`llm_key_id\` |
| PUT | \`/:endpointId\` | fb | Partial update; also \`is_active\` and \`ip_allowlist\` |
| DELETE | \`/:endpointId\` | fb | |

## Analytics

| Method | Path | Auth | Query |
|---|---|---|---|
| GET | \`/api/v1/entities/:entitySlug/analytics\` | fb | \`start_date\`, \`end_date\` (\`YYYY-MM-DD\`), \`project_id\`, \`endpoint_id\` |

Returns \`{ aggregate, by_endpoint[] }\`.

## Rate limits

\`:rateLimitUserId\` is the entity slug.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | \`/api/v1/ratelimits/:rateLimitUserId\` | fb | Tiers, current entitlement, limits, and usage |
| GET | \`/api/v1/ratelimits/:rateLimitUserId/history/:periodType\` | fb | \`periodType\` = \`hour\` \\| \`day\` \\| \`month\`, up to 100 entries |

Both accept \`?testMode=true\`.

## Storage (generated media)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | \`/api/v1/entities/:entitySlug/storage\` | fb | Safe config; \`404\` when unset |
| POST | \`/api/v1/entities/:entitySlug/storage\` | fb | Upsert with credentials |
| PUT | \`/api/v1/entities/:entitySlug/storage\` | fb | Partial update; credentials optional |
| DELETE | \`/api/v1/entities/:entitySlug/storage\` | fb | |

## Users and settings

These require the \`:userId\` in the path to match the token's UID (\`403\` otherwise).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | \`/api/v1/users/me\` | fb / key | The authenticated caller: \`firebase_uid\`, \`email\`, \`siteAdmin\`, \`auth_method\` |
| GET | \`/api/v1/users/:userId\` | fb / key | Profile plus \`siteAdmin\` |
| GET | \`/api/v1/users/:userId/subscriptions\` | fb | RevenueCat subscription state |
| GET | \`/api/v1/users/:userId/settings\` | fb | Returns generated defaults with \`is_default: true\` when unsaved |
| PUT | \`/api/v1/users/:userId/settings\` | fb / key | Upsert \`{ organization_name?, organization_path? }\`; \`409\` when the path is taken |

## Personal API keys

Keys are scoped to a user, not an entity: a key carries exactly the access its
owner has. The \`:userId\` must match the authenticated caller.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | \`/api/v1/users/:userId/api-keys\` | fb / key | Metadata only, newest first |
| POST | \`/api/v1/users/:userId/api-keys\` | **fb only** | \`{ key_name }\` → the full \`shyft_...\` value, returned once |
| GET | \`/api/v1/users/:userId/api-keys/:keyId\` | fb / key | Metadata for one key |
| GET | \`/api/v1/users/:userId/api-keys/:keyId/reveal\` | **fb only** | \`{ api_key }\` — copy an existing key again |
| PUT | \`/api/v1/users/:userId/api-keys/:keyId\` | fb / key | \`{ key_name?, is_active? }\` |
| DELETE | \`/api/v1/users/:userId/api-keys/:keyId\` | fb / key | Permanent revocation |

Create and reveal refuse a key-authenticated caller with \`403\`, so a leaked key
cannot mint further credentials or read its siblings.`;

export const DATA_MODEL_MD = `# ShapeShyft API — Data Model

Field names in API payloads are \`snake_case\` for ShapeShyft-owned resources
(projects, endpoints, keys, analytics, settings) and \`camelCase\` for the shared
entity resources (entities, members, invitations). This mirrors the two
underlying services and is not a documentation slip.

## Entity

\`\`\`ts
interface Entity {
  id: string;                                  // UUID
  entitySlug: string;                          // 1-12 chars; used in every admin URL
  entityType: "personal" | "organization";     // personal is auto-created, undeletable
  displayName: string;
  description: string | null;
  avatarUrl: string | null;
  createdAt: string;                           // ISO 8601
  updatedAt: string;
}

// GET /entities and GET /entities/:entitySlug add the caller's role:
interface EntityWithRole extends Entity { userRole: "owner" | "manager" | "member" }
\`\`\`

Roles: \`owner\` — full access including member management (organizations only);
\`manager\` — manage projects, endpoints, and keys (the default role in a personal
entity); \`member\` — read-only.

## EntityMember / EntityInvitation

\`\`\`ts
interface EntityMember {
  id: string; entityId: string;
  userId: string;                              // Firebase UID — this is the :memberId path param
  role: "owner" | "manager" | "member";
  isActive: boolean; joinedAt: string; createdAt: string; updatedAt: string;
  user?: { id: string; email: string | null; displayName: string | null };
}

interface EntityInvitation {
  id: string; entityId: string; email: string;
  role: "owner" | "manager" | "member";
  status: "pending" | "accepted" | "declined" | "expired";
  invitedByUserId: string;
  token: string;                               // used by /invitations/:token/accept
  expiresAt: string;                           // 14 days from creation or renewal
  acceptedAt: string | null; createdAt: string; updatedAt: string;
}
\`\`\`

## UserApiKey

A personal credential (\`shyft_...\`) that authenticates its owner against the
admin routes. Stored as a SHA-256 hash for lookup plus an AES-256-CBC encrypted
copy so the owner can reveal it again; the secret is never in a listing.

\`\`\`ts
interface UserApiKey {
  uuid: string;
  firebase_uid: string;                        // owner
  key_name: string;                            // e.g. "Claude Code on my laptop"
  key_prefix: string;                          // e.g. "shyft_ab12cd" — display only
  is_active: boolean;                          // false blocks the key without deleting it
  last_used_at: string | null;                 // ISO 8601; written at most every 5 minutes
  created_at: string | null;
  updated_at: string | null;
}

// POST .../api-keys returns the metadata plus the secret, once:
interface UserApiKeyCreated extends UserApiKey { api_key: string }

// GET .../api-keys/:keyId/reveal returns just:
interface UserApiKeyRevealed { api_key: string }

// GET /users/me — the only way a key-authenticated caller learns its own UID:
interface CurrentUser {
  firebase_uid: string;
  email: string | null;
  siteAdmin: boolean;
  auth_method: 'firebase' | 'api_key';
  display_name: string | null;
}
\`\`\`

## LlmApiKeySafe

The provider secret is AES-256-CBC encrypted at rest and never leaves the server.

\`\`\`ts
interface LlmApiKeySafe {
  uuid: string; entity_id: string;
  key_name: string;
  provider: "openai" | "anthropic" | "gemini" | "mistral" | "cohere"
          | "groq" | "xai" | "deepseek" | "perplexity" | "lm_studio";
  has_api_key: boolean;                        // whether a secret is stored
  endpoint_url: string | null;                 // required for lm_studio
  is_active: boolean | null;                   // null means true
  created_at: string | null; updated_at: string | null;
}
\`\`\`

## Project

\`\`\`ts
interface Project {
  uuid: string; entity_id: string;
  project_name: string;                        // slug used in the public AI URL
  display_name: string;
  description: string | null;
  is_active: boolean | null;                   // false hides every endpoint (404 on invoke)
  api_key_prefix: string | null;               // e.g. "sk_live_ab" — first 12 chars, display only
  api_key_created_at: string | null;
  created_at: string | null; updated_at: string | null;
}
\`\`\`

The full key (\`sk_live_\` + 32 random bytes, base64url) is only returned by
\`GET .../api-key\` and \`POST .../api-key/refresh\`.

## Endpoint

\`\`\`ts
interface Endpoint {
  uuid: string; project_id: string;
  endpoint_name: string;                       // slug used in the public AI URL
  display_name: string;
  http_method: "GET" | "POST";                 // callers must match it or get 405
  llm_key_id: string;                          // UUID of an LlmApiKey
  model: string | null;                        // null uses the provider default
  input_schema: JsonSchema | null;             // documents the caller payload (see note below)
  output_schema: JsonSchema | null;            // drives structured output
  instructions: string | null;                 // the task (max 10k chars)
  context: string | null;                      // system context (max 10k chars)
  is_active: boolean | null;
  ip_allowlist: string[] | null;               // IPv4 only; null/empty = unrestricted
  expects_media_output: { audio?: boolean; image?: boolean; video?: boolean } | null;
  output_media_format: "base64" | "url" | null;
  transcription_extraction_model: string | null; // second pass for Whisper endpoints
  web_search: boolean;
  created_at: string | null; updated_at: string | null;
}
\`\`\`

Note on \`input_schema\`: the API stores and returns it, and the dashboard uses it to
generate forms and examples, but the invocation path does **not** currently reject a
payload that violates it. Treat it as the contract you publish to callers, not as a
server-side guard.

## Invocation response

\`\`\`ts
interface AiExecutionResponse {
  output: unknown;                             // conforms to output_schema
  usage: {
    tokens_input: number;
    tokens_output: number;
    latency_ms: number;
    estimated_cost_cents: number;
  };
  generated_media?: {                          // only for generative models
    type: "image" | "audio" | "video";
    mimeType: string;
    data: string;                              // base64 payload or signed URL
  }[];
}

interface AiPromptResponse { prompt: string }   // from the /prompt route
\`\`\`

## Usage analytics

One row is written per invocation, successes and failures alike.

\`\`\`ts
interface UsageAggregate {
  total_requests: number; successful_requests: number; failed_requests: number;
  total_tokens_input: number; total_tokens_output: number;
  total_estimated_cost_cents: number;          // cents
  average_latency_ms: number;
}
interface AnalyticsResponse {
  aggregate: UsageAggregate;
  by_endpoint: (UsageAggregate & { endpoint_id: string; endpoint_name: string })[];
}
\`\`\`

## Model capabilities and pricing

\`\`\`ts
interface ModelCapabilities {
  visionInput?: boolean; audioInput?: boolean; videoInput?: boolean;
  imageOutput?: boolean; audioOutput?: boolean; videoOutput?: boolean;
  webSearch?: boolean;
  mediaFormats?: {                             // accepted input encodings per media type
    imageFormats?: MediaInputFormat[];   // "url" | "base64" | "gcs" | "s3" | "file"
    audioFormats?: MediaInputFormat[]; videoFormats?: MediaInputFormat[];
  };
}

interface ModelPricing {                       // all values in cents
  input: number; output: number;               // per 1M tokens
  imageInput?: number; imageOutput?: number;   // per image
  audioInput?: number; audioOutput?: number;   // per minute
  videoInput?: number; videoOutput?: number;   // per minute
}
\`\`\`

\`undefined\` in \`ModelCapabilities\` means "unknown", not "unsupported".

## Rate limit tiers

Enforced per entity, resolved from the entity's RevenueCat entitlement.

| Entitlement | Display | Hourly | Daily | Monthly |
|---|---|---|---|---|
| \`none\` | Free | 10 | 120 | 1,800 |
| \`bandwidth_dev\` | Developer | 100 | 1,200 | 18,000 |
| \`bandwidth_pro\` | Pro | 800 | 10,000 | 150,000 |
| \`bandwidth_ultra\` | Ultra | unlimited | unlimited | unlimited |

Entities owned by a site admin are exempt, and rate limiting is skipped entirely
when the server has no RevenueCat key configured.

## Database tables (\`shapeshyft\` PostgreSQL schema)

\`users\`, \`user_settings\`, \`user_api_keys\`, \`entities\`, \`entity_members\`,
\`entity_invitations\`, \`entity_storage_configs\`, \`llm_api_keys\`, \`projects\`,
\`endpoints\`, \`usage_analytics\`, \`rate_limit_counters\`.`;

export const EXAMPLES_MD = `# ShapeShyft API — Worked Examples

## 0. Authenticating

Create a personal API key once, in the dashboard at
[shapeshyft.ai](https://shapeshyft.ai) → Dashboard → Settings → **Personal API
Keys** → name it → **Create key** → copy the \`shyft_...\` value (it is shown once,
though you can reveal it again from the same page).

Then use it as \`X-API-Key\` against \`https://api.shapeshyft.ai\`:

\`\`\`bash
curl https://api.shapeshyft.ai/api/v1/users/me \\
  -H "X-API-Key: shyft_..."
# {"success":true,"data":{"firebase_uid":"...","auth_method":"api_key",...}}

curl https://api.shapeshyft.ai/api/v1/entities \\
  -H "X-API-Key: shyft_..."
\`\`\`

From the MCP server, hand the key over once and let it persist:

\`\`\`
set_credentials({ apiKey: "shyft_...", persist: true })
  -> stored in ~/.shapeshyft/config.json (mode 0600); later sessions start authenticated

get_current_user()
  -> { firebase_uid: "...", email: "you@example.com", auth_method: "api_key" }
\`\`\`

Managing keys programmatically needs a Firebase ID token, not a key — the API
returns \`403\` when a key-authenticated caller tries to create or reveal one:

\`\`\`bash
curl -X POST https://api.shapeshyft.ai/api/v1/users/<uid>/api-keys \\
  -H "Authorization: Bearer <firebase-id-token>" \\
  -H "Content-Type: application/json" \\
  -d '{"key_name":"CI pipeline"}'
\`\`\`

Revoke with \`delete_api_key\`, or pause reversibly with
\`update_api_key({ is_active: false })\`. Either takes effect within 60 seconds
(the API's key-lookup cache window).

## 1. End-to-end setup with MCP tools

\`\`\`
list_entities()
  -> [{ entitySlug: "acme", entityType: "organization", userRole: "owner", ... }]

create_llm_key({
  entitySlug: "acme",
  key_name: "Prod Anthropic",
  provider: "anthropic",
  api_key: "sk-ant-..."
})
  -> { uuid: "8f1c...", has_api_key: true }

create_project({
  entitySlug: "acme",
  project_name: "support-tools",
  display_name: "Support Tools"
})
  -> { uuid: "b2d4...", api_key_prefix: "sk_live_9f2" }

create_endpoint({
  entitySlug: "acme",
  projectId: "b2d4...",
  endpoint_name: "classify-ticket",
  display_name: "Classify Support Ticket",
  llm_key_id: "8f1c...",
  model: "claude-sonnet-4-6-20260217",
  context: "You triage support tickets for a B2B SaaS company.",
  instructions: "Classify the ticket, judge sentiment, and summarize it in one sentence.",
  input_schema: {
    type: "object",
    properties: { text: { type: "string", description: "Raw ticket body" } },
    required: ["text"]
  },
  output_schema: {
    type: "object",
    properties: {
      category:  { type: "string", enum: ["billing", "bug", "feature", "other"] },
      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
      urgency:   { type: "integer", minimum: 1, maximum: 5 },
      summary:   { type: "string", description: "One sentence" }
    },
    required: ["category", "sentiment", "urgency", "summary"]
  }
})

get_project_api_key({ entitySlug: "acme", projectId: "b2d4..." })
  -> { api_key: "sk_live_..." }

preview_endpoint_prompt({
  orgPath: "acme", projectName: "support-tools", endpointName: "classify-ticket",
  input: { text: "You billed me twice this month and support never replied." }
})
  -> { prompt: "# Instructions\\n..." }        // no LLM call, no cost

invoke_endpoint({
  orgPath: "acme", projectName: "support-tools", endpointName: "classify-ticket",
  input: { text: "You billed me twice this month and support never replied." }
})
  -> {
       output: { category: "billing", sentiment: "negative", urgency: 4,
                 summary: "Customer was double-charged and got no support response." },
       usage: { tokens_input: 312, tokens_output: 48, latency_ms: 1180,
                estimated_cost_cents: 0.14 }
     }
\`\`\`

## 2. Calling the endpoint over HTTP

\`\`\`bash
# POST endpoint (default)
curl -X POST https://api.shapeshyft.ai/api/v1/ai/acme/support-tools/classify-ticket \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"text":"You billed me twice this month."}'

# Prompt preview - same auth, no LLM call
curl -X POST https://api.shapeshyft.ai/api/v1/ai/acme/support-tools/classify-ticket/prompt \\
  -H "Authorization: Bearer sk_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"text":"You billed me twice this month."}'

# GET endpoint (http_method: "GET") - input comes from query parameters.
# Keep the key in the header: on GET, query params are folded into the input.
curl -G https://api.shapeshyft.ai/api/v1/ai/acme/support-tools/classify-ticket \\
  -H "Authorization: Bearer sk_live_..." \\
  --data-urlencode "text=You billed me twice this month."
\`\`\`

TypeScript:

\`\`\`ts
const res = await fetch(
  "https://api.shapeshyft.ai/api/v1/ai/acme/support-tools/classify-ticket",
  {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.SHAPESHYFT_PROJECT_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: ticketBody }),
  }
);
const { success, data, error } = await res.json();
if (!success) throw new Error(error);
console.log(data.output.category, data.usage.estimated_cost_cents);
\`\`\`

Python:

\`\`\`python
import os, requests

r = requests.post(
    "https://api.shapeshyft.ai/api/v1/ai/acme/support-tools/classify-ticket",
    headers={"Authorization": f"Bearer {os.environ['SHAPESHYFT_PROJECT_API_KEY']}"},
    json={"text": ticket_body},
    timeout=60,
)
payload = r.json()
if not payload["success"]:
    raise RuntimeError(payload["error"])
print(payload["data"]["output"])
\`\`\`

## 3. Per-request context override

\`context\` in the payload replaces the endpoint's stored system context for that
call only, and is stripped before the model sees the input:

\`\`\`json
{
  "text": "The pump seal failed after 3 weeks.",
  "context": "You triage warranty claims for industrial equipment."
}
\`\`\`

\`web_search: false\` in the payload disables search for that call on an endpoint
that has it enabled. It cannot enable search on an endpoint that does not.

## 4. Schema patterns

Document extraction:

\`\`\`json
{
  "type": "object",
  "properties": {
    "invoice_number": { "type": "string" },
    "issued_on":      { "type": "string", "format": "date" },
    "total_cents":    { "type": "integer", "minimum": 0 },
    "line_items": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "description": { "type": "string" },
          "quantity":    { "type": "integer" },
          "unit_cents":  { "type": "integer" }
        },
        "required": ["description", "quantity", "unit_cents"]
      }
    }
  },
  "required": ["invoice_number", "total_cents", "line_items"]
}
\`\`\`

Guidelines that materially improve output quality:

- Prefer \`enum\` over free text for anything you will branch on.
- Put a \`description\` on every non-obvious field — it becomes prompt instructions.
- List every field you actually need in \`required\`; optional fields get skipped.
- Use \`integer\` cents rather than floats for money.
- Keep nesting shallow; two or three levels is where most models stay reliable.

## 5. Multimodal input

Media travels inside the normal input payload as a data URL or a \`gs://\` URL.
Plain \`http(s)\` URLs are rejected (SSRF prevention). Check
\`list_provider_models\` first — the model must report \`visionInput\`, \`audioInput\`,
or \`videoInput\`.

\`\`\`json
{
  "receipt": "data:image/png;base64,iVBORw0KGgoAAA...",
  "note": "Extract the merchant and total."
}
\`\`\`

\`\`\`json
{ "recording": "gs://my-bucket/calls/2026-08-17/call-123.mp3" }
\`\`\`

SVG, TIFF, HEIC, BMP, and AVIF images are converted to PNG server-side. The whole
request body is capped at 50 MB, which is the practical ceiling for base64 media.

## 6. Media output

\`\`\`
update_endpoint({
  entitySlug: "acme", projectId: "b2d4...", endpointId: "e91a...",
  expects_media_output: { image: true },
  output_media_format: "url"
})
\`\`\`

With \`"url"\`, generated media is uploaded to the entity's configured bucket and
returned as a signed URL valid for 7 days — configure it first with
\`set_storage_config\`. With \`"base64"\` the bytes come back inline in
\`generated_media[].data\`.

## 7. Transcription (Groq Whisper) endpoints

Whisper models run a two-stage pipeline: transcription, then an optional
structured-extraction pass over the transcript.

\`\`\`
create_endpoint({
  entitySlug: "acme", projectId: "b2d4...",
  endpoint_name: "call-notes", display_name: "Call Notes",
  llm_key_id: "<groq-key-uuid>",
  model: "whisper-large-v3",
  transcription_extraction_model: "llama-3.3-70b-versatile",
  instructions: "Summarize the sales call and list the action items.",
  output_schema: {
    type: "object",
    properties: {
      summary:      { type: "string" },
      action_items: { type: "array", items: { type: "string" } }
    },
    required: ["summary", "action_items"]
  }
})
\`\`\`

## 8. Locking an endpoint down

\`\`\`
update_endpoint({
  entitySlug: "acme", projectId: "b2d4...", endpointId: "e91a...",
  ip_allowlist: ["203.0.113.10", "203.0.113.11"]
})
\`\`\`

Requests from other addresses get \`403\`. The client IP is taken from
\`X-Forwarded-For\` (first entry) or \`X-Real-IP\`, so the allowlist is only as
trustworthy as your proxy layer. Pass \`null\` or \`[]\` to remove the restriction.
Rotate a leaked project key with \`refresh_project_api_key\` — the old key stops
working immediately.

## 9. Watching cost and quota

\`\`\`
get_analytics({ entitySlug: "acme", start_date: "2026-08-01", end_date: "2026-08-17" })
get_rate_limits({ entitySlug: "acme" })
get_rate_limit_history({ entitySlug: "acme", periodType: "day" })
\`\`\`

\`total_estimated_cost_cents\` is an estimate from the model's published pricing,
not a provider invoice.`;

export const ERRORS_MD = `# ShapeShyft API — Errors and Troubleshooting

## Error envelope

\`\`\`json
{ "success": false, "error": "Endpoint not found", "timestamp": "2026-08-17T10:00:00.000Z" }
\`\`\`

When an LLM call itself fails the API adds provider diagnostics:

\`\`\`json
{
  "success": false,
  "error": "LLM processing failed: 401 Incorrect API key provided",
  "details": { "...": "provider-specific" },
  "timestamp": "..."
}
\`\`\`

Failed invocations are still recorded in usage analytics with the error message,
so \`get_analytics\` shows the failure count even when nothing was billed.

## AI invocation status codes

| Status | Meaning | Fix |
|---|---|---|
| 400 | Invalid request body | POST endpoints require valid JSON |
| 401 | Missing/invalid/malformed project API key | Key must be \`sk_live_...\`; fetch with \`get_project_api_key\` |
| 403 | Caller IP not in the endpoint's allowlist | Update \`ip_allowlist\`, or check the proxy's \`X-Forwarded-For\` |
| 404 | Entity, project, or endpoint not found — **or inactive** | Verify slugs; check \`is_active\` on both project and endpoint |
| 405 | Wrong HTTP method | Match the endpoint's \`http_method\` |
| 413 | Body over 50 MB | Shrink the media payload or use \`gs://\` input |
| 429 | Rate limit exceeded | Check \`get_rate_limits\`; upgrade the entitlement or wait for the window |
| 500 | LLM processing failed / server error | Read \`details\`; often a bad or exhausted provider key |

A \`404\` on invocation is deliberately ambiguous: an inactive project, an inactive
endpoint, and a typo all look identical from outside.

## Admin route status codes

| Status | Meaning |
|---|---|
| 401 | No credential at all, malformed header, expired token, anonymous user, or an unknown/deactivated API key |
| 403 | Not a member of the entity, insufficient role, \`:userId\` does not match the caller, or an API-key caller tried to create/reveal an API key |
| 404 | Entity, project, endpoint, key, or storage config not found |
| 409 | Conflict — duplicate \`organization_path\`, or a name already used in the entity |
| 500 | Server error; check the API logs |

Permission mapping: reads need membership; creating or editing projects,
endpoints, keys, and storage needs \`manager\` or \`owner\`; member and invitation
management needs \`owner\`.

## Frequent causes

**"Invalid API key" on a URL that looks right.** Project API keys are scoped to
one project. A key from a different project in the same entity fails, and so does
a key rotated after the caller was deployed.

**"Project API key not configured" (500).** The project row has no encrypted key —
call \`refresh_project_api_key\` to generate one.

**Output does not match the schema.** Add \`description\` text to the ambiguous
fields, tighten types with \`enum\`, and confirm the field really is in \`required\`.
Use \`preview_endpoint_prompt\` to see exactly what the model was told; it costs
nothing.

**Media rejected.** Only data URLs and \`gs://\` URLs are accepted — \`http(s)\` URLs
are refused to prevent SSRF. Also confirm via \`list_provider_models\` that the
model reports the matching input capability.

**Rate limited earlier than expected.** Limits are per **entity**, not per user or
per project, and every endpoint in the entity shares the same counters.

**Token accepted after being revoked.** Verified Firebase tokens are cached for
about five minutes.

**Health check returns 503.** \`GET /health/ready\` failed its \`SELECT 1\`; the API
process is up but PostgreSQL is not reachable.

## MCP-side errors

| Message | Meaning |
|---|---|
| \`No ShapeShyft credential configured...\` | Create a personal API key at shapeshyft.ai, then \`set_credentials({ apiKey, persist: true })\` |
| \`This operation needs a Firebase ID token...\` | Creating or revealing API keys needs a token; do it at shapeshyft.ai, or pass one to \`set_credentials\` |
| \`This operation needs a project API key...\` | Set \`SHAPESHYFT_PROJECT_API_KEY\`, pass \`apiKey\`, or call \`set_credentials\` |
| \`entitySlug is required...\` | Pass \`entitySlug\` or set \`SHAPESHYFT_ENTITY_SLUG\` — \`list_entities\` shows the options |
| \`orgPath is required...\` | Pass \`orgPath\` or set \`SHAPESHYFT_ORG_PATH\` / \`SHAPESHYFT_ENTITY_SLUG\` |

Firebase ID tokens expire roughly an hour after they are minted. A personal API
key (\`shyft_...\`) does not, which is why it is the credential to use for an MCP
session — create one at shapeshyft.ai under Dashboard → Settings → Personal API
Keys. \`get_configuration\` shows what the server currently holds (redacted);
\`set_credentials\` replaces it without a restart, and with \`persist: true\` stores
it in \`~/.shapeshyft/config.json\` (mode 0600) for future sessions.

A \`401\` on a call that previously worked usually means one of: the Firebase
token expired, the key was deleted, or the key was deactivated
(\`update_api_key({ is_active: false })\`). A revoked key can also keep working for
up to 60 seconds, the API's key-lookup cache window.`;

export const PROVIDERS_MD = `# ShapeShyft API — Providers and Models

The live catalog is served by the API (\`list_providers\`, \`get_provider\`,
\`list_provider_models\`) so it stays current without a client upgrade. Treat the
tools as the source of truth and this page as orientation.

## Providers

| id | Name | Notes |
|---|---|---|
| \`openai\` | OpenAI | Function calling; audio I/O; web search on supported models |
| \`anthropic\` | Anthropic | \`tool_use\` structured output; image input as base64 or URL |
| \`gemini\` | Google Gemini | Native \`responseSchema\`; image-capable preview models |
| \`mistral\` | Mistral AI | OpenAI-compatible surface |
| \`cohere\` | Cohere | OpenAI-compatible surface |
| \`groq\` | Groq | Fast inference; Whisper transcription pipeline |
| \`xai\` | xAI (Grok) | OpenAI-compatible surface |
| \`deepseek\` | DeepSeek | OpenAI-compatible surface |
| \`perplexity\` | Perplexity | Search-grounded Sonar models |
| \`lm_studio\` | LM Studio / Custom | Any OpenAI-compatible server; requires \`endpoint_url\`, accepts arbitrary model names |

Internally, Mistral, Cohere, xAI, DeepSeek, and Perplexity are all driven through
the OpenAI-compatible provider implementation. Anthropic, Gemini, Groq, and
custom servers have dedicated implementations.

## Choosing a model

1. \`list_provider_models({ provider })\` — returns \`{ id, capabilities, pricing }\`
   per model.
2. Check \`capabilities\` against what the endpoint needs: \`visionInput\`,
   \`audioInput\`, \`videoInput\`, \`imageOutput\`, \`audioOutput\`, \`videoOutput\`,
   \`webSearch\`. \`undefined\` means *unknown*, not unsupported — you verify it.
3. Check \`mediaFormats\` for the accepted encodings of each media type.
4. Compare \`pricing\`: \`input\`/\`output\` are cents per 1M tokens, image prices are
   per image, audio and video prices are per minute.
5. Set \`model\` on the endpoint, or leave it null to take the provider's
   \`defaultModel\`.

Capability validation runs at invocation time: sending an image to a model
without \`visionInput\`, or enabling media output a model cannot produce, fails the
request rather than silently degrading.

## Multimodal pipeline

1. Input is scanned for media — data URLs and \`gs://\` URLs. \`http(s)\` is refused
   (SSRF prevention).
2. Media is lifted out of the payload and replaced with placeholders in the text.
3. SVG, TIFF, HEIC, BMP, and AVIF images are converted to PNG via Sharp. Audio and
   video are never transcoded.
4. Model capabilities are validated against the requested media types.
5. Provider-specific content blocks are built (base64 blocks, image URLs,
   Gemini \`inlineData\`, ...).
6. Generated media is returned inline as base64, or uploaded to the entity's
   GCS/S3 bucket and returned as a 7-day signed URL, per \`output_media_format\`.

## Web search

\`web_search\` on an endpoint only applies to providers and models whose
capabilities report \`webSearch\` (OpenAI's Responses API, Perplexity's Sonar
family). A caller can pass \`web_search: false\` to turn it off for one request but
can never turn it on.

## Transcription

Groq Whisper models (\`whisper-large-v3\`, \`whisper-large-v3-turbo\`) transcribe
first and then, if \`transcription_extraction_model\` is set, run a second pass to
extract data matching the output schema from the transcript. Audio format support
is narrower than for text models — check \`mediaFormats.audioFormats\`.

## Self-hosted models

Store an \`lm_studio\` key with \`endpoint_url\` pointing at any OpenAI-compatible
server (LM Studio, vLLM, Ollama's compatible API). Any model name is accepted
since the server owns that namespace. Structured output falls back to prompt
instructions with multi-format JSON extraction, which is less reliable than
native function calling — keep those schemas small and flat.`;
