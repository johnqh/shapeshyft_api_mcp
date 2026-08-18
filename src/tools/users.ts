/**
 * @fileoverview User, settings, and subscription tools — Firebase auth.
 *
 * All of these routes require the requested `userId` to match the Firebase UID
 * in the token, so they only ever describe the authenticated user (403 otherwise).
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { compact, run } from "./util.ts";

const userIdArg = z
  .string()
  .describe("Firebase UID of the authenticated user (must match the token)");

export function registerUserTools(server: McpServer) {
  server.tool(
    "get_user_info",
    "Get the authenticated user's profile, including whether they are a site admin " +
      "(GET /api/v1/users/:userId). Site-admin-owned entities are exempt from rate limiting. " +
      "403 when userId does not match the token.",
    { userId: userIdArg },
    async ({ userId }) => run(() => client.get(`/api/v1/users/${client.seg(userId)}`))
  );

  server.tool(
    "get_user_subscription",
    "Get the user's subscription status from RevenueCat " +
      "(GET /api/v1/users/:userId/subscriptions): hasSubscription, entitlements, platform, " +
      "productIdentifier, expiresDate, willRenew, managementUrl. Note that ShapeShyft rate limits are " +
      "resolved per *entity*, so use get_rate_limits for effective quotas.",
    {
      userId: userIdArg,
      testMode: z.boolean().optional().describe("Include RevenueCat sandbox purchases"),
    },
    async ({ userId, testMode }) =>
      run(() =>
        client.get(`/api/v1/users/${client.seg(userId)}/subscriptions`, {
          query: testMode ? { testMode: true } : undefined,
        })
      )
  );

  server.tool(
    "get_user_settings",
    "Get the user's settings (GET /api/v1/users/:userId/settings): organization_name and " +
      "organization_path. When nothing has been saved yet the API returns generated defaults with " +
      "`is_default: true` and an organization_path derived from the first 8 characters of the UID.",
    { userId: userIdArg },
    async ({ userId }) =>
      run(() => client.get(`/api/v1/users/${client.seg(userId)}/settings`))
  );

  server.tool(
    "update_user_settings",
    "Create or update the user's settings (PUT /api/v1/users/:userId/settings, upsert). " +
      "`organization_path` may contain only letters, numbers, and underscores and must be globally " +
      "unique — 409 if it is already taken.",
    {
      userId: userIdArg,
      organization_name: z.string().optional().describe("Display name of the organization"),
      organization_path: z
        .string()
        .optional()
        .describe("URL path segment; letters, numbers, and underscores only"),
    },
    async ({ userId, organization_name, organization_path }) =>
      run(() =>
        client.put(`/api/v1/users/${client.seg(userId)}/settings`, {
          body: compact({ organization_name, organization_path }),
        })
      )
  );
}
