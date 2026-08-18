/**
 * @fileoverview Endpoint tools — Firebase auth.
 *
 * An endpoint is one LLM interaction: which key/model to use, the JSON Schemas
 * for input and output, the instructions and system context, plus access
 * controls. ShapeShyft turns the output schema into the provider's native
 * structured-output mechanism (OpenAI/Groq function calling, Anthropic tool_use,
 * Gemini responseSchema, prompt-based JSON extraction for LM Studio).
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { compact, run } from "./util.ts";

const jsonSchemaArg = z
  .record(z.string(), z.unknown())
  .describe("JSON Schema object, e.g. { type: 'object', properties: {...}, required: [...] }");

const entitySlugArg = z
  .string()
  .optional()
  .describe("Entity slug that owns the project. Defaults to SHAPESHYFT_ENTITY_SLUG.");

const projectIdArg = z.string().describe("Project UUID (from list_projects)");
const endpointIdArg = z.string().describe("Endpoint UUID (from list_endpoints)");

const endpointsPath = (entitySlug: string | undefined, projectId: string) =>
  `/api/v1/entities/${client.seg(
    client.resolveEntitySlug(entitySlug)
  )}/projects/${client.seg(projectId)}/endpoints`;

const mediaOutputArg = z
  .object({
    audio: z.boolean().optional(),
    image: z.boolean().optional(),
    video: z.boolean().optional(),
  })
  .optional()
  .describe(
    "Declares which media types this endpoint generates. Only set it for models whose capabilities " +
      "report the matching output (check list_provider_models)."
  );

const outputMediaFormatArg = z
  .enum(["base64", "url"])
  .optional()
  .describe(
    "How generated media is returned: 'base64' inlines the bytes; 'url' uploads to the entity's " +
      "configured GCS/S3 bucket and returns a signed URL valid for 7 days (needs a storage config)."
  );

export function registerEndpointTools(server: McpServer) {
  server.tool(
    "list_endpoints",
    "List the endpoints in a project " +
      "(GET /api/v1/entities/:entitySlug/projects/:projectId/endpoints). Each item includes uuid, " +
      "endpoint_name, http_method, llm_key_id, model, input/output schemas, instructions, context, " +
      "is_active, ip_allowlist, and media settings.",
    { entitySlug: entitySlugArg, projectId: projectIdArg },
    async ({ entitySlug, projectId }) =>
      run(() => client.get(endpointsPath(entitySlug, projectId)))
  );

  server.tool(
    "get_endpoint",
    "Get one endpoint's full configuration " +
      "(GET /api/v1/entities/:entitySlug/projects/:projectId/endpoints/:endpointId).",
    { entitySlug: entitySlugArg, projectId: projectIdArg, endpointId: endpointIdArg },
    async ({ entitySlug, projectId, endpointId }) =>
      run(() =>
        client.get(`${endpointsPath(entitySlug, projectId)}/${client.seg(endpointId)}`)
      )
  );

  server.tool(
    "create_endpoint",
    "Create an AI endpoint (POST /api/v1/entities/:entitySlug/projects/:projectId/endpoints). " +
      "`endpoint_name` must be lowercase alphanumeric with optional hyphens and unique within the " +
      "project — it becomes the :endpointName segment of the public AI URL. `llm_key_id` is the UUID of " +
      "a stored provider key (list_llm_keys). Leave `model` null to use the provider default. " +
      "`output_schema` is what makes the response structured; `instructions` says what to do, `context` " +
      "is the system prompt. Requires manager or owner role.\n\n" +
      "Example:\n" +
      'create_endpoint({\n' +
      '  projectId: "<uuid>",\n' +
      '  endpoint_name: "classify-ticket",\n' +
      '  display_name: "Classify Support Ticket",\n' +
      '  llm_key_id: "<llm-key-uuid>",\n' +
      '  model: "claude-sonnet-4-6-20260217",\n' +
      '  instructions: "Classify the support ticket and extract the customer sentiment.",\n' +
      '  input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },\n' +
      '  output_schema: { type: "object", properties: {\n' +
      '    category: { type: "string", enum: ["billing", "bug", "feature", "other"] },\n' +
      '    sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },\n' +
      '    summary: { type: "string", description: "One sentence summary" }\n' +
      '  }, required: ["category", "sentiment", "summary"] }\n' +
      "})",
    {
      entitySlug: entitySlugArg,
      projectId: projectIdArg,
      endpoint_name: z.string().describe("URL slug, lowercase alphanumeric + hyphens"),
      display_name: z.string().describe("Human-readable name"),
      llm_key_id: z.string().describe("UUID of the LLM provider key to use (list_llm_keys)"),
      http_method: z
        .enum(["GET", "POST"])
        .optional()
        .describe("Method callers must use. Default POST. GET reads input from query params."),
      model: z
        .string()
        .optional()
        .describe("Model id, e.g. 'gpt-5.4-mini'. Omit to use the provider's default model."),
      input_schema: jsonSchemaArg
        .optional()
        .describe(
          "JSON Schema documenting the caller's input payload. Stored and shown to callers, but the " +
            "invocation path does not currently reject payloads that violate it."
        ),
      output_schema: jsonSchemaArg
        .optional()
        .describe("JSON Schema the LLM response must conform to — the core of structured output"),
      instructions: z
        .string()
        .optional()
        .describe("Task instructions for the LLM (max 10000 chars)"),
      context: z
        .string()
        .optional()
        .describe("System context/prompt sent with every request (max 10000 chars)"),
      web_search: z
        .boolean()
        .optional()
        .describe("Enable provider web search (only for models whose capabilities report webSearch)"),
      expects_media_output: mediaOutputArg,
      output_media_format: outputMediaFormatArg,
      transcription_extraction_model: z
        .string()
        .optional()
        .describe(
          "For Whisper/transcription models: the model used for the second pass that extracts " +
            "structured data from the transcript."
        ),
    },
    async ({ entitySlug, projectId, ...body }) =>
      run(() =>
        client.post(endpointsPath(entitySlug, projectId), { body: compact(body) })
      )
  );

  server.tool(
    "update_endpoint",
    "Update an endpoint (PUT /api/v1/entities/:entitySlug/projects/:projectId/endpoints/:endpointId). " +
      "Only the fields you pass are changed. `is_active: false` makes invocations return 404. " +
      "`ip_allowlist` restricts callers to the listed IPv4 addresses — pass an empty array or null to " +
      "allow all. Renaming `endpoint_name` changes the public URL.",
    {
      entitySlug: entitySlugArg,
      projectId: projectIdArg,
      endpointId: endpointIdArg,
      endpoint_name: z.string().optional(),
      display_name: z.string().optional(),
      http_method: z.enum(["GET", "POST"]).optional(),
      llm_key_id: z.string().optional(),
      model: z.string().optional(),
      input_schema: jsonSchemaArg.optional(),
      output_schema: jsonSchemaArg.optional(),
      instructions: z.string().optional(),
      context: z.string().optional(),
      is_active: z.boolean().optional(),
      ip_allowlist: z
        .array(z.string())
        .nullable()
        .optional()
        .describe("Allowed IPv4 addresses; null or empty means no restriction"),
      web_search: z.boolean().optional(),
      expects_media_output: mediaOutputArg,
      output_media_format: outputMediaFormatArg,
      transcription_extraction_model: z.string().optional(),
    },
    async ({ entitySlug, projectId, endpointId, ...body }) =>
      run(() =>
        client.put(`${endpointsPath(entitySlug, projectId)}/${client.seg(endpointId)}`, {
          body: compact(body),
        })
      )
  );

  server.tool(
    "delete_endpoint",
    "Delete an endpoint " +
      "(DELETE /api/v1/entities/:entitySlug/projects/:projectId/endpoints/:endpointId). Irreversible; " +
      "callers get 404 afterwards. To pause an endpoint instead, use update_endpoint with is_active: false.",
    { entitySlug: entitySlugArg, projectId: projectIdArg, endpointId: endpointIdArg },
    async ({ entitySlug, projectId, endpointId }) =>
      run(() =>
        client.del(`${endpointsPath(entitySlug, projectId)}/${client.seg(endpointId)}`)
      )
  );
}
