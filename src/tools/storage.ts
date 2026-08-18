/**
 * @fileoverview Entity cloud storage tools — Firebase auth.
 *
 * Storage is only needed when an endpoint sets `output_media_format: "url"`:
 * generated images/audio/video are uploaded to the entity's bucket and returned
 * as signed URLs that expire after 7 days. Credentials are encrypted at rest and
 * never returned by the API.
 */

import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as client from "../client.ts";
import { compact, run } from "./util.ts";

const entitySlugArg = z
  .string()
  .optional()
  .describe("Entity slug. Defaults to SHAPESHYFT_ENTITY_SLUG.");

const storagePath = (entitySlug?: string) =>
  `/api/v1/entities/${client.seg(client.resolveEntitySlug(entitySlug))}/storage`;

const credentialsArg = z
  .record(z.string(), z.unknown())
  .describe(
    "Provider credentials. GCS: the full service account JSON " +
      "({ type: 'service_account', project_id, private_key_id, private_key, client_email, client_id, ... }). " +
      "S3: { access_key_id, secret_access_key, region }. Encrypted at rest and never returned."
  );

export function registerStorageTools(server: McpServer) {
  server.tool(
    "get_storage_config",
    "Get the entity's cloud storage configuration (GET /api/v1/entities/:entitySlug/storage). " +
      "Returns provider, bucket, and path_prefix — never the credentials. 404 when none is configured.",
    { entitySlug: entitySlugArg },
    async ({ entitySlug }) => run(() => client.get(storagePath(entitySlug)))
  );

  server.tool(
    "set_storage_config",
    "Create or replace the entity's storage configuration (POST /api/v1/entities/:entitySlug/storage, " +
      "upsert). The credentials must match the provider. Requires manager or owner role.\n\n" +
      'Example: set_storage_config({ provider: "s3", bucket: "my-media", path_prefix: "shapeshyft/", ' +
      'credentials: { access_key_id: "AKIA...", secret_access_key: "...", region: "us-east-1" } })',
    {
      entitySlug: entitySlugArg,
      provider: z.enum(["gcs", "s3"]).describe("Cloud storage provider"),
      bucket: z.string().describe("Bucket name"),
      path_prefix: z.string().optional().describe("Optional key prefix for uploaded objects"),
      credentials: credentialsArg,
    },
    async ({ entitySlug, provider, bucket, path_prefix, credentials }) =>
      run(() =>
        client.post(storagePath(entitySlug), {
          body: compact({ provider, bucket, path_prefix, credentials }),
        })
      )
  );

  server.tool(
    "update_storage_config",
    "Partially update the storage configuration (PUT /api/v1/entities/:entitySlug/storage). " +
      "Credentials are optional here — omit them to keep the stored ones. The provider cannot be " +
      "changed; use set_storage_config for that.",
    {
      entitySlug: entitySlugArg,
      bucket: z.string().optional(),
      path_prefix: z.string().nullable().optional(),
      credentials: credentialsArg.optional(),
    },
    async ({ entitySlug, bucket, path_prefix, credentials }) =>
      run(() =>
        client.put(storagePath(entitySlug), {
          body: compact({ bucket, path_prefix, credentials }),
        })
      )
  );

  server.tool(
    "delete_storage_config",
    "Delete the entity's storage configuration (DELETE /api/v1/entities/:entitySlug/storage). " +
      "Endpoints with output_media_format 'url' will fail until storage is configured again.",
    { entitySlug: entitySlugArg },
    async ({ entitySlug }) => run(() => client.del(storagePath(entitySlug)))
  );
}
