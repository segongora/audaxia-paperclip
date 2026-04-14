/**
 * Simple AES-256-GCM encryption for instance-level credentials stored in the DB.
 * Reuses the same master key loading logic as the local-encrypted secret provider.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";

interface EncryptedValue {
  scheme: "instance_v1";
  iv: string;
  tag: string;
  ciphertext: string;
}

function resolveMasterKeyFilePath() {
  const fromEnv = process.env.PAPERCLIP_SECRETS_MASTER_KEY_FILE;
  if (fromEnv && fromEnv.trim().length > 0) return path.resolve(fromEnv.trim());
  return path.resolve(process.cwd(), "data/secrets/master.key");
}

function decodeMasterKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[A-Fa-f0-9]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    // ignored
  }
  if (Buffer.byteLength(trimmed, "utf8") === 32) return Buffer.from(trimmed, "utf8");
  return null;
}

function loadOrCreateMasterKey(): Buffer {
  const envKeyRaw = process.env.PAPERCLIP_SECRETS_MASTER_KEY;
  if (envKeyRaw && envKeyRaw.trim().length > 0) {
    const fromEnv = decodeMasterKey(envKeyRaw);
    if (!fromEnv) throw new Error("Invalid PAPERCLIP_SECRETS_MASTER_KEY");
    return fromEnv;
  }
  const keyPath = resolveMasterKeyFilePath();
  if (existsSync(keyPath)) {
    const raw = readFileSync(keyPath, "utf8");
    const decoded = decodeMasterKey(raw);
    if (!decoded) throw new Error(`Invalid secrets master key at ${keyPath}`);
    return decoded;
  }
  const dir = path.dirname(keyPath);
  mkdirSync(dir, { recursive: true });
  const generated = randomBytes(32);
  writeFileSync(keyPath, generated.toString("base64"), { encoding: "utf8", mode: 0o600 });
  try { chmodSync(keyPath, 0o600); } catch { /* best effort */ }
  return generated;
}

export function encryptCredential(value: string): EncryptedValue {
  const masterKey = loadOrCreateMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    scheme: "instance_v1",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptCredential(value: EncryptedValue): string {
  const masterKey = loadOrCreateMasterKey();
  const iv = Buffer.from(value.iv, "base64");
  const tag = Buffer.from(value.tag, "base64");
  const ciphertext = Buffer.from(value.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function isEncryptedValue(value: unknown): value is EncryptedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).scheme === "instance_v1"
  );
}

/** SHA-256 hex of value for equality checks (never store raw values) */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Mask a credential for display: show prefix + dots + last 4 chars */
export function maskCredential(value: string): string {
  if (!value || value.length <= 8) return "****";
  const prefix = value.slice(0, 7);
  const suffix = value.slice(-4);
  return `${prefix}...${suffix}`;
}
