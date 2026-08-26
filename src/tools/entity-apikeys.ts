/**
 * @fileoverview Entity API key tools — key lifecycle for a workspace.
 *
 * An entity API key (`shyftent_...`) authenticates a caller as the *entity*
 * rather than as a person, so CI jobs, scripts, and MCP sessions keep working
 * when the member who created them leaves. Only a SHA-256 hash is stored, so
 * the plaintext appears exactly once, in the create response.
 *
 * Listing works with any credential. Creating, renaming, and revoking require a
 * *human* credential — a personal key or a Firebase token — because the API
 * refuses key lifecycle operations from an entity-key caller, so a leaked key
 * cannot mint more of itself. Those tools use auth mode "user".
 *
 * Do not confuse this with the *personal* key (`shyft_...`, see apikeys.ts),
 * the *project* key (`sk_live_...`, used to invoke endpoints), or the LLM
 * provider keys (see keys.ts).
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { compact, run } from "./util.ts";

const entitySlugArg = z
  .string()
  .optional()
  .describe("Entity slug that owns the key. Defaults to SHAPESHYFT_ENTITY_SLUG.");

const apiKeysPath = (entitySlug?: string) =>
  `/api/v1/entities/${client.seg(client.resolveEntitySlug(entitySlug))}/api-keys`;

export function registerEntityApiKeyTools(server: McpServer) {
  server.tool(
    "list_entity_api_keys",
    "List an entity's API keys (GET /api/v1/entities/:entitySlug/api-keys). Secrets are never " +
      "returned — each item has id, keyName, keyPrefix, isActive, lastUsedAt, createdByUserId. " +
      "Needs canViewApiKeys, which every active member has.",
    { entitySlug: entitySlugArg },
    async ({ entitySlug }) => run(() => client.get(apiKeysPath(entitySlug)))
  );

  server.tool(
    "create_entity_api_key",
    "Create an entity API key (POST /api/v1/entities/:entitySlug/api-keys). The response is the ONLY " +
      "place the plaintext key appears — it is stored hashed and can never be read back, so a lost " +
      "key is rotated rather than recovered. Requires a personal API key or Firebase token plus " +
      "canManageApiKeys (Manager or Owner); an entity key cannot mint another.\n\n" +
      'Example: create_entity_api_key({ key_name: "CI deploy" })',
    {
      entitySlug: entitySlugArg,
      key_name: z.string().describe("Label for the key, e.g. 'CI deploy'"),
    },
    async ({ entitySlug, key_name }) =>
      run(() =>
        client.post(apiKeysPath(entitySlug), {
          auth: "user",
          body: { key_name },
        })
      )
  );

  server.tool(
    "update_entity_api_key",
    "Rename an entity API key or toggle whether it is active " +
      "(PUT /api/v1/entities/:entitySlug/api-keys/:keyId). Deactivating stops it authenticating " +
      "immediately while keeping the record and its usage history. Requires a personal API key or " +
      "Firebase token.",
    {
      entitySlug: entitySlugArg,
      keyId: z.string().describe("Entity API key UUID"),
      key_name: z.string().optional().describe("New label"),
      is_active: z
        .boolean()
        .optional()
        .describe("Disable the key without deleting it"),
    },
    async ({ entitySlug, keyId, key_name, is_active }) =>
      run(() =>
        client.put(`${apiKeysPath(entitySlug)}/${client.seg(keyId)}`, {
          auth: "user",
          body: compact({ key_name, is_active }),
        })
      )
  );

  server.tool(
    "revoke_entity_api_key",
    "Permanently revoke an entity API key (DELETE /api/v1/entities/:entitySlug/api-keys/:keyId). " +
      "Any integration using it stops working at once and the key cannot be restored — prefer " +
      "update_entity_api_key with is_active:false if you may want it back. Requires a personal API " +
      "key or Firebase token.",
    {
      entitySlug: entitySlugArg,
      keyId: z.string().describe("Entity API key UUID"),
    },
    async ({ entitySlug, keyId }) =>
      run(() =>
        client.del(`${apiKeysPath(entitySlug)}/${client.seg(keyId)}`, {
          auth: "user",
        })
      )
  );
}
