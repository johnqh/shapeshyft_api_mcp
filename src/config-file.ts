/**
 * @fileoverview Local credential store.
 *
 * The MCP server is usually launched by a client (Claude Code, Claude Desktop)
 * whose configuration the user may not want to edit — and a personal API key is
 * exactly the kind of value that should not be pasted into a shared settings
 * file or a repository. So credentials live in a per-user config file that the
 * server reads at startup and the `set_credentials` tool can write.
 *
 * Location: `~/.shapeshyft/config.json`, overridable with `SHAPESHYFT_CONFIG_PATH`.
 * The file is written with mode 0600 (owner read/write only), as is its directory.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Shape of the on-disk config. Every field is optional. */
export interface StoredConfig {
  /** Base URL of the API */
  apiUrl?: string;
  /** Personal API key (shyft_...) for admin routes */
  apiKey?: string;
  /** Project API key (sk_live_...) for AI invocation */
  projectApiKey?: string;
  /** Default entity slug */
  entitySlug?: string;
  /** Default organization path for AI URLs */
  orgPath?: string;
}

const CONFIG_FILENAME = "config.json";
const CONFIG_DIRNAME = ".shapeshyft";

/** Absolute path of the config file this process reads and writes. */
export function configFilePath(): string {
  const override = process.env["SHAPESHYFT_CONFIG_PATH"];
  if (override) return override;
  return join(homedir(), CONFIG_DIRNAME, CONFIG_FILENAME);
}

/**
 * Read the stored config.
 * A missing file is normal — first run — and yields an empty object. A corrupt
 * file is reported on stderr and also yields an empty object, so a bad edit
 * degrades to "no stored credentials" instead of preventing startup.
 */
export function readConfigFile(): StoredConfig {
  const path = configFilePath();
  if (!existsSync(path)) return {};

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error(`[shapeshyft-api] Ignoring ${path}: expected a JSON object.`);
      return {};
    }
    return parsed as StoredConfig;
  } catch (error) {
    console.error(
      `[shapeshyft-api] Ignoring ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return {};
  }
}

/**
 * Merge values into the stored config and write it back.
 * Only defined fields are applied, so a partial save keeps everything else.
 *
 * @returns The path written, for reporting back to the user
 */
export function writeConfigFile(patch: StoredConfig): string {
  const path = configFilePath();
  const merged: StoredConfig = { ...readConfigFile() };

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      merged[key as keyof StoredConfig] = value as string;
    }
  }

  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync only applies mode when creating the file, so an existing file
  // with looser permissions is tightened explicitly.
  chmodSync(path, 0o600);

  return path;
}

/**
 * Remove stored credentials, keeping non-secret preferences.
 * @returns The path written
 */
export function clearStoredCredentials(): string {
  const current = readConfigFile();
  delete current.apiKey;
  delete current.projectApiKey;

  const path = configFilePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);

  return path;
}
