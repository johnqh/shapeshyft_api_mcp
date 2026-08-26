# ShapeShyft API MCP

> **Git policy — never auto-commit or auto-push.** Leave your work in the working tree.
> Run `git commit`, `git push`, `gh pr create`, or `scripts/push_all.sh` **only when the user
> explicitly asks in that turn**. Approval for an earlier change does not carry forward, and
> finishing a task is not permission to commit it.

MCP (Model Context Protocol) server that describes and drives the ShapeShyft API —
an LLM structured-output platform — for AI assistants like Claude Code and Claude
Desktop.

**Package**: `@sudobility/shapeshyft_api_mcp` (BUSL-1.1)

## Tech Stack

- **Runtime**: Bun
- **Package Manager**: Bun (do not use npm/yarn/pnpm)
- **MCP SDK**: `@modelcontextprotocol/sdk` ^1.29
- **Validation**: Zod 4 (imported as `zod/v4`)
- **Transport**: stdio

## Architecture

```
AI assistant (Claude Code / Claude Desktop)
    ↕ stdio (MCP protocol)
ShapeShyft API MCP server (this project)
    ↕ HTTP / REST
ShapeShyft API (Hono on Bun, port 3000 locally)
```

Thin HTTP client: one tool per REST route, plus embedded documentation exposed as
MCP resources. No database, no shared code with the API — accuracy comes from
keeping the tool descriptions and docs in sync with `../shapeshyft_api/src/routes/`.

## Commands

```bash
bun run dev        # Run the MCP server (stdio)
bun run build      # Bundle to dist/index.js
bun run typecheck  # TypeScript check
bun run verify     # typecheck + build
bun run start      # Run the production bundle
```

## Project Structure

```
src/
├── index.ts            # Entry: credential resolution, registration, stdio transport
├── client.ts           # HTTP client: auth-mode routing, envelope unwrapping, ApiError
├── config-file.ts      # ~/.shapeshyft/config.json read/write (mode 0600)
├── prompts.ts          # Prompt templates (setup / debug / audit)
├── resources/
│   ├── index.ts        # Resource registration + DOC_SECTIONS map
│   └── content.ts      # Embedded markdown docs (generated-style, hand-editable)
└── tools/
    ├── util.ts         # ok() / fail() / run() / compact() helpers
    ├── docs.ts         # describe_shapeshyft_api
    ├── config.ts       # get_configuration, set_credentials, clear_stored_credentials
    ├── apikeys.ts      # get_current_user + personal API key CRUD (7 tools)
    ├── health.ts       # check_api_health, get_api_info
    ├── providers.ts    # list_providers, get_provider, list_provider_models
    ├── ai.ts           # invoke_endpoint, preview_endpoint_prompt
    ├── entities.ts     # entities, members, invitations (15 tools)
    ├── keys.ts         # LLM provider keys (5 tools)
    ├── projects.ts     # projects + project API key (7 tools)
    ├── endpoints.ts    # endpoint CRUD (5 tools)
    ├── analytics.ts    # get_analytics
    ├── ratelimits.ts   # get_rate_limits, get_rate_limit_history
    ├── storage.ts      # entity GCS/S3 config (4 tools)
    └── users.ts        # user info, subscription, settings (4 tools)

skills/
└── shapeshyft-endpoint/
    ├── SKILL.md        # /shapeshyft-endpoint — build, invoke, debug, audit flows
    └── references/
        ├── creating-endpoints.md # create_endpoint recipes: payload + schemas + response
        ├── schema-design.md      # Output schema design guide
        └── model-selection.md    # Provider/model selection guide

.claude-plugin/         # plugin.json + marketplace.json (Claude Code plugin)
.mcp.json               # MCP server declaration used by the plugin
```

The project ships as a Claude Code plugin. Install it with
`claude plugin marketplace add <repo path>` followed by
`claude plugin install shapeshyft@shapeshyft` — that brings the MCP server, the
documentation resources, and the skill together. Claude Code copies the
directory (including `node_modules`) into `~/.claude/plugins/cache/shapeshyft/`,
so after changing anything here run `claude plugin marketplace update shapeshyft`
and `claude plugin update shapeshyft@shapeshyft` before the change is live.

