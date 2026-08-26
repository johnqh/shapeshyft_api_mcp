#!/usr/bin/env bun
/**
 * ShapeShyft API MCP Server
 *
 * Describes and drives the ShapeShyft API — an LLM structured-output platform
 * where each configured endpoint is a REST URL that returns schema-conformant
 * JSON.
 *
 * Exposes:
 *   - tools     for every ShapeShyft API route (entities, keys, projects,
 *               endpoints, analytics, rate limits, storage, users, AI invocation)
 *   - resources documenting the API (overview, routes, data model, examples,
 *               errors, providers)
 *   - prompts   for common workflows (set up an endpoint, debug one, audit an entity)
 *
 * Credentials resolve in this order, highest first:
 *   1. An explicit tool argument (e.g. `apiKey` on invoke_endpoint)
 *   2. Environment variables (below)
 *   3. The local config file, `~/.shapeshyft/config.json`
 *
 * Environment variables:
 *   SHAPESHYFT_API_URL           Base URL (default https://api.shapeshyft.ai)
 *   SHAPESHYFT_ENTITY_API_KEY    Entity API key (shyftent_...) — acts as the entity itself
 *   SHAPESHYFT_API_KEY           Personal API key (shyft_...) — acts as a user
 *   SHAPESHYFT_AUTH_TOKEN        Firebase ID token — needed only to create or reveal API keys
 *   SHAPESHYFT_PROJECT_API_KEY   Project API key (sk_live_...) — required for AI invocation
 *   SHAPESHYFT_ENTITY_SLUG       Default entity slug for tools that take one
 *   SHAPESHYFT_ORG_PATH          Default organization path for AI URLs (defaults to the entity slug)
 *   SHAPESHYFT_CONFIG_PATH       Override the config file location
 *
 * `set_credentials` updates any of these for the session, and can persist them
 * to the config file so later sessions start authenticated.
 *
 * With no credentials the server still runs: the documentation resources, the
 * provider catalog, and the health checks are all public.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// Single source of truth for the version reported in the MCP handshake — a
// hardcoded literal drifts the moment the package is bumped.
import pkg from "../package.json" with { type: "json" };
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configure } from "./client.ts";
import { readConfigFile } from "./config-file.ts";
import { registerResources } from "./resources/index.ts";
import { registerPrompts } from "./prompts.ts";
import { registerDocsTools } from "./tools/docs.ts";
import { registerConfigTools } from "./tools/config.ts";
import { registerHealthTools } from "./tools/health.ts";
import { registerProviderTools } from "./tools/providers.ts";
import { registerAiTools } from "./tools/ai.ts";
import { registerEntityTools } from "./tools/entities.ts";
import { registerKeyTools } from "./tools/keys.ts";
import { registerProjectTools } from "./tools/projects.ts";
import { registerEndpointTools } from "./tools/endpoints.ts";
import { registerAnalyticsTools } from "./tools/analytics.ts";
import { registerRateLimitTools } from "./tools/ratelimits.ts";
import { registerStorageTools } from "./tools/storage.ts";
import { registerUserTools } from "./tools/users.ts";
import { registerApiKeyTools } from "./tools/apikeys.ts";
import { registerEntityApiKeyTools } from "./tools/entity-apikeys.ts";

const DEFAULT_API_URL = "https://api.shapeshyft.ai";

// Env wins over the stored config, so a client-supplied value can override the
// file without the user having to edit it.
const stored = readConfigFile();

/** Treat an empty environment variable as unset — plugin configs often set "". */
const env = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
};

const apiUrl = env("SHAPESHYFT_API_URL") ?? stored.apiUrl ?? DEFAULT_API_URL;
const entityApiKey =
  env("SHAPESHYFT_ENTITY_API_KEY") ?? stored.entityApiKey;
const apiKey = env("SHAPESHYFT_API_KEY") ?? stored.apiKey;
const authToken = env("SHAPESHYFT_AUTH_TOKEN");
const projectApiKey =
  env("SHAPESHYFT_PROJECT_API_KEY") ?? stored.projectApiKey;
const entitySlug = env("SHAPESHYFT_ENTITY_SLUG") ?? stored.entitySlug;
const orgPath = env("SHAPESHYFT_ORG_PATH") ?? stored.orgPath;

configure({
  apiUrl,
  entityApiKey,
  apiKey,
  authToken,
  projectApiKey,
  entitySlug,
  orgPath,
});

// stderr only — stdout carries the MCP protocol.
if (!entityApiKey && !apiKey && !authToken && !projectApiKey) {
  console.error(
    "[shapeshyft-api] No credentials configured. Documentation, provider catalog, and health " +
      "tools work without one. For everything else, create a personal API key at " +
      "https://shapeshyft.ai (Dashboard -> Settings -> Personal API Keys) and hand it over with " +
      "the set_credentials tool — it can persist to ~/.shapeshyft/config.json for future sessions."
  );
}

const server = new McpServer({
  name: "shapeshyft-api",
  version: pkg.version,
});

// Documentation and workflow helpers
registerResources(server);
registerPrompts(server);
registerDocsTools(server);
registerConfigTools(server);

// Public routes
registerHealthTools(server);
registerProviderTools(server);

// AI invocation (project API key)
registerAiTools(server);

// Admin routes (Firebase ID token)
registerEntityTools(server);
registerKeyTools(server);
registerProjectTools(server);
registerEndpointTools(server);
registerAnalyticsTools(server);
registerRateLimitTools(server);
registerStorageTools(server);
registerUserTools(server);
registerApiKeyTools(server);
registerEntityApiKeyTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
