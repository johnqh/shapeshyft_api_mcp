/**
 * @fileoverview Reusable prompt templates for common ShapeShyft workflows.
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function userMessage(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerPrompts(server: McpServer) {
  server.prompt(
    "setup_structured_endpoint",
    "Walk through creating a working ShapeShyft endpoint for a described task, from provider key to verified invocation.",
    {
      task: z
        .string()
        .describe("What the endpoint should do, e.g. 'classify support tickets and extract sentiment'"),
      entitySlug: z.string().optional().describe("Entity slug to build in"),
    },
    ({ task, entitySlug }) =>
      userMessage(
        [
          `Set up a ShapeShyft endpoint for this task: ${task}`,
          entitySlug ? `Use the entity \`${entitySlug}\`.` : "",
          "",
          "Work through these steps, checking the result of each before moving on:",
          "1. Read `describe_shapeshyft_api` (overview + examples) if you have not already.",
          "2. `list_entities` to confirm the target entity and your role in it.",
          "3. `list_llm_keys` — reuse a suitable provider key, or create one with `create_llm_key`.",
          "4. `list_provider_models` for that provider; pick a model whose capabilities cover the task",
          "   (vision/audio/web search if needed) and note its pricing.",
          "5. `list_projects` — reuse or `create_project`.",
          "6. Design the output JSON Schema first: enums for anything branched on, descriptions on",
          "   ambiguous fields, everything needed listed in `required`. Then `create_endpoint` with",
          "   instructions, system context, and both schemas.",
          "7. `preview_endpoint_prompt` with realistic input to check what the model will actually be",
          "   told — this costs nothing.",
          "8. `invoke_endpoint` with the same input and confirm the output matches the schema.",
          "9. Report the public URL, the sample response, and the estimated cost per call.",
        ]
          .filter(Boolean)
          .join("\n")
      )
  );

  server.prompt(
    "debug_endpoint",
    "Diagnose a failing or low-quality ShapeShyft endpoint.",
    {
      projectName: z.string().describe("Project slug"),
      endpointName: z.string().describe("Endpoint slug"),
      symptom: z.string().describe("What goes wrong, e.g. '401 on every call' or 'category is often wrong'"),
    },
    ({ projectName, endpointName, symptom }) =>
      userMessage(
        [
          `The ShapeShyft endpoint \`${projectName}/${endpointName}\` is misbehaving: ${symptom}`,
          "",
          "Diagnose it systematically:",
          "1. Read `describe_shapeshyft_api` section 'errors' and match the symptom to a known cause.",
          "2. `get_endpoint` — check is_active, http_method, model, llm_key_id, ip_allowlist, and the schemas.",
          "3. `get_project` — an inactive project makes every endpoint return 404.",
          "4. `list_llm_keys` — confirm the referenced key exists, is active, and has a secret stored.",
          "5. For quality problems, `preview_endpoint_prompt` with a failing input and read what the model",
          "   is actually told; tighten instructions, context, and the output schema from there.",
          "6. For quota or cost problems, `get_rate_limits` and `get_analytics` (failures are recorded too).",
          "7. State the root cause, then propose the specific `update_endpoint` call that fixes it.",
        ].join("\n")
      )
  );

  server.prompt(
    "audit_entity",
    "Inventory an entity's ShapeShyft configuration and flag risks.",
    { entitySlug: z.string().optional().describe("Entity slug to audit") },
    ({ entitySlug }) =>
      userMessage(
        [
          entitySlug
            ? `Audit the ShapeShyft entity \`${entitySlug}\`.`
            : "Audit my ShapeShyft entity (use list_entities to pick it).",
          "",
          "Inventory: entities and members, LLM keys (provider, active), projects, and every endpoint.",
          "Then flag:",
          "- endpoints with no output_schema (they lose structured output guarantees)",
          "- endpoints referencing an inactive or missing LLM key",
          "- inactive projects or endpoints that look abandoned",
          "- endpoints with `output_media_format: \"url\"` while no storage config exists",
          "- publicly reachable endpoints with no ip_allowlist that handle sensitive data",
          "- members with more privilege than they need, and stale pending invitations",
          "- usage and spend concentration from `get_analytics`, plus headroom from `get_rate_limits`",
          "Finish with a prioritized list of concrete fixes.",
        ].join("\n")
      )
  );
}