**Keep `.claude-plugin/plugin.json` `version` in step with `package.json`.**
`claude plugin update` compares manifest versions and silently does nothing when
they match, so an unbumped plugin manifest leaves everyone on a stale copy.
`push_all.sh` bumps `package.json` only — bump the plugin manifest in the same
commit.
`.mcp.json` resolves the server path with `${CLAUDE_PLUGIN_ROOT}` and reads
`SHAPESHYFT_*` from the user's environment, so no secrets live in the repo.

## Environment Variables

Resolution order: explicit tool argument → environment variable → config file.

| Variable | Required | Description |
|---|---|---|
| `SHAPESHYFT_API_URL` | No | Base URL; default `https://api.shapeshyft.ai` |
| `SHAPESHYFT_API_KEY` | For admin tools | Personal API key (`shyft_...`), never expires |
| `SHAPESHYFT_AUTH_TOKEN` | Only create/reveal keys | Firebase ID token |
| `SHAPESHYFT_PROJECT_API_KEY` | For AI tools | Project API key (`sk_live_...`) |
| `SHAPESHYFT_ENTITY_SLUG` | No | Default entity slug |
| `SHAPESHYFT_ORG_PATH` | No | Default organization path for AI URLs |
| `SHAPESHYFT_CONFIG_PATH` | No | Override the config file path (used by tests) |

The server runs with none of them; only the tools that need a credential fail, and
they explain how to get one. `set_credentials` overrides any of them for the
session, and with `persist: true` writes `~/.shapeshyft/config.json` (mode 0600).
Firebase tokens are deliberately never persisted — they expire within the hour.

## Auth Model (mirrors the API)

- `/api/v1/ai/*` → project API key as `Authorization: Bearer sk_live_...`
- `/api/v1/providers/*`, `/health*`, `/` → no auth
- everything else → personal API key as `X-API-Key: shyft_...`, or a Firebase ID
  token as `Authorization: Bearer <token>`

`client.ts` picks the scheme via the `auth` request option:

| Mode | Behavior |
|---|---|
| `"admin"` (default) | Personal API key if present, else the Firebase token |
| `"firebase_only"` | Firebase token required — create/reveal of API keys, which the API refuses from key-authenticated callers |
| `"project"` | Project API key, for AI invocation |
| `"none"` | Public route |

Never send a personal key to an AI route or a project key to an admin route — the
API routes credentials by prefix, and a mismatch reads as "invalid key".

## Surface

61 tools, 6 resources (`shapeshyft://api/{overview,routes,data-model,examples,errors,providers}`),
3 prompts (`setup_structured_endpoint`, `debug_endpoint`, `audit_entity`), and one
skill (`/shapeshyft-endpoint`).

## Code Patterns

### Tool registration

```ts
import { z } from "zod/v4";
import * as client from "../client.ts";
import { run, compact } from "./util.ts";

server.tool(
  "list_projects",
  "List the projects in an entity (GET /api/v1/entities/:entitySlug/projects). ...",
  { entitySlug: z.string().optional().describe("Defaults to SHAPESHYFT_ENTITY_SLUG.") },
  async ({ entitySlug }) =>
    run(() =>
      client.get(`/api/v1/entities/${client.seg(client.resolveEntitySlug(entitySlug))}/projects`)
    )
);
```

Conventions:

- Descriptions name the HTTP method and path, the response shape, and the failure
  modes. They are the only API documentation the model sees at call time.
- `run()` converts thrown errors into `isError` tool results — handlers never throw.
- `compact()` strips `undefined` so PUT bodies only carry provided fields.
- `client.seg()` encodes every interpolated path segment.
- `resolveEntitySlug()` / `resolveOrgPath()` apply the env defaults and raise a
  helpful error when nothing is available.

### Documentation resources

`src/resources/content.ts` holds the markdown as template literals (backticks and
`${` escaped) so `bun build` produces a self-contained bundle. Edit the strings
directly; `describe_shapeshyft_api` and the MCP resources read the same map.

