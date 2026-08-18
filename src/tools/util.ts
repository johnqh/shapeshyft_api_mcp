/**
 * @fileoverview Shared helpers for tool handlers.
 */

import { ApiError } from "../client.ts";

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Wrap a JSON-serializable value as an MCP text result. */
export function ok(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

/** Wrap an error message as a failed MCP tool result. */
export function fail(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Run an API call and format the outcome. Errors are returned as tool errors
 * (with HTTP status and provider details when present) instead of crashing the
 * server, so the assistant can react to them.
 */
export async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    if (error instanceof ApiError) {
      const detail =
        error.details === undefined
          ? ""
          : `\nDetails: ${JSON.stringify(error.details, null, 2)}`;
      return fail(`ShapeShyft API error (HTTP ${error.status}): ${error.message}${detail}`);
    }
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** Drop undefined values so PATCH-style bodies only carry provided fields. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}
