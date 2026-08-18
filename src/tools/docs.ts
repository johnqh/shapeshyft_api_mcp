/**
 * @fileoverview Documentation tool.
 *
 * MCP resources are the idiomatic home for reference material, but not every
 * client surfaces them to the model. This tool exposes the same documents so the
 * API description is always reachable.
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DOC_SECTIONS, type DocSection } from "../resources/index.ts";
import { ok } from "./util.ts";

export function registerDocsTools(server: McpServer) {
  server.tool(
    "describe_shapeshyft_api",
    "Read the ShapeShyft API documentation bundled with this server. Sections: " +
      "'overview' (architecture, auth, invocation lifecycle, limits), 'routes' (every endpoint with " +
      "method/auth/params), 'data-model' (object shapes, rate limit tiers, tables), 'examples' " +
      "(end-to-end setup, curl/TypeScript/Python, schema patterns, multimodal), 'errors' (status codes " +
      "and troubleshooting), 'providers' (model selection, capabilities, pricing). " +
      "Needs no credentials and makes no network call — read this before configuring or debugging.",
    {
      section: z
        .enum(["overview", "routes", "data-model", "examples", "errors", "providers"])
        .optional()
        .describe("Which document to read. Omit for the overview."),
    },
    async ({ section }) => ok(DOC_SECTIONS[(section ?? "overview") as DocSection])
  );
}
