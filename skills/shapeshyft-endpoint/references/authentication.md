# Authentication

ShapeShyft has three credentials. Using the wrong one is the most common cause of
a `401` or `403`, so it is worth knowing which is which.

| Credential | Prefix | Proves | Sent as | Expires |
|---|---|---|---|---|
| Personal API key | `shyft_` | *You* are the caller | `X-API-Key: shyft_...` | never (until revoked) |
| Firebase ID token | `eyJ` | *You* are the caller, freshly signed in | `Authorization: Bearer eyJ...` | ~1 hour |
| Project API key | `sk_live_` | The caller may invoke *this project's* endpoints | `Authorization: Bearer sk_live_...` | never (until rotated) |

The first two are interchangeable on the admin routes — a personal key is
resolved to its owner's Firebase UID, and every handler then behaves exactly as
it would for a token. The third is unrelated: it authorizes calls to published AI
endpoints and grants no access to configuration.

## Creating a personal API key

The dashboard is the intended path, and the only one that works without an
existing credential.

1. Go to **[https://shapeshyft.ai](https://shapeshyft.ai)** and sign in.
2. Open **Dashboard → Settings**.
3. Find **Personal API Keys** at the top of the page.
4. Enter a name describing where the key will run — `Claude Code on my laptop`,
   `CI pipeline`, `staging cron` — and click **Create key**.
5. Copy the `shyft_...` value.

Name keys by where they run, not what they do. When one leaks, the name is what
tells you which machine to clean up.

The key is shown once on creation, but unlike most services ShapeShyft stores an
encrypted copy, so **Reveal** on that same page will show it again. A key still
carries the full access of the account that owns it — treat it as a password.

### From the API instead

Creating a key requires a Firebase ID token. An API-key-authenticated request is
refused with `403`, by design: a leaked key cannot mint further credentials or
read its siblings.

```bash
curl -X POST https://api.shapeshyft.ai/api/v1/users/<uid>/api-keys \
  -H "Authorization: Bearer <firebase-id-token>" \
  -H "Content-Type: application/json" \
  -d '{"key_name":"CI pipeline"}'
```

## Using a key

```bash
curl https://api.shapeshyft.ai/api/v1/users/me -H "X-API-Key: shyft_..."
curl https://api.shapeshyft.ai/api/v1/entities -H "X-API-Key: shyft_..."
```

`GET /users/me` is the only way a key-authenticated client learns its own Firebase
UID, which the `/users/:userId/*` routes require. The MCP tools call it
automatically when `userId` is omitted.

Through the MCP server:

```
set_credentials({ apiKey: "shyft_...", persist: true })
get_current_user()
```

## Where the MCP server looks for credentials

Highest priority first:

1. An explicit tool argument — e.g. `apiKey` on `invoke_endpoint`
2. Environment variables — `SHAPESHYFT_API_KEY`, `SHAPESHYFT_AUTH_TOKEN`,
   `SHAPESHYFT_PROJECT_API_KEY`, `SHAPESHYFT_API_URL`, `SHAPESHYFT_ENTITY_SLUG`,
   `SHAPESHYFT_ORG_PATH`
3. The local config file

### The local config file

```
~/.shapeshyft/config.json          (override with SHAPESHYFT_CONFIG_PATH)
```

```json
{
  "apiUrl": "https://api.shapeshyft.ai",
  "apiKey": "shyft_...",
  "projectApiKey": "sk_live_...",
  "entitySlug": "acme",
  "orgPath": "acme"
}
```

Written with mode `0600` inside a `0700` directory. `set_credentials` with
`persist: true` creates and updates it; `clear_stored_credentials` removes the two
secrets while keeping the URL and defaults.

It lives outside any repository on purpose — a personal key belongs to the person,
not the project, and it must never end up in a commit or a shared settings file.
An unreadable or malformed file is ignored with a warning on stderr rather than
blocking startup.

Firebase ID tokens are deliberately **not** persisted: storing a value that dies
within the hour only produces confusing failures later.

## Managing keys

| Operation | Tool | Notes |
|---|---|---|
| List | `list_api_keys` | Metadata only; secrets never appear |
| Inspect | `get_api_key` | One key's metadata |
| Reveal | `reveal_api_key` | Firebase token required |
| Create | `create_api_key` | Firebase token required |
| Pause | `update_api_key({ is_active: false })` | Reversible; prefer this when unsure |
| Rename | `update_api_key({ key_name })` | |
| Revoke | `delete_api_key` | Permanent; confirm with the user first |

`last_used_at` tells you which keys are dead weight. It is written at most once
every five minutes, so a key used seconds ago may still read as older.

Revocation and deactivation take effect within 60 seconds — the API caches
key lookups for that long to keep authentication off the database on every
request. Deleting a key through this API clears its cache entry immediately;
the window matters only for changes made elsewhere.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `401 Invalid or inactive API key` | Key deleted, deactivated, or from a different deployment |
| `401 Authorization required` | No credential sent — check `get_configuration` |
| `401` after working fine | Firebase token expired (~1 h); switch to a personal key |
| `403 ... cannot create or reveal API keys` | Authenticated by API key; use the dashboard or a token |
| `403 You can only manage your own API keys` | The `:userId` in the path is not the caller — use `get_current_user` |
| Key works in curl, not in the MCP server | The key is in the shell environment but not in the config file or `set_credentials` |

## If a key leaks

1. `delete_api_key` — revoke it on the server. This is the step that matters.
2. `clear_stored_credentials` — remove it from `~/.shapeshyft/config.json`.
3. Create a replacement in the dashboard and `set_credentials({ apiKey, persist: true })`.
4. Check `list_api_keys` for anything you do not recognize, and check
   `get_analytics` for usage you cannot account for.

Revoking is what stops the key; clearing local storage alone does nothing.
