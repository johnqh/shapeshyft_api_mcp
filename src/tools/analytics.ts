/**
 * @fileoverview Usage analytics tools — Firebase auth.
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { compact, run } from "./util.ts";

export function registerAnalyticsTools(server: McpServer) {
  server.tool(
    "get_analytics",
    "Get usage analytics for an entity (GET /api/v1/entities/:entitySlug/analytics). Returns " +
      "{ aggregate, by_endpoint[] } where each block has total_requests, successful_requests, " +
      "failed_requests, total_tokens_input, total_tokens_output, total_estimated_cost_cents, and " +
      "average_latency_ms. Costs are in cents. One row is recorded per invocation, including failures.\n\n" +
      'Example: get_analytics({ start_date: "2026-08-01", end_date: "2026-08-17" })',
    {
      entitySlug: z
        .string()
        .optional()
        .describe("Entity slug. Defaults to SHAPESHYFT_ENTITY_SLUG."),
      start_date: z.string().optional().describe("Inclusive start date, YYYY-MM-DD (UTC)"),
      end_date: z.string().optional().describe("Inclusive end date, YYYY-MM-DD (UTC)"),
      project_id: z.string().optional().describe("Limit to one project UUID"),
      endpoint_id: z.string().optional().describe("Limit to one endpoint UUID"),
    },
    async ({ entitySlug, start_date, end_date, project_id, endpoint_id }) =>
      run(() =>
        client.get(
          `/api/v1/entities/${client.seg(client.resolveEntitySlug(entitySlug))}/analytics`,
          { query: compact({ start_date, end_date, project_id, endpoint_id }) }
        )
      )
  );
}
