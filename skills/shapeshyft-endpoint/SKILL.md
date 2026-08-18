---
name: shapeshyft-endpoint
description: Use when building, invoking, debugging, or auditing a ShapeShyft structured-output LLM endpoint. Trigger on /shapeshyft-endpoint, "create an AI endpoint", "turn this prompt into an API", "I need structured JSON from an LLM", "extract fields from these documents", "classify this with an LLM endpoint", "call my shapeshyft endpoint", "test my endpoint", "my endpoint returns the wrong shape", "why is my endpoint returning 401/404/429", "what are my endpoints costing", or "audit my shapeshyft setup".
---

# ShapeShyft Endpoint

Build and operate ShapeShyft endpoints. A ShapeShyft endpoint is one LLM
interaction published as a REST URL: you store a provider key, define
instructions plus an output JSON Schema, and callers POST plain data to a stable
URL and get schema-conformant JSON back with token, latency, and cost accounting.

## Architecture

```
caller  →  POST /api/v1/ai/:orgPath/:projectName/:endpointName   (project API key)
              ↓
        ShapeShyft API   builds the prompt from instructions + context + output schema,
                         calls the provider with its native structured-output mode,
                         records a usage row, returns { output, usage }
              ↓
        OpenAI · Anthropic · Gemini · Groq · Mistral · xAI · DeepSeek ·
        Perplexity · Cohere · any OpenAI-compatible server (lm_studio)
```

Object hierarchy: **entity** (tenant, addressed by `entitySlug`) → **LLM provider
keys** + **projects** (one caller-facing `sk_live_...` key each) → **endpoints**.

## MCP Server Used

**shapeshyft-api** — 61 tools over the ShapeShyft REST API.

| Group | Tools |
|---|---|
| Docs | `describe_shapeshyft_api` (sections: overview, routes, data-model, examples, errors, providers) |
| Config | `get_configuration`, `set_credentials`, `clear_stored_credentials` |
| Identity & keys | `get_current_user`, `list_api_keys`, `get_api_key`, `create_api_key`, `reveal_api_key`, `update_api_key`, `delete_api_key` |
| Health | `check_api_health`, `get_api_info` |
| Providers | `list_providers`, `get_provider`, `list_provider_models` |
| Invocation | `invoke_endpoint`, `preview_endpoint_prompt` |
| Entities | `list_entities`, `get_entity`, `create_entity`, `update_entity`, `delete_entity`, member and invitation tools |
| LLM keys | `list_llm_keys`, `get_llm_key`, `create_llm_key`, `update_llm_key`, `delete_llm_key` |
| Projects | `list_projects`, `get_project`, `create_project`, `update_project`, `delete_project`, `get_project_api_key`, `refresh_project_api_key` |
| Endpoints | `list_endpoints`, `get_endpoint`, `create_endpoint`, `update_endpoint`, `delete_endpoint` |
| Ops | `get_analytics`, `get_rate_limits`, `get_rate_limit_history`, storage and user tools |

If these tools are unavailable, the MCP server is not connected — tell the user to
install the plugin (`claude plugin add /path/to/shapeshyft_api_mcp`) or add the
server to their settings, and stop.

## Prerequisites: Check Before Doing Anything

Stop at the first missing item and prompt the user. Do not guess credentials, and
never invent an entity slug, project name, or key.

### 1. Confirm which deployment you are pointed at

Call `get_configuration`. It reports the API URL, which credentials are present
(redacted), and what the local config file `~/.shapeshyft/config.json` holds.

The deployed app is **shapeshyft.ai** and its API is **api.shapeshyft.ai** — that
is the default. If the URL is not what the user expects (local dev is usually
`http://localhost:3000`), fix it with `set_credentials({ apiUrl, persist: true })`.

Then call `check_api_health({ readiness: true })`. A `503` means the API is up but
its database is unreachable — report that and stop.

### 2. A personal API key (Flows A, C, D — and most of B)

Everything that reads or changes configuration needs a credential. The one to use
is a **personal API key** (`shyft_...`): unlike a Firebase ID token, it does not
expire, so it survives across sessions.

`get_configuration` reports `adminToolsReady` and whether
`~/.shapeshyft/config.json` already holds a key. **If it does, you are done — do
not ask the user for anything.**

If `adminToolsReady` is false, or a tool answers "No ShapeShyft credential
configured", stop and prompt with the full instructions:

