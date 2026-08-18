/**
 * @fileoverview Personal API key tools.
 *
 * These are the `shyft_...` keys that authenticate their owner against the
 * admin routes — the credential this MCP server itself uses. Distinct from the
 * project API key (`sk_live_...`), which lets callers invoke a published AI
 * endpoint.
 *
 * Creating and revealing a key require a Firebase ID token: the API refuses
 * both when the caller authenticated with an API key, so a leaked key cannot
 * mint more credentials. Everything else works with either credential.
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { compact, run } from "./util.ts";

const userIdArg = z
  .string()
  .optional()
  .describe(
    "Firebase UID of the key owner. Defaults to the authenticated user (resolved via GET /users/me)."
  );

const keyIdArg = z.string().describe("API key UUID (from list_api_keys)");

/** Resolve the caller's own UID so tools can omit it. */
async function resolveUserId(userId?: string): Promise<string> {
  if (userId) return userId;
  const me = (await client.get("/api/v1/users/me")) as {
    firebase_uid?: string;
  };
  if (!me.firebase_uid) {
    throw new Error(
      "Could not determine the authenticated user. Pass userId explicitly."
    );
  }
  return me.firebase_uid;
}

const keysPath = (userId: string) =>
  `/api/v1/users/${client.seg(userId)}/api-keys`;

export function registerApiKeyTools(server: McpServer) {
  server.tool(
    "get_current_user",
    "Identify the authenticated caller (GET /api/v1/users/me): firebase_uid, email, siteAdmin, and " +
      "auth_method ('api_key' or 'firebase'). Works with either credential and is the only way to " +
      "learn your own Firebase UID, which the /users/:userId/* routes need. Use it to confirm which " +
      "account a key belongs to.",
    {},
    async () => run(() => client.get("/api/v1/users/me"))
  );

  server.tool(
    "list_api_keys",
    "List the user's personal API keys (GET /api/v1/users/:userId/api-keys). Returns metadata only — " +
      "uuid, key_name, key_prefix, is_active, last_used_at, created_at. Secrets never appear here; " +
      "use reveal_api_key for that. Newest first.",
    { userId: userIdArg },
    async ({ userId }) =>
      run(async () => client.get(keysPath(await resolveUserId(userId))))
  );

  server.tool(
    "get_api_key",
    "Get one personal API key's metadata (GET /api/v1/users/:userId/api-keys/:keyId). " +
      "The secret is not included.",
    { userId: userIdArg, keyId: keyIdArg },
    async ({ userId, keyId }) =>
      run(async () =>
        client.get(`${keysPath(await resolveUserId(userId))}/${client.seg(keyId)}`)
      )
  );

  server.tool(
    "create_api_key",
    "Create a personal API key (POST /api/v1/users/:userId/api-keys). The full `shyft_...` value is " +
      "returned once, in this response — surface it to the user immediately and offer to store it " +
      "with set_credentials({ apiKey, persist: true }).\n\n" +
      "REQUIRES A FIREBASE ID TOKEN. The API returns 403 when the caller authenticated with an API " +
      "key, so a leaked key cannot mint more. Without a token, direct the user to create the key at " +
      "https://shapeshyft.ai instead (Dashboard -> Settings -> Personal API Keys).",
    {
      userId: userIdArg,
      key_name: z
        .string()
        .describe("Label for the key, e.g. 'Claude Code on my laptop' (max 255 chars)"),
    },
    async ({ userId, key_name }) =>
      run(async () =>
        client.post(keysPath(await resolveUserId(userId)), {
          auth: "firebase_only",
          body: { key_name },
        })
      )
  );

  server.tool(
    "reveal_api_key",
    "Reveal an existing personal API key's full value " +
      "(GET /api/v1/users/:userId/api-keys/:keyId/reveal), so it can be copied again. " +
      "REQUIRES A FIREBASE ID TOKEN for the same reason as create_api_key. Treat the result as a " +
      "secret: do not write it into files, commits, or summaries.",
    { userId: userIdArg, keyId: keyIdArg },
    async ({ userId, keyId }) =>
      run(async () =>
        client.get(
          `${keysPath(await resolveUserId(userId))}/${client.seg(keyId)}/reveal`,
          { auth: "firebase_only" }
        )
      )
  );

  server.tool(
    "update_api_key",
    "Rename a personal API key or toggle whether it is accepted " +
      "(PUT /api/v1/users/:userId/api-keys/:keyId). `is_active: false` blocks the key without " +
      "deleting it, which is the reversible way to cut off a client you are unsure about. " +
      "Takes effect immediately.",
    {
      userId: userIdArg,
      keyId: keyIdArg,
      key_name: z.string().optional().describe("New label"),
      is_active: z.boolean().optional().describe("false blocks the key; true re-enables it"),
    },
    async ({ userId, keyId, key_name, is_active }) =>
      run(async () =>
        client.put(
          `${keysPath(await resolveUserId(userId))}/${client.seg(keyId)}`,
          { body: compact({ key_name, is_active }) }
        )
      )
  );

  server.tool(
    "delete_api_key",
    "Permanently revoke a personal API key (DELETE /api/v1/users/:userId/api-keys/:keyId). " +
      "Irreversible, and anything using the key stops working at once — confirm with the user first. " +
      "Prefer update_api_key({ is_active: false }) when the intent is to pause access.",
    { userId: userIdArg, keyId: keyIdArg },
    async ({ userId, keyId }) =>
      run(async () =>
        client.del(`${keysPath(await resolveUserId(userId))}/${client.seg(keyId)}`)
      )
  );
}
