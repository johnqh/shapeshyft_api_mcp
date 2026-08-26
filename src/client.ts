/**
 * @fileoverview HTTP client for the ShapeShyft API.
 * @description Handles the two distinct auth schemes the API uses:
 *
 *  - Admin routes (`/api/v1/entities/*`, `/api/v1/users/*`, `/api/v1/ratelimits/*`,
 *    `/api/v1/invitations/*`) accept either credential:
 *      1. An **entity API key** (`shyftent_...`) sent as `X-API-Key`. Acts as the
 *         entity itself, so it keeps working when the member who created it
 *         leaves. Cannot reach `/users/*` or manage API keys.
 *      2. A **personal API key** (`shyft_...`) sent as `X-API-Key`. Acts as a
 *         user; does not expire, so an MCP session keeps working.
 *      3. A **Firebase ID token** sent as `Authorization: Bearer`. Required for
 *         the operations that hand back a secret (creating and revealing
 *         API keys), which the API refuses from key-authenticated callers.
 *  - AI routes (`/api/v1/ai/*`) authenticate with a **project API key**
 *    (`sk_live_...`): `Authorization: Bearer <project-api-key>`.
 *    (The API also accepts `?api_key=`, but on GET endpoints every query
 *    parameter becomes part of the endpoint input, so this client always
 *    uses the header.)
 *  - Public routes (`/api/v1/providers/*`, `/health`) need no auth at all.
 *
 * Every response is wrapped in `{ success, data, timestamp }`. This client
 * unwraps `data` on success and throws an `ApiError` on failure.
 */

export interface ClientConfig {
  /** Base URL of the API, e.g. https://api.shapeshyft.ai or http://localhost:3000 */
  apiUrl: string;
  /** Entity API key (shyftent_...) — authenticates as the entity itself */
  entityApiKey?: string | undefined;
  /** Personal API key (shyft_...) for admin routes — preferred, never expires */
  apiKey?: string | undefined;
  /** Firebase ID token for admin routes, and required for create/reveal of API keys */
  authToken?: string | undefined;
  /** Project API key (sk_live_...) for AI invocation routes */
  projectApiKey?: string | undefined;
  /** Default entity slug used when a tool call omits `entitySlug` */
  entitySlug?: string | undefined;
  /** Default organization path used when an AI tool call omits `orgPath` */
  orgPath?: string | undefined;
}

/**
 * Auth scheme to use for a request.
 *  - `admin`         personal API key if available, otherwise the Firebase token
 *  - `user`          personal key or Firebase token; entity keys are refused
 *                    because the API rejects them on user-scoped routes
 *  - `firebase_only` Firebase token required (create/reveal of API keys)
 *  - `project`       project API key, for AI invocation
 *  - `none`          public route
 */
export type AuthMode =
  | "admin"
  | "user"
  | "firebase_only"
  | "project"
  | "none";

export interface RequestOptions {
  auth?: AuthMode;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Overrides the configured project API key for this call only */
  apiKeyOverride?: string | undefined;
}

/** Error thrown when the API returns a non-2xx response or `success: false`. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  details?: unknown;
  timestamp?: string;
}

let config: ClientConfig | null = null;

export function configure(cfg: ClientConfig): void {
  config = { ...cfg, apiUrl: cfg.apiUrl.replace(/\/+$/, "") };
}

export function getConfig(): ClientConfig {
  if (!config) throw new Error("Client not configured. Call configure() first.");
  return config;
}

/**
 * Update parts of the configuration at runtime (the `set_credentials` tool).
 * Lets a user paste an API key, a fresh Firebase token, or a project key
 * mid-session instead of editing the MCP server environment and restarting.
 */
export function updateConfig(patch: Partial<ClientConfig>): void {
  const current = getConfig();
  // Credentials are usually pasted by a human, so surrounding whitespace and a
  // trailing newline are common and would otherwise corrupt the header.
  const cleaned = Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() : value,
    ]);

  const next: ClientConfig = { ...current, ...Object.fromEntries(cleaned) };
  next.apiUrl = next.apiUrl.replace(/\/+$/, "");
  config = next;
}

/** Redact a secret down to a recognizable prefix for display. */
export function redact(value: string | undefined): string | null {
  if (!value) return null;
  return value.length <= 12 ? "set (short value)" : `${value.slice(0, 12)}...(${value.length} chars)`;
}

/**
 * Resolve the entity slug for a call, falling back to SHAPESHYFT_ENTITY_SLUG.
 * Entity slugs are 1-12 characters and identify a personal or organization workspace.
 */