> "I need a ShapeShyft API key to work with your account. Here's how to create one:
>
> 1. Go to **[https://shapeshyft.ai](https://shapeshyft.ai)** and sign in
> 2. Open **Dashboard → Settings** (the *Settings* item in the dashboard sidebar)
> 3. Find the **Personal API Keys** section at the top of the page
> 4. Type a name that says where it will be used — for example
>    `Claude Code on my laptop` — and click **Create key**
> 5. Copy the key it shows you. It starts with `shyft_`
>
> Then paste it here and I'll save it for future sessions:
> `My shapeshyft key is shyft_...`
>
> (You can reveal the key again later from that same page, and revoke it there
> any time. If you're on a self-hosted deployment, use its URL instead of
> shapeshyft.ai and tell me the API URL too.)"

When the user provides a key, store it:

```
set_credentials({ apiKey: "shyft_...", persist: true })
```

`persist: true` writes it to `~/.shapeshyft/config.json` with mode 0600, so later
sessions start authenticated. Confirm that you saved it and where. Then call
`get_current_user` to verify the key works and report which account it belongs to.

Never invent a key, and never echo a key back into a file, a commit, or a summary.

**When a Firebase ID token is needed instead.** Creating and revealing API keys
are the only operations an API key cannot perform — the API returns `403`, by
design, so a leaked key cannot mint more credentials. If the user asks you to
create a key programmatically, either point them at the dashboard flow above or
ask for a Firebase ID token and pass it as
`set_credentials({ authToken })` (do not persist it — it expires within the hour).

**When a credential stops working.** A `401` on a call that worked earlier means
the key was deleted or deactivated, or a Firebase token expired. Check
`get_configuration` and `list_api_keys` before asking the user for anything.

### 3. Project API key for invocation (Flow B, and verification in Flow A)

Invoking an endpoint needs a project API key (`sk_live_...`). With a Firebase
token you can fetch it yourself via `get_project_api_key`. Without one, ask the
user to paste the key and store it with `set_credentials({ projectApiKey })`.

### 4. Entity slug

Call `list_entities` and use the returned `entitySlug`. If there are several and
the user has not said which, ask. Set it once with
`set_credentials({ entitySlug })` so later calls can omit it.

## Determine What the User Wants

| User says | Flow |
|---|---|
| "create an endpoint", "turn this prompt into an API", "extract structured data from X" | **Flow A: Build an endpoint** |
| "call it", "test my endpoint", "run this input through it" | **Flow B: Invoke** |
| "it returns 401/404/429", "the output is wrong", "it ignores my instructions" | **Flow C: Debug** |
| "what am I spending", "audit my setup", "am I near my limits" | **Flow D: Audit** |

If unclear, ask which of the four they want rather than assuming.

---

## Flow A: Build an Endpoint

### Step 1: Pin down the payloads

Before touching the API, write down the two payloads and confirm them with the
user. Everything else follows from these.

1. **Input** — the exact JSON the caller will send. Field names matter: they are
   rendered into the prompt as `- field_name: value` lines, so name them the way
   you would label them for a person.
2. **Output** — the exact fields wanted back, their types, which are required, and
   which should be constrained to a fixed set of values.
3. **Volume and latency** — a handful of calls a day or thousands an hour; this
   drives model choice and the rate limit tier.

Show the user a concrete pair before creating anything:

> Callers will send:
> ```json
> { "text": "You billed me twice this month and support never replied." }
> ```
> and get back:
> ```json
> { "category": "billing", "sentiment": "negative", "urgency": 4,
>   "summary": "Customer was double-charged and received no support response." }
> ```
> Is that the shape you want?

Read `references/schema-design.md` before drafting the output schema — schema
quality is what decides whether the endpoint works. Two payload keys are reserved
and must not be used as input fields: `context` and `web_search`.

### Step 2: Provider key

`list_llm_keys` — reuse an active key for the provider you want. If none fits,
create one:

```
create_llm_key({ key_name: "Prod Anthropic", provider: "anthropic", api_key: "sk-ant-..." })
```

Never invent a provider key. If the user has not supplied one, ask. For a
self-hosted server use `provider: "lm_studio"` with `endpoint_url` instead of
`api_key`.

### Step 3: Model

`list_provider_models({ provider })`, then pick a model whose `capabilities` cover
what the task needs — `visionInput` for images, `audioInput` for audio,
`webSearch` for search-grounded answers — and whose `pricing` fits the volume.
`references/model-selection.md` has the decision rules. Leave `model` unset to
take the provider default.

Do not skip this step when the task involves media: sending an image to a model
without `visionInput` fails at invocation time.

### Step 4: Project

`list_projects` — reuse, or create one. The project name becomes part of the
public URL and must be lowercase alphanumeric with interior hyphens:

```
create_project({ project_name: "support-tools", display_name: "Support Tools" })
```

### Step 5: Create the endpoint

Read `references/creating-endpoints.md` for the full field reference and six
worked recipes (text classification, multi-field input, image extraction, GET
endpoints, audio transcription, generated media). The canonical shape:

```
create_endpoint({
  projectId: "b2d4...",                    // from Step 4
  endpoint_name: "classify-ticket",        // URL slug: lowercase, hyphens
  display_name: "Classify Support Ticket",
  llm_key_id: "8f1c...",                   // from Step 2
  model: "claude-sonnet-4-6-20260217",     // from Step 3; omit for the provider default
  context: "You triage support tickets for a B2B SaaS company.",
  instructions: "Classify the ticket, judge sentiment, rate urgency, and summarize it in one sentence.",

  // Documents the payload from Step 1
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "Raw ticket body as the customer wrote it" }
    },
    required: ["text"]
  },

  // Shapes the answer — this is what makes the endpoint structured
  output_schema: {
    type: "object",
    properties: {
      category:  { type: "string", enum: ["billing", "bug", "feature", "other"] },
      sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
      urgency:   { type: "integer", minimum: 1, maximum: 5,
                   description: "1 = can wait weeks, 3 = normal, 5 = production down" },
      summary:   { type: "string", description: "One sentence, under 30 words" }
    },
    required: ["category", "sentiment", "urgency", "summary"]
  }
})
```

Field roles, in the order they matter:

- `output_schema` — the contract. Enums for anything the caller branches on,
  `description` on anything ambiguous, everything needed listed in `required`.
  Omit it and the API falls back to an unconstrained object: still JSON, but the
  field names drift from call to call.
- `instructions` — the task to perform. Do not restate the output format here; the
  schema already carries it.
- `context` — standing background true for every call.
- `input_schema` — the payload contract you publish to callers. The API stores and
  returns it but does **not** reject payloads that violate it, so treat it as
  documentation rather than a guard.
- `http_method` — leave as POST unless the caller genuinely can only issue a GET.
  A mismatch at call time is a `405`.

For media in or out, set the extra fields covered in
`references/creating-endpoints.md`: media rides inside the normal payload as a
data URL or `gs://` URL, and generated media needs `expects_media_output` plus
`output_media_format`.

### Step 6: Verify before declaring success

1. `preview_endpoint_prompt` with realistic input — free, no LLM call. Read what
   the model will actually be told. If the schema requirements look vague there,
   fix the schema now.
2. `get_project_api_key` (or ask the user for it), then `invoke_endpoint` with the
   same input.
3. Check the response against the schema field by field. If a required field is
   missing or a value is wrong, go to Flow C rather than shipping it.

### Step 7: Report

> **Endpoint live: {display_name}**
>
> `POST {apiUrl}/api/v1/ai/{orgPath}/{projectName}/{endpointName}`
> Auth: `Authorization: Bearer sk_live_...`
>
> Sample response:
> ```json
> {sample output}
> ```
>
> Cost: ~{estimated_cost_cents} cents per call · latency {latency_ms}ms · model {model}
>
> Want me to lock it to specific IPs, or wire up a client snippet?

Show the full `sk_live_...` key only if the user asked for it.

---

## Flow B: Invoke an Endpoint

1. `list_projects` then `list_endpoints` to resolve names, unless the user gave
   both. Note each endpoint's `http_method` — a mismatch is a `405`.
2. Ensure a project API key is available (prerequisite 3).
3. `invoke_endpoint({ orgPath, projectName, endpointName, input })`.
4. Report `output`, then `usage.estimated_cost_cents` and `usage.latency_ms`.

Two input fields are interpreted rather than passed to the model:

- `context` — a string that replaces the endpoint's stored system context for that
  call only. Use it to try a different framing without editing the endpoint.
- `web_search: false` — turns search off for that call. It cannot turn search on.

For a dry run that spends nothing, use `preview_endpoint_prompt` instead.

---

## Flow C: Debug

Read `describe_shapeshyft_api({ section: "errors" })` and match the symptom.

### Configuration errors

| Symptom | Check |
|---|---|
| `401 Invalid API key` | Keys are scoped to one project. Confirm with `get_project_api_key`; a rotation invalidates old callers |
| `401 API key required` | The key must be in `Authorization: Bearer`, and must start with `sk_live_` |
| `404 Endpoint not found` | Could be a typo **or** `is_active: false`. Check `get_endpoint` and `get_project` |
| `405` | `http_method` on the endpoint does not match the verb used |
| `403` | The caller's IP is not in `ip_allowlist`; the IP comes from `X-Forwarded-For` / `X-Real-IP` |
| `429` | `get_rate_limits` — limits are per entity and shared by every endpoint under it |
| `500 LLM processing failed` | Read `details`. Usually an invalid, disabled, or exhausted provider key — verify with `list_llm_keys` |

### Output quality problems

1. `get_endpoint` — read the current `output_schema`, `instructions`, and `context`.
2. `preview_endpoint_prompt` with an input that fails. This is the single most
   useful step: it shows exactly what the model was told, at no cost.
3. Fix the most likely cause, in this order:
   - a field the model gets wrong has no `description` → add one
   - a field with open-ended values → constrain it with `enum`
   - a field that is sometimes missing → add it to `required`
   - instructions describe the output format → move that into the schema instead
   - the model is small or old → try a stronger one from `list_provider_models`
4. Apply with `update_endpoint`, then re-run `invoke_endpoint` on the same input
   and confirm the fix. Change one thing at a time.

Note that `input_schema` is documentation: the API stores it but does not
currently reject payloads that violate it. Do not diagnose a bad payload as
"schema validation failed".

---

## Flow D: Audit

1. `list_entities`, then for the chosen entity: `list_llm_keys`, `list_projects`,
   and `list_endpoints` per project.
2. `get_analytics({ start_date, end_date })` — total requests, failures, tokens,
   and `total_estimated_cost_cents`, plus the same broken down by endpoint.
3. `get_rate_limits` for the current tier, limits, and usage;
   `get_rate_limit_history({ periodType: "day" })` for the trend.
4. Flag, with the evidence:
   - endpoints with no `output_schema` — they lose the structured-output guarantee
   - endpoints pointing at an inactive or deleted LLM key
   - endpoints with `output_media_format: "url"` while `get_storage_config` 404s
   - a high `failed_requests` share on any endpoint
   - spend concentrated in one endpoint, especially on an expensive model
   - usage approaching the tier limit
   - members with more privilege than they need, and stale pending invitations
5. Report a prioritized list of concrete fixes, each as the tool call that applies it.

Costs are estimates derived from published model pricing, not provider invoices —
say so when reporting them.

---

## Safety Rules

- **Never invent credentials.** No provider keys, no Firebase tokens, no
  `sk_live_` values. Ask.
- **Confirm before destructive calls.** `delete_endpoint`, `delete_project`,
  `delete_entity`, `delete_llm_key`, and `delete_storage_config` are irreversible.
  To pause an endpoint, prefer `update_endpoint({ is_active: false })`.
- **`refresh_project_api_key` breaks every existing caller immediately.** Only
  rotate on request, or on a suspected leak, and say so plainly first.
- **Do not echo secrets** into summaries or files. Show `sk_live_...` only when
  the user asked for the key itself.
- **Read before writing.** `get_endpoint` before `update_endpoint` — updates are
  partial, and overwriting a schema you have not read loses work.

## Error Handling

| Error | Response |
|---|---|
| `No ShapeShyft credential configured` | Walk the user through creating a key at shapeshyft.ai (prerequisite 2), then `set_credentials({ apiKey, persist: true })` |
| `This operation needs a Firebase ID token` | Only create/reveal of API keys need one — point at the dashboard, or take a token via `set_credentials({ authToken })` |
| `This operation needs a project API key` | Fetch with `get_project_api_key`, or ask the user, then `set_credentials` |
| `entitySlug is required` | `list_entities` and pick, or ask which one |
| `401` on a call that worked earlier | The key was deleted or deactivated, or a Firebase token expired. Check `get_configuration` and `list_api_keys` first |
| `403` on create/reveal of an API key | Expected when authenticated by API key — use the dashboard or a Firebase token |
| `Unable to connect` | Wrong `apiUrl`, or the local API is not running. Check `get_configuration` and `check_api_health` |
| `503` from readiness | API is up, database is not. Stop and report |
| `409 Organization path already taken` | Another user holds that path; pick a different one |
| Tools missing entirely | The MCP server is not connected — install the plugin or add it to settings |

## References

- `references/authentication.md` — the three credential types, how to create a key on shapeshyft.ai, and the local config file
- `references/creating-endpoints.md` — full `create_endpoint` field reference and six worked recipes, each pairing an input payload with its schemas and response
- `references/schema-design.md` — designing output schemas models actually satisfy
- `references/model-selection.md` — picking a provider and model from capabilities and pricing
- `describe_shapeshyft_api({ section })` — the full API documentation bundled with the MCP server
