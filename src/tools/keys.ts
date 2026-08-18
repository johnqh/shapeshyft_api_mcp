/**
 * @fileoverview LLM provider key tools — Firebase auth.
 *
 * These are the keys ShapeShyft uses to call OpenAI/Anthropic/etc. on your
 * behalf. They are AES-256-CBC encrypted at rest and are NEVER returned by the
 * API — responses expose `has_api_key: boolean` instead. Endpoints reference a
 * key by its `uuid` via `llm_key_id`.
 *
 * Do not confuse these with the *project* API key (sk_live_...) that callers use
 * to invoke endpoints; see the projects tools for that one.
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { compact, run } from "./util.ts";

const entitySlugArg = z
  .string()
  .optional()
  .describe("Entity slug that owns the key. Defaults to SHAPESHYFT_ENTITY_SLUG.");

const keysPath = (entitySlug?: string) =>
  `/api/v1/entities/${client.seg(client.resolveEntitySlug(entitySlug))}/keys`;

export function registerKeyTools(server: McpServer) {
  server.tool(
    "list_llm_keys",
    "List the LLM provider keys configured for an entity (GET /api/v1/entities/:entitySlug/keys). " +
      "Secrets are never returned — each item has uuid, key_name, provider, has_api_key, endpoint_url, " +
      "is_active. Use the `uuid` as `llm_key_id` when creating an endpoint.",
    { entitySlug: entitySlugArg },
    async ({ entitySlug }) => run(() => client.get(keysPath(entitySlug)))
  );

  server.tool(
    "get_llm_key",
    "Get one LLM provider key by UUID (GET /api/v1/entities/:entitySlug/keys/:keyId). " +
      "The secret itself is never returned.",
    { entitySlug: entitySlugArg, keyId: z.string().describe("LLM key UUID") },
    async ({ entitySlug, keyId }) =>
      run(() => client.get(`${keysPath(entitySlug)}/${client.seg(keyId)}`))
  );

  server.tool(
    "create_llm_key",
    "Store a provider API key for an entity (POST /api/v1/entities/:entitySlug/keys). The value is " +
      "encrypted at rest and can never be read back. For every provider except `lm_studio`, `api_key` is " +
      "required; for `lm_studio` (any OpenAI-compatible self-hosted server) `endpoint_url` is required " +
      "instead. Requires manager or owner role.\n\n" +
      'Example: create_llm_key({ key_name: "Prod OpenAI", provider: "openai", api_key: "sk-..." })',
    {
      entitySlug: entitySlugArg,
      key_name: z.string().describe("Label for the key, e.g. 'Prod OpenAI'"),
      provider: z
        .enum([
          "openai",
          "anthropic",
          "gemini",
          "mistral",
          "cohere",
          "groq",
          "xai",
          "deepseek",
          "perplexity",
          "lm_studio",
        ])
        .describe("Provider this key authenticates against"),
      api_key: z.string().optional().describe("Provider secret; required unless provider is lm_studio"),
      endpoint_url: z
        .string()
        .optional()
        .describe("Base URL of the OpenAI-compatible server; required for lm_studio"),
    },
    async ({ entitySlug, key_name, provider, api_key, endpoint_url }) =>
      run(() =>
        client.post(keysPath(entitySlug), {
          body: compact({ key_name, provider, api_key, endpoint_url }),
        })
      )
  );

  server.tool(
    "update_llm_key",
    "Update an LLM provider key (PUT /api/v1/entities/:entitySlug/keys/:keyId). Rotate the secret by " +
      "passing a new `api_key`, rename it, change the endpoint URL, or toggle `is_active`. " +
      "The provider itself cannot be changed — create a new key instead.",
    {
      entitySlug: entitySlugArg,
      keyId: z.string().describe("LLM key UUID"),
      key_name: z.string().optional(),
      api_key: z.string().optional().describe("New secret value (rotation)"),
      endpoint_url: z.string().optional(),
      is_active: z.boolean().optional().describe("Disable the key without deleting it"),
    },
    async ({ entitySlug, keyId, key_name, api_key, endpoint_url, is_active }) =>
      run(() =>
        client.put(`${keysPath(entitySlug)}/${client.seg(keyId)}`, {
          body: compact({ key_name, api_key, endpoint_url, is_active }),
        })
      )
  );

  server.tool(
    "delete_llm_key",
    "Delete an LLM provider key (DELETE /api/v1/entities/:entitySlug/keys/:keyId). " +
      "Endpoints still referencing it will start failing, so re-point them first.",
    { entitySlug: entitySlugArg, keyId: z.string().describe("LLM key UUID") },
    async ({ entitySlug, keyId }) =>
      run(() => client.del(`${keysPath(entitySlug)}/${client.seg(keyId)}`))
  );
}
