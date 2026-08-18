/**
 * @fileoverview Rate limit tools — Firebase auth.
 *
 * Rate limits are enforced per entity and driven by the entity's RevenueCat
 * entitlement. The `:rateLimitUserId` path segment is the entity slug.
 * Tiers: none (Free) 10/hr, 120/day, 1800/mo · bandwidth_dev (Developer)
 * 100/1200/18000 · bandwidth_pro (Pro) 800/10000/150000 · bandwidth_ultra
 * (Ultra) unlimited. Entities owned by a site admin are exempt.
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { run } from "./util.ts";

const entitySlugArg = z
  .string()
  .optional()
  .describe("Entity slug (used as rateLimitUserId). Defaults to SHAPESHYFT_ENTITY_SLUG.");

const testModeArg = z
  .boolean()
  .optional()
  .describe("Set true to resolve entitlements against RevenueCat sandbox purchases");

export function registerRateLimitTools(server: McpServer) {
  server.tool(
    "get_rate_limits",
    "Get the rate limit tiers plus the entity's current entitlement, limits, and hourly/daily/monthly " +
      "usage (GET /api/v1/ratelimits/:entitySlug). When RevenueCat is not configured on the server, " +
      "static tier config is returned with zeroed usage.",
    { entitySlug: entitySlugArg, testMode: testModeArg },
    async ({ entitySlug, testMode }) =>
      run(() =>
        client.get(
          `/api/v1/ratelimits/${client.seg(client.resolveEntitySlug(entitySlug))}`,
          { query: testMode ? { testMode: true } : undefined }
        )
      )
  );

  server.tool(
    "get_rate_limit_history",
    "Get historical usage counters for an entity " +
      "(GET /api/v1/ratelimits/:entitySlug/history/:periodType), up to 100 entries.",
    {
      entitySlug: entitySlugArg,
      periodType: z.enum(["hour", "day", "month"]).describe("Bucket size for the history"),
      testMode: testModeArg,
    },
    async ({ entitySlug, periodType, testMode }) =>
      run(() =>
        client.get(
          `/api/v1/ratelimits/${client.seg(
            client.resolveEntitySlug(entitySlug)
          )}/history/${client.seg(periodType)}`,
          { query: testMode ? { testMode: true } : undefined }
        )
      )
  );
}
