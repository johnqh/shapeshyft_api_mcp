/**
 * @fileoverview AI invocation tools (public routes, project API key auth).
 *
 * URL shape: /api/v1/ai/:organizationPath/:projectName/:endpointName[/prompt]
 *   - organizationPath: the entity slug that owns the project
 *   - projectName / endpointName: the lowercase slug names, not UUIDs
 *
 * The endpoint's configured `http_method` must match the request method, or the
 * API answers 405.
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { run } from "./util.ts";

const inputSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    "Input payload for the endpoint. POST sends it as the JSON body; GET flattens it into query " +
      "parameters (values are stringified). Two field names are reserved: `context` overrides the " +
      "endpoint's configured system context for this call, and `web_search: false` disables web search " +
      "on an endpoint that has it enabled. Media can be passed as data URLs " +
      "(data:image/png;base64,...) or gs:// URLs."
  );

const common = {
  orgPath: z
    .string()
    .optional()
    .describe(
      "Organization path — the entity slug that owns the project. Defaults to SHAPESHYFT_ORG_PATH or SHAPESHYFT_ENTITY_SLUG."
    ),
  projectName: z.string().describe("Project slug, e.g. 'support-tools' (not the UUID)"),
  endpointName: z.string().describe("Endpoint slug, e.g. 'classify-ticket' (not the UUID)"),
  method: z
    .enum(["GET", "POST"])
    .optional()
    .describe("HTTP method; must match the endpoint's configured http_method. Default POST."),
  apiKey: z
    .string()
    .optional()
    .describe("Project API key (sk_live_...) for this call; defaults to SHAPESHYFT_PROJECT_API_KEY"),
  testMode: z
    .boolean()
    .optional()
    .describe("Set true to evaluate rate limits against RevenueCat sandbox purchases"),
};

/** GET requests carry input as query parameters, so values must be strings. */
function toQuery(
  input: Record<string, unknown> | undefined,
  testMode: boolean | undefined
): Record<string, string | boolean | undefined> {
  const query: Record<string, string | boolean | undefined> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    query[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  if (testMode) query["testMode"] = true;
  return query;
}

function aiPath(orgPath: string, projectName: string, endpointName: string, suffix = "") {
  return `/api/v1/ai/${client.seg(orgPath)}/${client.seg(projectName)}/${client.seg(
    endpointName
  )}${suffix}`;
}

export function registerAiTools(server: McpServer) {
  server.tool(
    "invoke_endpoint",
    "Execute a ShapeShyft AI endpoint and get structured JSON back " +
      "(GET|POST /api/v1/ai/:orgPath/:projectName/:endpointName). Authenticates with the project API key. " +
      "Returns { output, usage: { tokens_input, tokens_output, latency_ms, estimated_cost_cents }, " +
      "generated_media? }, where `output` conforms to the endpoint's output schema. " +
      "Common failures: 401 invalid/missing key, 403 caller IP not in the endpoint allowlist, " +
      "404 unknown or inactive project/endpoint, 405 wrong HTTP method, 429 rate limited.\n\n" +
      'Example: invoke_endpoint({ projectName: "support-tools", endpointName: "classify-ticket", ' +
      'input: { text: "My invoice was charged twice." } })',
    { ...common, input: inputSchema },
    async ({ orgPath, projectName, endpointName, input, method, apiKey, testMode }) =>
      run(() => {
        const path = aiPath(client.resolveOrgPath(orgPath), projectName, endpointName);
        const useGet = (method ?? "POST") === "GET";
        return useGet
          ? client.get(path, {
              auth: "project",
              apiKeyOverride: apiKey,
              query: toQuery(input, testMode),
            })
          : client.post(path, {
              auth: "project",
              apiKeyOverride: apiKey,
              body: input ?? {},
              query: testMode ? { testMode: true } : undefined,
            });
      })
  );

  server.tool(
    "preview_endpoint_prompt",
    "Return the prompt ShapeShyft would build for an endpoint WITHOUT calling the LLM " +
      "(GET|POST /api/v1/ai/:orgPath/:projectName/:endpointName/prompt). No tokens are spent and no " +
      "usage is recorded. Use it to debug instructions, context, and the schema-derived output " +
      "requirements before spending money on a real invocation. Returns { prompt }.",
    { ...common, input: inputSchema },
    async ({ orgPath, projectName, endpointName, input, method, apiKey, testMode }) =>
      run(() => {
        const path = aiPath(
          client.resolveOrgPath(orgPath),
          projectName,
          endpointName,
          "/prompt"
        );
        const useGet = (method ?? "POST") === "GET";
        return useGet
          ? client.get(path, {
              auth: "project",
              apiKeyOverride: apiKey,
              query: toQuery(input, testMode),
            })
          : client.post(path, {
              auth: "project",
              apiKeyOverride: apiKey,
              body: input ?? {},
            });
      })
  );
}
