/**
 * @fileoverview Health / liveness tools (public, no auth).
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { run } from "./util.ts";

export function registerHealthTools(server: McpServer) {
  server.tool(
    "check_api_health",
    "Check that the ShapeShyft API is reachable. `readiness: false` (default) hits GET /health " +
      "(liveness only); `readiness: true` hits GET /health/ready which also verifies the PostgreSQL " +
      "connection and returns 503 when the database is down.",
    {
      readiness: z
        .boolean()
        .optional()
        .describe("Check database readiness (GET /health/ready) instead of plain liveness"),
    },
    async ({ readiness }) =>
      run(() => client.get(readiness ? "/health/ready" : "/health", { auth: "none" }))
  );

  server.tool(
    "get_api_info",
    "Get the API banner from GET / — returns the service name, version, and status. " +
      "Useful for confirming which deployment SHAPESHYFT_API_URL points at.",
    {},
    async () => run(() => client.get("/", { auth: "none" }))
  );
}
