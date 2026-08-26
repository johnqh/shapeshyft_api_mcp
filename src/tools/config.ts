/**
 * @fileoverview Runtime configuration tools.
 *
 * Credentials come from three places, highest priority first: an explicit tool
 * argument, an environment variable, then `~/.shapeshyft/config.json`. These
 * tools inspect what the server currently holds and let the user hand over new
 * values mid-session — optionally persisting them to the config file so later
 * sessions start authenticated.
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import {
  clearStoredCredentials,
  configFilePath,
  readConfigFile,
  writeConfigFile,
} from "../config-file.ts";
import { ok, run } from "./util.ts";

/** Snapshot of the effective configuration, with secrets redacted. */
function describeConfig() {
  const cfg = client.getConfig();
  const stored = readConfigFile();

  return {
    apiUrl: cfg.apiUrl,
    entitySlug: cfg.entitySlug ?? null,
    orgPath: cfg.orgPath ?? null,
    entityApiKey: client.redact(cfg.entityApiKey),
    apiKey: client.redact(cfg.apiKey),
    authToken: client.redact(cfg.authToken),
    projectApiKey: client.redact(cfg.projectApiKey),
    /** Admin tools (entities, projects, endpoints, analytics, ...) */
    adminToolsReady: Boolean(cfg.entityApiKey ?? cfg.apiKey ?? cfg.authToken),
    /** User-scoped routes and API key lifecycle — entity keys are refused here */
    userToolsReady: Boolean(cfg.apiKey ?? cfg.authToken),
    /** Creating and revealing personal API keys — Firebase token only */
    canManageApiKeys: Boolean(cfg.authToken),
    /** AI invocation */
    aiToolsReady: Boolean(cfg.projectApiKey),
    configFile: {
      path: configFilePath(),
      hasEntityApiKey: Boolean(stored.entityApiKey),
      hasApiKey: Boolean(stored.apiKey),
      hasProjectApiKey: Boolean(stored.projectApiKey),
    },
  };
}

export function registerConfigTools(server: McpServer) {
  server.tool(
    "get_configuration",
    "Show the MCP server's effective configuration: API URL, default entity slug and organization " +
      "path, which credentials are present (redacted), and what the local config file " +
      "(~/.shapeshyft/config.json) holds. `adminToolsReady` covers most tools; `canManageApiKeys` is " +
      "true only with a Firebase token, since creating and revealing API keys requires one. " +
      "Call this first whenever a tool reports a missing credential.",
    {},
    async () => ok(describeConfig())
  );

  server.tool(
    "set_credentials",
    "Set credentials or defaults for this session. Use it when the user pastes a personal API key " +
      "(shyft_...), a Firebase ID token, or a project API key (sk_live_...), or wants to point at a " +
      "different deployment. Only the fields you pass are changed.\n\n" +
      "Pass `persist: true` to also write them to ~/.shapeshyft/config.json (mode 0600) so future " +
      "sessions start authenticated — do this for an API key the user just created, after confirming " +
      "they want it stored. Without `persist`, values live in memory only and are gone when the " +
      "server exits. Firebase ID tokens expire in about an hour and are never worth persisting.",
    {
      entityApiKey: z
        .string()
        .optional()
        .describe(
          "Entity API key (shyftent_...) — acts as the entity itself; cannot reach /users routes " +
            "or manage API keys"
        ),
      apiKey: z
        .string()
        .optional()
        .describe("Personal API key (shyft_...) — acts as a user; does not expire"),
      authToken: z
        .string()
        .optional()
        .describe("Firebase ID token; only needed to create or reveal API keys"),
      projectApiKey: z
        .string()
        .optional()
        .describe("Project API key (sk_live_...) for invoking AI endpoints"),
      apiUrl: z
        .string()
        .optional()
        .describe("Base URL, e.g. https://api.shapeshyft.ai or http://localhost:3000"),
      entitySlug: z.string().optional().describe("Default entity slug for tools that take one"),
      orgPath: z.string().optional().describe("Default organization path for AI URLs"),
      persist: z
        .boolean()
        .optional()
        .describe(
          "Write the values to ~/.shapeshyft/config.json for future sessions. The Firebase token is " +
            "never persisted — it expires within the hour."
        ),
    },
    async ({ persist, ...patch }) =>
      run(async () => {
        client.updateConfig(patch);
        // Persist the trimmed values, not the raw paste.
        const cfg = client.getConfig();

        let savedTo: string | null = null;
        if (persist) {
          // Deliberately excludes authToken: persisting a value that expires in
          // an hour only produces confusing failures later.
          savedTo = writeConfigFile({
            apiUrl: patch.apiUrl === undefined ? undefined : cfg.apiUrl,
            entityApiKey:
              patch.entityApiKey === undefined ? undefined : cfg.entityApiKey,
            apiKey: patch.apiKey === undefined ? undefined : cfg.apiKey,
            projectApiKey:
              patch.projectApiKey === undefined ? undefined : cfg.projectApiKey,
            entitySlug:
              patch.entitySlug === undefined ? undefined : cfg.entitySlug,
            orgPath: patch.orgPath === undefined ? undefined : cfg.orgPath,
          });
        }

        return {
          updated: Object.entries(patch)
            .filter(([, value]) => value !== undefined)
            .map(([key]) => key),
          persistedTo: savedTo,
          ...describeConfig(),
        };
      })
  );

  server.tool(
    "clear_stored_credentials",
    "Remove the saved API key and project key from ~/.shapeshyft/config.json, keeping non-secret " +
      "preferences like the API URL and default entity slug. Use it when a key is compromised or the " +
      "user is handing the machine over. This does not revoke the key on the server — follow up with " +
      "delete_api_key to do that.",
    {},
    async () =>
      run(async () => ({
        clearedFrom: clearStoredCredentials(),
        note: "The key still works until it is revoked with delete_api_key or deactivated with update_api_key.",
      }))
  );
}
