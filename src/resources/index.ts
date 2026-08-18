/**
 * @fileoverview MCP resources describing the ShapeShyft API.
 *
 * Tools let an assistant *drive* the API; these resources let it *understand*
 * the API — route reference, data model, worked examples, error handling, and
 * provider selection — without a network round trip or an API key.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  OVERVIEW_MD,
  ROUTES_MD,
  DATA_MODEL_MD,
  EXAMPLES_MD,
  ERRORS_MD,
  PROVIDERS_MD,
} from "./content.ts";

interface Doc {
  uri: string;
  name: string;
  title: string;
  description: string;
  text: string;
}

const DOCS: Doc[] = [
  {
    uri: "shapeshyft://api/overview",
    name: "shapeshyft-api-overview",
    title: "ShapeShyft API overview",
    description:
      "What ShapeShyft is, the entity/project/endpoint hierarchy, the two auth schemes, " +
      "the response envelope, the invocation lifecycle, and platform limits. Read this first.",
    text: OVERVIEW_MD,
  },
  {
    uri: "shapeshyft://api/routes",
    name: "shapeshyft-api-routes",
    title: "ShapeShyft API route reference",
    description:
      "Every HTTP route with method, path, required auth, parameters, and response shape.",
    text: ROUTES_MD,
  },
  {
    uri: "shapeshyft://api/data-model",
    name: "shapeshyft-api-data-model",
    title: "ShapeShyft API data model",
    description:
      "TypeScript shapes for Entity, Project, Endpoint, LLM keys, analytics, capabilities, " +
      "and pricing, plus the rate limit tiers and database tables.",
    text: DATA_MODEL_MD,
  },
  {
    uri: "shapeshyft://api/examples",
    name: "shapeshyft-api-examples",
    title: "ShapeShyft API examples",
    description:
      "End-to-end setup, curl/TypeScript/Python invocation, JSON Schema patterns, multimodal " +
      "input and output, transcription endpoints, IP allowlisting, and cost monitoring.",
    text: EXAMPLES_MD,
  },
  {
    uri: "shapeshyft://api/errors",
    name: "shapeshyft-api-errors",
    title: "ShapeShyft API errors",
    description:
      "Error envelope, status codes for AI and admin routes, common causes, and MCP-side errors.",
    text: ERRORS_MD,
  },
  {
    uri: "shapeshyft://api/providers",
    name: "shapeshyft-api-providers",
    title: "ShapeShyft providers and models",
    description:
      "Provider list, how to pick a model from capabilities and pricing, the multimodal " +
      "pipeline, web search, transcription, and self-hosted models.",
    text: PROVIDERS_MD,
  },
];

export function registerResources(server: McpServer) {
  for (const doc of DOCS) {
    server.resource(
      doc.name,
      doc.uri,
      { title: doc.title, description: doc.description, mimeType: "text/markdown" },
      async uri => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: doc.text }],
      })
    );
  }
}

/** Exposed as a tool too, so assistants that ignore resources can still read the docs. */
export const DOC_SECTIONS = {
  overview: OVERVIEW_MD,
  routes: ROUTES_MD,
  "data-model": DATA_MODEL_MD,
  examples: EXAMPLES_MD,
  errors: ERRORS_MD,
  providers: PROVIDERS_MD,
} as const;

export type DocSection = keyof typeof DOC_SECTIONS;
