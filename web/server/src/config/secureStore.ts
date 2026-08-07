import * as crypto from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { findAgentRoot } from "../context";

const ALGO = "aes-256-gcm";
const CONFIG_KEYS = [
  "GITHUB_TOKEN",
  "GITHUB_OWNER",
  "GITHUB_REPO",
  "ANTHROPIC_API_KEY",
  "MCP_SERVER_PORT",
  "OLLAMA_MODEL",
  "OLLAMA_URL"
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];
export type Config = Partial<Record<ConfigKey, string>>;

const SECRET_KEYS: ReadonlySet<ConfigKey> = new Set(["GITHUB_TOKEN", "ANTHROPIC_API_KEY"]);

interface EncryptedRecord {
  iv: string;
  tag: string;
  ciphertext: string;
}

interface StoredFile {
  version: 1;
  secrets: Partial<Record<ConfigKey, EncryptedRecord>>;
  plain: Partial<Record<ConfigKey, string>>;
}

/**
 * This file holds the dashboard's own encrypted local state (not target-repo
 * data), so it must always land in pr-review-agent's own tree regardless of the
 * directory the server was launched from. Anchored on `findAgentRoot()` +
 * `web/server/` — where the file is tracked today — so `npm run dev` from
 * `web/server/`, `npm --prefix server run start` from `web/`, and a launch from
 * a nested host repo root all read and write the same settings.
 */
function storeFilePath(): string {
  return path.join(findAgentRoot(), "web", "server", ".web-settings.json");
}

function deriveKey(): Buffer {
  const raw = process.env.WEB_SECRET_KEY;
  if (!raw || raw.length < 16) {
    // Fall back to a deterministic dev key so first-run works, but log once.
    return crypto.createHash("sha256").update("pr-review-agent:dev-key").digest();
  }
  return crypto.createHash("sha256").update(raw).digest();
}

function encrypt(plain: string): EncryptedRecord {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, deriveKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ct.toString("base64")
  };
}

function decrypt(record: EncryptedRecord): string {
  const decipher = crypto.createDecipheriv(ALGO, deriveKey(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

async function readFile(): Promise<StoredFile> {
  try {
    const raw = await fs.readFile(storeFilePath(), "utf8");
    return JSON.parse(raw) as StoredFile;
  } catch {
    return { version: 1, secrets: {}, plain: {} };
  }
}

async function writeFile(file: StoredFile): Promise<void> {
  await fs.writeFile(storeFilePath(), JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
}

/** Merge current process env + persisted store, decrypting secrets. */
export async function loadConfig(): Promise<Config> {
  const stored = await readFile();
  const result: Config = {};
  for (const key of CONFIG_KEYS) {
    const persisted = SECRET_KEYS.has(key)
      ? stored.secrets[key]
        ? tryDecrypt(stored.secrets[key])
        : undefined
      : stored.plain[key];
    const envValue = process.env[key];
    const value = (persisted && persisted.length > 0 ? persisted : undefined) ?? envValue;
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function tryDecrypt(record: EncryptedRecord | undefined): string | undefined {
  if (!record) return undefined;
  try {
    return decrypt(record);
  } catch {
    return undefined;
  }
}

/** Persist a partial update. Secret keys are encrypted; blanks are treated as unset. */
export async function saveConfig(update: Config): Promise<Config> {
  const stored = await readFile();
  for (const key of CONFIG_KEYS) {
    const value = update[key];
    if (value === undefined) continue;
    if (value === "") {
      delete stored.secrets[key];
      delete stored.plain[key];
      continue;
    }
    if (SECRET_KEYS.has(key)) {
      stored.secrets[key] = encrypt(value);
      delete stored.plain[key];
    } else {
      stored.plain[key] = value;
    }
  }
  await writeFile(stored);
  const merged = await loadConfig();
  applyToProcessEnv(merged);
  return merged;
}

/** Copy known config keys into process.env so downstream code (GitHubClient, resolveRepository) sees them. */
export function applyToProcessEnv(config: Config): void {
  for (const key of CONFIG_KEYS) {
    const value = config[key];
    if (value !== undefined && value !== "") {
      process.env[key] = value;
    }
  }
}

/** Return a version safe to send to the browser — secrets masked, non-secrets in the clear. */
export function toClientSafe(config: Config): Record<ConfigKey, { set: boolean; value: string }> {
  const out = {} as Record<ConfigKey, { set: boolean; value: string }>;
  for (const key of CONFIG_KEYS) {
    const raw = config[key] ?? "";
    if (SECRET_KEYS.has(key)) {
      out[key] = { set: raw.length > 0, value: raw ? mask(raw) : "" };
    } else {
      out[key] = { set: raw.length > 0, value: raw };
    }
  }
  return out;
}

function mask(value: string): string {
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 4)}${"•".repeat(Math.max(6, value.length - 8))}${value.slice(-4)}`;
}

export { CONFIG_KEYS };