export function resolveEntitySlug(slug?: string): string {
  const resolved = slug ?? getConfig().entitySlug;
  if (!resolved) {
    throw new Error(
      "entitySlug is required. Pass it explicitly or set SHAPESHYFT_ENTITY_SLUG. " +
        "Use list_entities to see the slugs you have access to."
    );
  }
  return resolved;
}

/**
 * Resolve the organization path used in public AI URLs.
 * This is the entity slug of the workspace that owns the project.
 */
export function resolveOrgPath(orgPath?: string): string {
  const resolved = orgPath ?? getConfig().orgPath ?? getConfig().entitySlug;
  if (!resolved) {
    throw new Error(
      "orgPath is required. Pass it explicitly or set SHAPESHYFT_ORG_PATH / SHAPESHYFT_ENTITY_SLUG. " +
        "The organization path is the entity slug that owns the project."
    );
  }
  return resolved;
}

function buildHeaders(auth: AuthMode, apiKeyOverride?: string): Record<string, string> {
  const cfg = getConfig();
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (auth === "admin") {
    // Prefer the entity key, then the personal key: neither expires, so a long
    // session keeps working without the user re-pasting a token.
    if (cfg.entityApiKey) {
      headers["X-API-Key"] = cfg.entityApiKey;
    } else if (cfg.apiKey) {
      headers["X-API-Key"] = cfg.apiKey;
    } else if (cfg.authToken) {
      headers["Authorization"] = `Bearer ${cfg.authToken}`;
    } else {
      throw new Error(
        "No ShapeShyft credential configured. Create an entity API key at https://shapeshyft.ai " +
          "(Dashboard -> API Keys) or a personal API key (Dashboard -> Settings -> Personal API " +
          "Keys), then run set_credentials with it. A Firebase ID token in SHAPESHYFT_AUTH_TOKEN " +
          "also works."
      );
    }
  } else if (auth === "user") {
    // Refuse the entity key here rather than send one the API answers with a
    // confusing 403: entity keys are scoped to entity-owned resources.
    if (cfg.apiKey) {
      headers["X-API-Key"] = cfg.apiKey;
    } else if (cfg.authToken) {
      headers["Authorization"] = `Bearer ${cfg.authToken}`;
    } else {
      throw new Error(
        "This route needs a personal API key (shyft_...) or a Firebase ID token. An entity API " +
          "key authenticates as the entity and cannot act on a user's behalf."
      );
    }
  } else if (auth === "firebase_only") {
    if (!cfg.authToken) {
      throw new Error(
        "This operation needs a Firebase ID token, because the API refuses to create or reveal API " +
          "keys for a caller authenticated by API key. Sign in at https://shapeshyft.ai and manage " +
          "keys there, or set SHAPESHYFT_AUTH_TOKEN / call set_credentials with a token."
      );
    }
    headers["Authorization"] = `Bearer ${cfg.authToken}`;
  } else if (auth === "project") {
    const key = apiKeyOverride ?? cfg.projectApiKey;
    if (!key) {
      throw new Error(
        "This operation needs a project API key (sk_live_...). Pass `apiKey`, or set SHAPESHYFT_PROJECT_API_KEY. " +
          "Retrieve one with get_project_api_key or refresh_project_api_key."
      );
    }
    headers["Authorization"] = `Bearer ${key}`;
  }

  return headers;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${getConfig().apiUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function request<T = unknown>(
  method: string,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { auth = "admin", query, body, apiKeyOverride } = options;

  const res = await fetch(buildUrl(path, query), {
    method,
    headers: buildHeaders(auth, apiKeyOverride),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json: ApiEnvelope<T>;
  try {
    json = text ? (JSON.parse(text) as ApiEnvelope<T>) : { success: res.ok };
  } catch {
    throw new ApiError(
      `Non-JSON response (${res.status} ${res.statusText}): ${text.slice(0, 500)}`,
      res.status
    );
  }

  if (!res.ok || !json.success) {
    throw new ApiError(
      json.error ?? `${res.status} ${res.statusText}`,
      res.status,
      json.details
    );
  }

  return json.data as T;
}

export const get = <T = unknown>(path: string, options?: RequestOptions) =>
  request<T>("GET", path, options);

export const post = <T = unknown>(path: string, options?: RequestOptions) =>
  request<T>("POST", path, options);

export const put = <T = unknown>(path: string, options?: RequestOptions) =>
  request<T>("PUT", path, options);

export const del = <T = unknown>(path: string, options?: RequestOptions) =>
  request<T>("DELETE", path, options);

/** Encode a path segment so slugs/names with special characters stay valid. */
export const seg = (value: string): string => encodeURIComponent(value);