## Task Recipes

### Adding a tool for a new API route

1. Confirm the real route in `../shapeshyft_api/src/routes/` — path, auth, Zod
   schema, and response type. Do not trust older docs.
2. Add the tool to the matching `src/tools/*.ts` (or a new file registered in
   `src/index.ts`).
3. Write the description with the method, path, response shape, and error cases.
4. Update `src/resources/content.ts` (`ROUTES_MD`, and `DATA_MODEL_MD` if new types).
5. Update the tool tables in `README.md`.
6. `bun run verify`, then smoke test over stdio.

### Editing the skill

1. The skill lives in `skills/shapeshyft-endpoint/`. `SKILL.md` holds the routing
   table and the four flows; deep guidance belongs in `references/` so the skill
   body stays scannable.
2. Keep tool names in `SKILL.md` in sync with what the server actually registers —
   a skill that calls a nonexistent tool fails silently at the worst moment.
3. Do not duplicate the API documentation there; point at
   `describe_shapeshyft_api({ section })` instead, so there is one copy to update.
4. Validate: `claude plugin validate .` and `claude plugin validate skills`.

### Smoke testing

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | bun run src/index.ts
```

The public tools (`check_api_health`, `list_providers`) can be exercised against
production without credentials.

## Workspace Context

Part of the **ShapeShyft** workspace (`~/projects/shapeshyft.code-workspace`)
alongside `shapeshyft_api`, `shapeshyft_app`, `shapeshyft_client`,
`shapeshyft_lib`, and `shapeshyft_types`.

## Downstream Impact

Leaf project — nothing depends on it. It has **no** `@sudobility/*` dependencies,
so upstream library upgrades never break it. Backend route changes do: the tools
are hand-mirrored, not generated.

## Gotchas

- **stdout is the MCP transport.** Never `console.log`; diagnostics go to stderr.
- **Import Zod as `zod/v4`.** The SDK's `ZodRawShapeCompat` expects the v4 surface.
- **Local imports use the `.ts` extension** (`./client.ts`), matching
  `allowImportingTsExtensions` in `tsconfig.json`.
- **On GET AI endpoints every query parameter becomes input**, including `api_key`
  and `testMode`. The client always authenticates via the header for that reason.
- **`:memberId` is the member's Firebase UID**, not the membership row id.
- **`organizationPath` in AI URLs is the entity slug**, resolved by slug lookup —
  it is not the `organization_path` from user settings, despite the name.
- **Project API key ≠ LLM provider key.** `sk_live_...` authenticates callers of
  your endpoints; provider keys are ShapeShyft's credentials for OpenAI et al. and
  are never returned by the API.
- **A `404` from an invocation can mean "inactive"**, not just "missing" — check
  `is_active` on both project and endpoint.
- **Rate limits are per entity**, shared by every project and endpoint under it.
- **Three credentials, two prefixes to remember**: `shyft_` personal (admin routes,
  `X-API-Key`), `sk_live_` project (AI routes, `Authorization: Bearer`), and a
  Firebase ID token (admin routes, `Authorization: Bearer`).
- **`create_api_key` and `reveal_api_key` need a Firebase token.** The API returns
  403 for key-authenticated callers by design. The dashboard at shapeshyft.ai is
  the normal path for both.
- **Secrets never go to stdout as prose.** `get_configuration` and
  `set_credentials` redact; only `create_api_key`, `reveal_api_key`, and
  `get_project_api_key` return a secret, and only because that is their purpose.
- **The config file is user-scoped, not project-scoped** — `~/.shapeshyft/config.json`,
  never inside a repo, so a key cannot be committed by accident.
- **Three places describe this server**: tool descriptions (what the model reads at
  call time), `src/resources/content.ts` (the API documentation), and
  `skills/shapeshyft-endpoint/` (the workflow). Adding a route means touching all
  three plus `README.md`.

## Git Workflow

- Do not use feature branches for code changes. Always stay on the current branch.
