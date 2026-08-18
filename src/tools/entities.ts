/**
 * @fileoverview Entity (workspace / organization) tools — Firebase auth.
 *
 * An entity is the tenant that owns LLM keys, projects, and endpoints. Every
 * user gets one `personal` entity (role: manager) and can create `organization`
 * entities (creator role: owner). The entity slug is the `:entitySlug` path
 * segment everywhere else in the API, and is also the public `organizationPath`
 * in AI URLs.
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { compact, run } from "./util.ts";

const roleSchema = z
  .enum(["owner", "manager", "member"])
  .describe(
    "owner: full access including member management (organizations only); " +
      "manager: manage projects/endpoints/keys; member: read-only"
  );

const entitySlugArg = z
  .string()
  .optional()
  .describe("Entity slug (1-12 chars). Defaults to SHAPESHYFT_ENTITY_SLUG.");

export function registerEntityTools(server: McpServer) {
  server.tool(
    "list_entities",
    "List every entity (personal workspace + organizations) the authenticated user belongs to " +
      "(GET /api/v1/entities). Each item includes entitySlug, entityType, displayName, and the caller's " +
      "userRole. Start here to discover the slug other tools need.",
    {},
    async () => run(() => client.get("/api/v1/entities"))
  );

  server.tool(
    "get_entity",
    "Get one entity by slug along with the caller's role (GET /api/v1/entities/:entitySlug). " +
      "403 if the caller is not a member.",
    { entitySlug: entitySlugArg },
    async ({ entitySlug }) =>
      run(() =>
        client.get(`/api/v1/entities/${client.seg(client.resolveEntitySlug(entitySlug))}`)
      )
  );

  server.tool(
    "create_entity",
    "Create an organization entity (POST /api/v1/entities). The caller becomes its owner. " +
      "Personal entities are created automatically on first login and cannot be created here.",
    {
      displayName: z.string().describe("Human-readable name, e.g. 'Acme Support'"),
      entitySlug: z
        .string()
        .optional()
        .describe("Desired slug, 1-12 alphanumeric chars. Auto-generated when omitted."),
      description: z.string().optional().describe("Optional description"),
    },
    async ({ displayName, entitySlug, description }) =>
      run(() =>
        client.post("/api/v1/entities", {
          body: compact({ displayName, entitySlug, description }),
        })
      )
  );

  server.tool(
    "update_entity",
    "Update an entity's display name, description, or avatar (PUT /api/v1/entities/:entitySlug). " +
      "Requires owner or manager role.",
    {
      entitySlug: entitySlugArg,
      displayName: z.string().optional(),
      description: z.string().optional(),
      avatarUrl: z.string().optional(),
    },
    async ({ entitySlug, displayName, description, avatarUrl }) =>
      run(() =>
        client.put(
          `/api/v1/entities/${client.seg(client.resolveEntitySlug(entitySlug))}`,
          { body: compact({ displayName, description, avatarUrl }) }
        )
      )
  );

  server.tool(
    "delete_entity",
    "Delete an organization entity (DELETE /api/v1/entities/:entitySlug). Owner only. " +
      "Personal entities cannot be deleted. This also removes the projects, endpoints, and keys it owns.",
    { entitySlug: entitySlugArg },
    async ({ entitySlug }) =>
      run(() =>
        client.del(`/api/v1/entities/${client.seg(client.resolveEntitySlug(entitySlug))}`)
      )
  );

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  server.tool(
    "list_entity_members",
    "List the members of an entity with their roles (GET /api/v1/entities/:entitySlug/members). " +
      "The `userId` field on each member is the Firebase UID used by the member management tools.",
    { entitySlug: entitySlugArg },
    async ({ entitySlug }) =>
      run(() =>
        client.get(
          `/api/v1/entities/${client.seg(client.resolveEntitySlug(entitySlug))}/members`
        )
      )
  );

  server.tool(
    "update_member_role",
    "Change a member's role (PUT /api/v1/entities/:entitySlug/members/:memberId). " +
      "`memberId` is the member's Firebase UID (the `userId` field from list_entity_members), " +
      "not the membership row id. Requires owner role.",
    {
      entitySlug: entitySlugArg,
      memberId: z.string().describe("Firebase UID of the member to update"),
      role: roleSchema,
    },
    async ({ entitySlug, memberId, role }) =>
      run(() =>
        client.put(
          `/api/v1/entities/${client.seg(
            client.resolveEntitySlug(entitySlug)
          )}/members/${client.seg(memberId)}`,
          { body: { role } }
        )
      )
  );

  server.tool(
    "remove_entity_member",
    "Remove a member from an entity (DELETE /api/v1/entities/:entitySlug/members/:memberId). " +
      "`memberId` is the member's Firebase UID. Requires owner role.",
    {
      entitySlug: entitySlugArg,
      memberId: z.string().describe("Firebase UID of the member to remove"),
    },
    async ({ entitySlug, memberId }) =>
      run(() =>
        client.del(
          `/api/v1/entities/${client.seg(
            client.resolveEntitySlug(entitySlug)
          )}/members/${client.seg(memberId)}`
        )
      )
  );

  // ---------------------------------------------------------------------------
  // Invitations (entity side)
  // ---------------------------------------------------------------------------

  server.tool(
    "list_entity_invitations",
    "List pending invitations for an entity (GET /api/v1/entities/:entitySlug/invitations). " +
      "Requires owner role.",
    { entitySlug: entitySlugArg },
    async ({ entitySlug }) =>
      run(() =>
        client.get(
          `/api/v1/entities/${client.seg(client.resolveEntitySlug(entitySlug))}/invitations`
        )
      )
  );

  server.tool(
    "invite_member",
    "Invite someone to an entity by email (POST /api/v1/entities/:entitySlug/invitations). " +
      "Sends an invitation email (when Resend is configured) and returns the invitation record " +
      "including the `token` the invitee uses to accept. Invitations expire after 14 days.",
    {
      entitySlug: entitySlugArg,
      email: z.string().describe("Email address to invite"),
      role: roleSchema,
    },
    async ({ entitySlug, email, role }) =>
      run(() =>
        client.post(
          `/api/v1/entities/${client.seg(client.resolveEntitySlug(entitySlug))}/invitations`,
          { body: { email, role } }
        )
      )
  );

  server.tool(
    "renew_invitation",
    "Renew a pending invitation with a fresh 14-day expiry and resend the email " +
      "(PUT /api/v1/entities/:entitySlug/invitations/:invitationId).",
    {
      entitySlug: entitySlugArg,
      invitationId: z.string().describe("Invitation UUID (the `id` field)"),
    },
    async ({ entitySlug, invitationId }) =>
      run(() =>
        client.put(
          `/api/v1/entities/${client.seg(
            client.resolveEntitySlug(entitySlug)
          )}/invitations/${client.seg(invitationId)}`
        )
      )
  );

  server.tool(
    "cancel_invitation",
    "Cancel a pending invitation (DELETE /api/v1/entities/:entitySlug/invitations/:invitationId).",
    {
      entitySlug: entitySlugArg,
      invitationId: z.string().describe("Invitation UUID (the `id` field)"),
    },
    async ({ entitySlug, invitationId }) =>
      run(() =>
        client.del(
          `/api/v1/entities/${client.seg(
            client.resolveEntitySlug(entitySlug)
          )}/invitations/${client.seg(invitationId)}`
        )
      )
  );

  // ---------------------------------------------------------------------------
  // Invitations (invitee side)
  // ---------------------------------------------------------------------------

  server.tool(
    "list_my_invitations",
    "List invitations addressed to the authenticated user's email (GET /api/v1/invitations). " +
      "Returns an empty list when the Firebase token carries no email.",
    {},
    async () => run(() => client.get("/api/v1/invitations"))
  );

  server.tool(
    "accept_invitation",
    "Accept an invitation and join the entity (POST /api/v1/invitations/:token/accept). " +
      "`token` is the invitation token from the email link or list_my_invitations.",
    { token: z.string().describe("Invitation token") },
    async ({ token }) =>
      run(() => client.post(`/api/v1/invitations/${client.seg(token)}/accept`))
  );

  server.tool(
    "decline_invitation",
    "Decline an invitation (POST /api/v1/invitations/:token/decline).",
    { token: z.string().describe("Invitation token") },
    async ({ token }) =>
      run(() => client.post(`/api/v1/invitations/${client.seg(token)}/decline`))
  );
}
