/**
 * @fileoverview LLM provider / model catalog tools (public, no auth).
 *
 * The catalog is served by the API itself so clients always see the current
 * model list, capabilities, and pricing without a package upgrade.
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { run } from "./util.ts";

const providerIds = [
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
] as const;

const providerSchema = z
  .enum(providerIds)
  .describe("Provider id (lm_studio covers any OpenAI-compatible self-hosted server)");

export function registerProviderTools(server: McpServer) {
  server.tool(
    "list_providers",
    "List every LLM provider ShapeShyft supports (GET /api/v1/providers). Each entry has id, name, " +
      "description, defaultModel, allowsCustomModel, and requiresEndpointUrl. No authentication required.",
    {},
    async () => run(() => client.get("/api/v1/providers", { auth: "none" }))
  );

  server.tool(
    "get_provider",
    "Get the configuration for one provider (GET /api/v1/providers/:provider), including its default " +
      "model and whether it requires a custom endpoint URL. No authentication required.",
    { provider: providerSchema },
    async ({ provider }) =>
      run(() => client.get(`/api/v1/providers/${client.seg(provider)}`, { auth: "none" }))
  );

  server.tool(
    "list_provider_models",
    "List the models available for a provider with capabilities and pricing " +
      "(GET /api/v1/providers/:provider/models). Capabilities cover visionInput, audioInput, videoInput, " +
      "imageOutput, audioOutput, videoOutput, webSearch, and supported media input formats. Pricing is in " +
      "cents (text per 1M tokens, images per image, audio/video per minute). Call this before choosing a " +
      "`model` for an endpoint so multimodal and web-search requirements are actually supported. " +
      "No authentication required.",
    { provider: providerSchema },
    async ({ provider }) =>
      run(() =>
        client.get(`/api/v1/providers/${client.seg(provider)}/models`, { auth: "none" })
      )
  );
}
