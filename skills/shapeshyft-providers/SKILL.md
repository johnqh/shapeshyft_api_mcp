---
name: shapeshyft-providers
description: Use when managing ShapeShyft LLM providers, projects, or endpoints with an entity API key - creating or rotating provider keys, creating/updating/deleting endpoints, wiring an endpoint to a provider, or managing the workspace's own API keys. Trigger on /shapeshyft-providers, "add an OpenAI key to my workspace", "rotate the Anthropic key", "create an entity API key", "set up CI access to shapeshyft", "point this endpoint at a different model", "list my providers", or "why is my endpoint 401/403".
---

# ShapeShyft Providers & Entity Keys

Manage a workspace's LLM provider keys, projects, and endpoints through the
**shapeshyft-api** MCP server, authenticating with an **entity API key**
(`shyftent_...`).

For designing and debugging an individual endpoint's schema and prompt, use the
`shapeshyft-endpoint` skill instead — this one is about workspace credentials
and the objects that hold them.

## The credential

An entity API key authenticates as the *entity*, not as a person, so an agent
keeps working when the member who created it leaves. Create one in the dashboard
(Dashboard → API Keys) or with `create_entity_api_key` while authenticated as a
human, and it is shown exactly once — the server stores only a SHA-256 hash. A
lost key is rotated, never recovered.

Set it before starting: `SHAPESHYFT_ENTITY_API_KEY=shyftent_...`, plus
`SHAPESHYFT_ENTITY_SLUG` so tools can omit `entitySlug`. Or hand it over
mid-session with `set_credentials({ entityApiKey: "shyftent_...", persist: true })`.

Four credentials exist. Do not mix them up:

| Credential | Looks like | Authenticates as | Used for |
|---|---|---|---|
| Entity API key | `shyftent_...` | the entity | this skill — providers, projects, endpoints |
| Personal API key | `shyft_...` | a user | user routes, creating entity keys |
| Project API key | `sk_live_...` | a caller | invoking a published endpoint |
| Firebase token | JWT | a browser session | the dashboard; creating/revealing personal keys |

## What an entity key may do

Manager-level over its own entity: manage provider keys, projects, endpoints,
storage, and read analytics. It **cannot**:

- reach `/users/...` routes — that would let a key act as its author
- create, rename, or revoke entity API keys — a leaked key must not mint more
  of itself

Both come back as `403`. That is the design, not a misconfiguration: switch to a
personal key or Firebase token, or ask the user to act in the dashboard. Run
`get_configuration` to see which credentials are loaded — `adminToolsReady`
covers entity-scoped tools, `userToolsReady` covers the ones an entity key
cannot perform.

## Workflow: publish an endpoint

```
list_providers                 → pick a vendor (public, no credential)
create_llm_key                 → store that vendor's secret (encrypted at rest)
list_projects / create_project → the project owns the caller-facing sk_live_ key
create_endpoint                → instructions + output_schema + llm_key_id
invoke_endpoint                → test it with the project key
```

`llm_key_id` is a `uuid` from `list_llm_keys`. `output_schema` is the JSON Schema
the response must satisfy — the API drives the provider's native
structured-output mode with it. `endpoint_name` must be lowercase alphanumeric
with optional hyphens and becomes the last URL segment.

## Rules

- **Read before you write.** `list_llm_keys` and `list_endpoints` before
  creating anything — duplicate `endpoint_name`s inside a project are rejected,
  and a stale `llm_key_id` produces an endpoint that fails on first call.
- **Never echo a secret.** Provider keys are write-only; the API returns
  `has_api_key: boolean`. Do not print a `shyftent_`/`sk_live_` value into chat,
  a commit, or a log. When `create_entity_api_key` returns one, tell the user
  where to find it rather than repeating it.
- **Renames break callers.** Changing `endpoint_name` or `project_name` changes
  the public URL. Say so first, and prefer creating a new endpoint.
- **Deletes cascade.** `delete_project` removes every endpoint under it;
  `delete_llm_key` leaves endpoints pointing at nothing. Re-point them first
  with `update_endpoint`.
- **Prefer deactivation to revocation.** `update_entity_api_key` with
  `is_active: false` is reversible; `revoke_entity_api_key` is not.
- **Diagnose in order.** `check_api_health` (is the service up?), then
  `get_configuration` (is the right kind of credential present?), then the
  error: `401` means no/invalid credential, `403` means the credential is valid
  but not allowed here, `404` means wrong entity slug or id.

## Tools

| Group | Tools |
|---|---|
| Diagnostics | `check_api_health`, `get_api_info`, `get_configuration`, `set_credentials`, `clear_stored_credentials` |
| Providers | `list_providers`, `get_provider`, `list_provider_models` |
| Provider keys | `list_llm_keys`, `get_llm_key`, `create_llm_key`, `update_llm_key`, `delete_llm_key` |
| Projects | `list_projects`, `get_project`, `create_project`, `update_project`, `delete_project`, `get_project_api_key`, `refresh_project_api_key` |
| Endpoints | `list_endpoints`, `get_endpoint`, `create_endpoint`, `update_endpoint`, `delete_endpoint` |
| Invocation | `invoke_endpoint`, `preview_endpoint_prompt` |
| Entity keys | `list_entity_api_keys`, `create_entity_api_key`, `update_entity_api_key`, `revoke_entity_api_key` |
