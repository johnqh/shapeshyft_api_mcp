/**
 * @fileoverview Project tools — Firebase auth.
 *
 * A project groups endpoints under one caller-facing API key (sk_live_...).
 * The key is generated automatically at project creation, encrypted at rest, and
 * is the credential passed to invoke_endpoint.
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { compact, run } from "./util.ts";

const entitySlugArg = z
  .string()
  .optional()
  .describe("Entity slug that owns the project. Defaults to SHAPESHYFT_ENTITY_SLUG.");

const projectIdArg = z.string().describe("Project UUID (from list_projects)");

const projectsPath = (entitySlug?: string) =>
  `/api/v1/entities/${client.seg(client.resolveEntitySlug(entitySlug))}/projects`;

export function registerProjectTools(server: McpServer) {
  server.tool(
    "list_projects",
    "List the projects in an entity (GET /api/v1/entities/:entitySlug/projects). Each project has " +
      "uuid, project_name (the slug used in AI URLs), display_name, is_active, and api_key_prefix. " +
      "The full API key is never included here — use get_project_api_key.",
    { entitySlug: entitySlugArg },
    async ({ entitySlug }) => run(() => client.get(projectsPath(entitySlug)))
  );

  server.tool(
    "get_project",
    "Get one project by UUID (GET /api/v1/entities/:entitySlug/projects/:projectId).",
    { entitySlug: entitySlugArg, projectId: projectIdArg },
    async ({ entitySlug, projectId }) =>
      run(() => client.get(`${projectsPath(entitySlug)}/${client.seg(projectId)}`))
  );

  server.tool(
    "create_project",
    "Create a project (POST /api/v1/entities/:entitySlug/projects). A project API key (sk_live_...) is " +
      "generated automatically. `project_name` must be lowercase alphanumeric with optional hyphens " +
      "(no leading/trailing hyphen) and must be unique within the entity — it becomes the " +
      ":projectName segment of the public AI URL. Requires manager or owner role.\n\n" +
      'Example: create_project({ project_name: "support-tools", display_name: "Support Tools" })',
    {
      entitySlug: entitySlugArg,
      project_name: z.string().describe("URL slug, lowercase alphanumeric + hyphens, e.g. 'support-tools'"),
      display_name: z.string().describe("Human-readable name"),
      description: z.string().optional().describe("Optional description (max 1000 chars)"),
    },
    async ({ entitySlug, project_name, display_name, description }) =>
      run(() =>
        client.post(projectsPath(entitySlug), {
          body: compact({ project_name, display_name, description }),
        })
      )
  );

  server.tool(
    "update_project",
    "Update a project (PUT /api/v1/entities/:entitySlug/projects/:projectId). Renaming `project_name` " +
      "changes the public AI URL and breaks existing callers. Setting `is_active: false` makes every " +
      "endpoint in the project return 404 on invocation.",
    {
      entitySlug: entitySlugArg,
      projectId: projectIdArg,
      project_name: z.string().optional(),
      display_name: z.string().optional(),
      description: z.string().optional(),
      is_active: z.boolean().optional(),
    },
    async ({ entitySlug, projectId, project_name, display_name, description, is_active }) =>
      run(() =>
        client.put(`${projectsPath(entitySlug)}/${client.seg(projectId)}`, {
          body: compact({ project_name, display_name, description, is_active }),
        })
      )
  );

  server.tool(
    "delete_project",
    "Delete a project and its endpoints (DELETE /api/v1/entities/:entitySlug/projects/:projectId). " +
      "Irreversible — the project API key stops working immediately.",
    { entitySlug: entitySlugArg, projectId: projectIdArg },
    async ({ entitySlug, projectId }) =>
      run(() => client.del(`${projectsPath(entitySlug)}/${client.seg(projectId)}`))
  );

  server.tool(
    "get_project_api_key",
    "Reveal a project's full API key (GET /api/v1/entities/:entitySlug/projects/:projectId/api-key). " +
      "Returns { api_key } — the sk_live_... value callers send as `Authorization: Bearer` when invoking " +
      "endpoints. Treat it as a secret: it grants LLM spend against the entity's rate limits. " +
      "404 if the project has no key configured.",
    { entitySlug: entitySlugArg, projectId: projectIdArg },
    async ({ entitySlug, projectId }) =>
      run(() =>
        client.get(`${projectsPath(entitySlug)}/${client.seg(projectId)}/api-key`)
      )
  );

  server.tool(
    "refresh_project_api_key",
    "Rotate a project's API key " +
      "(POST /api/v1/entities/:entitySlug/projects/:projectId/api-key/refresh). Returns " +
      "{ api_key, api_key_prefix, api_key_created_at }. The previous key stops working immediately, so " +
      "every caller must be updated. Requires manager or owner role.",
    { entitySlug: entitySlugArg, projectId: projectIdArg },
    async ({ entitySlug, projectId }) =>
      run(() =>
        client.post(
          `${projectsPath(entitySlug)}/${client.seg(projectId)}/api-key/refresh`
        )
      )
  );
}
