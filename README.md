# ShapeShyft API MCP Server

MCP (Model Context Protocol) server that **describes and drives the ShapeShyft API** —
the LLM structured-output platform where each configured endpoint becomes a REST URL
that returns schema-conformant JSON.

It gives an AI assistant four things:

- **61 tools** covering every ShapeShyft API route — entities, LLM provider keys,
  projects, endpoints, analytics, rate limits, storage, users, and AI invocation.
- **6 documentation resources** describing the API itself (overview, routes, data
  model, worked examples, errors, providers) — readable with no credentials and no
  network call.
- **3 prompt templates** for common workflows: set up an endpoint, debug one, audit
  an entity.
- **The `/shapeshyft-endpoint` skill** — a guided workflow for building, invoking,
  debugging, and auditing endpoints, shipped as a Claude Code plugin.

**Package**: `@sudobility/shapeshyft_api_mcp` (BUSL-1.1)

## Installation

```bash
bun install
```

## Configuration

### Getting a key

Create a personal API key once, at [shapeshyft.ai](https://shapeshyft.ai) →
Dashboard → Settings → **Personal API Keys** → name it → **Create key**. It starts
with `shyft_` and does not expire. Hand it to the server and let it remember:

```
set_credentials({ apiKey: "shyft_...", persist: true })
```

That writes `~/.shapeshyft/config.json` (mode 0600), so later sessions start
authenticated with nothing else to configure.

### Credential resolution

Highest priority first:

1. An explicit tool argument (e.g. `apiKey` on `invoke_endpoint`)
2. Environment variables
3. `~/.shapeshyft/config.json`

| Variable | Required | Description |
|---|---|---|
| `SHAPESHYFT_API_URL` | No | Base URL of the API. Default `https://api.shapeshyft.ai`; use `http://localhost:3000` for local dev |
| `SHAPESHYFT_API_KEY` | For admin tools | Personal API key (`shyft_...`) — preferred, never expires |
| `SHAPESHYFT_AUTH_TOKEN` | Only to create/reveal keys | Firebase ID token of the signed-in user |
| `SHAPESHYFT_PROJECT_API_KEY` | For AI tools | Project API key (`sk_live_...`) |
| `SHAPESHYFT_ENTITY_SLUG` | No | Default entity slug, so tools can omit `entitySlug` |
| `SHAPESHYFT_ORG_PATH` | No | Default organization path in AI URLs (defaults to the entity slug) |
| `SHAPESHYFT_CONFIG_PATH` | No | Override the config file location |

The server starts with no credentials at all — the documentation resources, the
provider catalog, and the health checks are public. Tools that need a credential
return a clear error saying how to get one.

**Two key types, different jobs.** `shyft_...` is a *personal* key that
authenticates you against the admin routes. `sk_live_...` is a *project* key that
lets callers invoke one project's AI endpoints. Creating and revealing personal
keys is the one thing a personal key cannot do — that needs a Firebase ID token,
so a leaked key cannot mint more.

### Option A: Install as a Claude Code plugin (recommended)

This makes the MCP tools, the documentation resources, **and** the
`/shapeshyft-endpoint` skill available in any project.

```bash
# Register this repo as a marketplace, then install the plugin from it
claude plugin marketplace add /path/to/shapeshyft_api_mcp
claude plugin install shapeshyft@shapeshyft
```

Verify with `claude plugin details shapeshyft@shapeshyft`, which lists the skill
and the MCP server.

The plugin is installed as a **copy** under
`~/.claude/plugins/cache/shapeshyft/`, so edits in this repo do not take effect
until you refresh both the marketplace and the plugin:

```bash
claude plugin marketplace update shapeshyft
claude plugin update shapeshyft@shapeshyft
```

The copy includes `node_modules`, so run `bun install` here before installing or
updating — the server runs straight from `src/index.ts`.

The plugin is defined by:

- `.claude-plugin/plugin.json` — plugin metadata
- `.claude-plugin/marketplace.json` — marketplace entry
- `.mcp.json` — MCP server declaration (reads `SHAPESHYFT_*` from your environment)
- `skills/shapeshyft-endpoint/` — the `/shapeshyft-endpoint` skill

### Option B: Add the MCP server manually

Add to `.claude/settings.json` (or `.mcp.json`):

```json
{
  "mcpServers": {
    "shapeshyft-api": {
      "command": "bun",
      "args": ["run", "/path/to/shapeshyft_api_mcp/src/index.ts"]
    }
  }
}
```

No credentials are needed in the config: run `set_credentials({ apiKey, persist: true })`
once and the key lives in `~/.shapeshyft/config.json` instead of a settings file
that might be committed. Environment variables still work, and take precedence.

## Tools

### Documentation and health

| Tool | Purpose |
|---|---|
| `describe_shapeshyft_api` | Read the bundled API docs (`overview`, `routes`, `data-model`, `examples`, `errors`, `providers`) |
| `get_configuration` | Show the effective API URL, defaults, and which credentials are present (redacted) |
| `set_credentials` | Set the API key, token, project key, URL, or defaults — with `persist` to save them |
| `clear_stored_credentials` | Remove saved secrets from the config file, keeping preferences |
| `check_api_health` | `GET /health`, or `/health/ready` for the database check |
| `get_api_info` | `GET /` — name, version, status |

### Identity and personal API keys

| Tool | Purpose |
|---|---|
| `get_current_user` | `GET /users/me` — who the current credential belongs to, and how it authenticated |
| `list_api_keys`, `get_api_key` | Key metadata (never the secret) |
| `create_api_key`, `reveal_api_key` | Mint or re-read a key — **Firebase token required** |
| `update_api_key` | Rename, or `is_active: false` to pause a key reversibly |
| `delete_api_key` | Permanent revocation |

### Providers (public)

`list_providers`, `get_provider`, `list_provider_models`

Model entries carry capabilities (vision/audio/video input, media output, web
search) and pricing in cents — check them before setting a `model` on an endpoint.

### AI invocation (project API key)

| Tool | Purpose |
|---|---|
| `invoke_endpoint` | Execute an endpoint → `{ output, usage, generated_media? }` |
| `preview_endpoint_prompt` | Build the prompt without calling the LLM — free, ideal for debugging |

### Entities, members, invitations (Firebase auth)

`list_entities`, `get_entity`, `create_entity`, `update_entity`, `delete_entity`,
`list_entity_members`, `update_member_role`, `remove_entity_member`,
`list_entity_invitations`, `invite_member`, `renew_invitation`, `cancel_invitation`,
`list_my_invitations`, `accept_invitation`, `decline_invitation`

### LLM provider keys

`list_llm_keys`, `get_llm_key`, `create_llm_key`, `update_llm_key`, `delete_llm_key`

### Projects

`list_projects`, `get_project`, `create_project`, `update_project`, `delete_project`,
`get_project_api_key`, `refresh_project_api_key`

### Endpoints

`list_endpoints`, `get_endpoint`, `create_endpoint`, `update_endpoint`, `delete_endpoint`

### Analytics, rate limits, storage, users

`get_analytics` · `get_rate_limits`, `get_rate_limit_history` ·
`get_storage_config`, `set_storage_config`, `update_storage_config`, `delete_storage_config` ·
`get_user_info`, `get_user_subscription`, `get_user_settings`, `update_user_settings`

## Resources

| URI | Contents |
|---|---|
| `shapeshyft://api/overview` | Architecture, object hierarchy, auth schemes, invocation lifecycle, limits |
| `shapeshyft://api/routes` | Every route with method, auth, parameters, and response |
| `shapeshyft://api/data-model` | Object shapes, rate limit tiers, database tables |
| `shapeshyft://api/examples` | End-to-end setup, curl/TypeScript/Python, schema patterns, multimodal |
| `shapeshyft://api/errors` | Error envelope, status codes, troubleshooting |
| `shapeshyft://api/providers` | Provider list, model selection, multimodal pipeline, transcription |

## Prompts

`setup_structured_endpoint` · `debug_endpoint` · `audit_entity`

## Example session

```
describe_shapeshyft_api({ section: "examples" })
list_entities()                                  -> entitySlug "acme"
create_llm_key({ key_name: "Prod Anthropic", provider: "anthropic", api_key: "sk-ant-..." })
create_project({ project_name: "support-tools", display_name: "Support Tools" })
create_endpoint({ projectId, endpoint_name: "classify-ticket", llm_key_id,
                  model: "claude-sonnet-4-6-20260217",
                  instructions: "Classify the ticket and judge sentiment.",
                  output_schema: { type: "object", properties: {
                    category:  { type: "string", enum: ["billing", "bug", "feature", "other"] },
                    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] }
                  }, required: ["category", "sentiment"] } })
get_project_api_key({ projectId })
invoke_endpoint({ projectName: "support-tools", endpointName: "classify-ticket",
                  input: { text: "You billed me twice this month." } })
  -> { output: { category: "billing", sentiment: "negative" },
       usage: { tokens_input: 312, tokens_output: 18, latency_ms: 940,
                estimated_cost_cents: 0.11 } }
```

## The `/shapeshyft-endpoint` skill

Installed with the plugin, the skill routes a request into one of four flows and
checks credentials before touching anything:

| Flow | Covers |
|---|---|
| **A — Build** | task → output schema → provider key → model → project → endpoint → verified invocation |
| **B — Invoke** | resolve names, run input through an endpoint, report output plus cost and latency |
| **C — Debug** | map `401`/`404`/`405`/`429` to a cause; fix schema-conformance and quality problems |
| **D — Audit** | inventory keys, projects, and endpoints; review spend, failures, and quota headroom |

Usage:

```
/shapeshyft-endpoint
```

Or just describe what you want:

> "Turn this classification prompt into an API"
> "My endpoint keeps returning the wrong category"
> "What are my ShapeShyft endpoints costing this month?"

Bundled references:

- `skills/shapeshyft-endpoint/references/creating-endpoints.md` — `create_endpoint` field reference and six worked recipes, each pairing an input payload with its schemas and response
- `skills/shapeshyft-endpoint/references/schema-design.md` — output schemas models actually satisfy
- `skills/shapeshyft-endpoint/references/model-selection.md` — picking a provider and model from capabilities and pricing

## Development

```bash
bun run dev        # Run the server over stdio
bun run build      # Bundle to dist/index.js
bun run typecheck  # TypeScript check
bun run verify     # typecheck + build
bun run start      # Run the production bundle
```

Validate the plugin and skill after editing them:

```bash
claude plugin validate .        # marketplace + plugin manifests
claude plugin validate skills   # skill frontmatter and structure
```

### Project structure

```
src/
├── index.ts            # Entry: env config, registration, stdio transport
├── client.ts           # HTTP client: auth-mode routing, envelope unwrapping
├── prompts.ts          # Prompt templates
├── resources/          # Embedded API documentation (resources + describe_shapeshyft_api)
└── tools/              # One module per route family

skills/
└── shapeshyft-endpoint/
    ├── SKILL.md                        # The /shapeshyft-endpoint skill
    └── references/
        ├── creating-endpoints.md       # create_endpoint recipes with payload examples
        ├── schema-design.md            # Output schema design guide
        └── model-selection.md          # Provider and model selection guide

.claude-plugin/         # plugin.json + marketplace.json
.mcp.json               # MCP server declaration used by the plugin
```

## Architecture

```
AI assistant (Claude Code / Claude Desktop)
    ↕ stdio (MCP protocol)
ShapeShyft API MCP server (this project)
    ↕ HTTP / REST
ShapeShyft API (Hono on Bun, PostgreSQL)
    ↕
10 LLM providers (OpenAI, Anthropic, Gemini, Groq, Mistral, xAI, DeepSeek,
                  Perplexity, Cohere, LM Studio)
```

The server is a thin HTTP client. Each tool maps to one REST route, and the right
`Authorization` header is chosen from the route family: a Firebase ID token for
admin routes, the project API key for `/api/v1/ai/*`, nothing for public routes.
Responses are unwrapped from the `{ success, data, timestamp }` envelope; failures
come back as MCP tool errors carrying the HTTP status and any provider `details`.

## Related Projects

- **shapeshyft_api** — the Hono backend this server wraps
- **shapeshyft_types** — shared TypeScript type definitions
- **shapeshyft_client** — API client hooks for web/native apps
- **shapeshyft_lib** — business logic stores
- **shapeshyft_app** — React web frontend

## License

BUSL-1.1
