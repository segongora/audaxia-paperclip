/**
 * Instance-level Claude credential management.
 * Handles encrypted storage, masked API responses, and runtime resolution.
 */
import type { Db } from "@paperclipai/db";
import { instanceSettings } from "@paperclipai/db";
import type {
  InstanceClaudeCredentials,
  InstanceClaudeCredentialsRuntime,
  PatchInstanceClaudeSubscription,
  PatchInstanceClaudeApiKey,
} from "@paperclipai/shared";
import { eq } from "drizzle-orm";
import {
  encryptCredential,
  decryptCredential,
  isEncryptedValue,
  maskCredential,
} from "./instance-crypto.js";

const DEFAULT_SINGLETON_KEY = "default";

// How long the subscription quota exhaustion is considered "active" (24h)
const FALLBACK_ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

// ─── Internal stored shape ────────────────────────────────────────────────────

interface StoredCredentialSource {
  enabled: boolean;
  encryptedValue: unknown | null;
  lastTestedAt: string | null;
  lastTestError: string | null;
  importedFromEnv?: boolean;
}

interface StoredCredentials {
  subscription: StoredCredentialSource;
  apiKey: StoredCredentialSource;
  lastFallbackAt: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptySource(): StoredCredentialSource {
  return { enabled: true, encryptedValue: null, lastTestedAt: null, lastTestError: null };
}

function normalizeStoredCredentials(raw: unknown): StoredCredentials {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      subscription: emptySource(),
      apiKey: emptySource(),
      lastFallbackAt: null,
    };
  }
  const r = raw as Record<string, unknown>;
  const sub = (r.subscription && typeof r.subscription === "object" && !Array.isArray(r.subscription))
    ? r.subscription as Record<string, unknown>
    : {};
  const api = (r.apiKey && typeof r.apiKey === "object" && !Array.isArray(r.apiKey))
    ? r.apiKey as Record<string, unknown>
    : {};
  return {
    subscription: {
      enabled: typeof sub.enabled === "boolean" ? sub.enabled : true,
      encryptedValue: sub.encryptedValue ?? null,
      lastTestedAt: typeof sub.lastTestedAt === "string" ? sub.lastTestedAt : null,
      lastTestError: typeof sub.lastTestError === "string" ? sub.lastTestError : null,
      importedFromEnv: typeof sub.importedFromEnv === "boolean" ? sub.importedFromEnv : undefined,
    },
    apiKey: {
      enabled: typeof api.enabled === "boolean" ? api.enabled : true,
      encryptedValue: api.encryptedValue ?? null,
      lastTestedAt: typeof api.lastTestedAt === "string" ? api.lastTestedAt : null,
      lastTestError: typeof api.lastTestError === "string" ? api.lastTestError : null,
    },
    lastFallbackAt: typeof r.lastFallbackAt === "string" ? r.lastFallbackAt : null,
  };
}

function decryptSource(source: StoredCredentialSource): string | null {
  if (!source.encryptedValue) return null;
  if (!isEncryptedValue(source.encryptedValue)) return null;
  try {
    return decryptCredential(source.encryptedValue);
  } catch {
    return null;
  }
}

function toPublicSource(
  source: StoredCredentialSource,
): InstanceClaudeCredentials["subscription"] {
  const plaintext = decryptSource(source);
  const configured = plaintext !== null && plaintext.length > 0;
  return {
    configured,
    enabled: source.enabled,
    maskedValue: configured ? maskCredential(plaintext!) : null,
    status: !configured ? "unconfigured" : source.lastTestError ? "error" : "configured",
    lastTestedAt: source.lastTestedAt,
    lastTestError: source.lastTestError,
    importedFromEnv: source.importedFromEnv,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export function instanceCredentialsService(db: Db) {
  async function getOrCreateRow() {
    const existing = await db
      .select()
      .from(instanceSettings)
      .where(eq(instanceSettings.singletonKey, DEFAULT_SINGLETON_KEY))
      .then((rows) => rows[0] ?? null);
    if (existing) return existing;

    const now = new Date();
    const [created] = await db
      .insert(instanceSettings)
      .values({
        singletonKey: DEFAULT_SINGLETON_KEY,
        general: {},
        experimental: {},
        credentials: {},
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [instanceSettings.singletonKey],
        set: { updatedAt: now },
      })
      .returning();
    return created;
  }

  async function getStored(): Promise<StoredCredentials> {
    const row = await getOrCreateRow();
    return normalizeStoredCredentials(row.credentials);
  }

  async function saveStored(stored: StoredCredentials): Promise<void> {
    const row = await getOrCreateRow();
    await db
      .update(instanceSettings)
      .set({ credentials: stored as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(instanceSettings.id, row.id));
  }

  return {
    /** Get public (masked) credential state for API responses */
    get: async (): Promise<InstanceClaudeCredentials> => {
      const stored = await getStored();
      return {
        subscription: toPublicSource(stored.subscription),
        apiKey: toPublicSource(stored.apiKey),
        lastFallbackAt: stored.lastFallbackAt,
      };
    },

    /** Get plaintext credentials for runtime use — never expose to clients */
    getForRuntime: async (): Promise<InstanceClaudeCredentialsRuntime> => {
      const stored = await getStored();
      return {
        subscriptionToken: decryptSource(stored.subscription),
        subscriptionEnabled: stored.subscription.enabled,
        apiKey: decryptSource(stored.apiKey),
        apiKeyEnabled: stored.apiKey.enabled,
      };
    },

    updateSubscription: async (
      patch: PatchInstanceClaudeSubscription,
    ): Promise<InstanceClaudeCredentials> => {
      const stored = await getStored();
      const sub = { ...stored.subscription };
      if (patch.enabled !== undefined) sub.enabled = patch.enabled;
      if ("token" in patch) {
        if (patch.token === null || patch.token === "") {
          sub.encryptedValue = null;
          sub.importedFromEnv = undefined;
        } else if (patch.token) {
          sub.encryptedValue = encryptCredential(patch.token);
          sub.importedFromEnv = undefined;
          // Clear test error on re-config
          sub.lastTestError = null;
        }
      }
      await saveStored({ ...stored, subscription: sub });
      return {
        subscription: toPublicSource(sub),
        apiKey: toPublicSource(stored.apiKey),
        lastFallbackAt: stored.lastFallbackAt,
      };
    },

    updateApiKey: async (
      patch: PatchInstanceClaudeApiKey,
    ): Promise<InstanceClaudeCredentials> => {
      const stored = await getStored();
      const api = { ...stored.apiKey };
      if (patch.enabled !== undefined) api.enabled = patch.enabled;
      if ("key" in patch) {
        if (patch.key === null || patch.key === "") {
          api.encryptedValue = null;
        } else if (patch.key) {
          api.encryptedValue = encryptCredential(patch.key);
          api.lastTestError = null;
        }
      }
      await saveStored({ ...stored, apiKey: api });
      return {
        subscription: toPublicSource(stored.subscription),
        apiKey: toPublicSource(api),
        lastFallbackAt: stored.lastFallbackAt,
      };
    },

    updateTestResult: async (
      source: "subscription" | "apiKey",
      result: { success: boolean; error: string | null },
    ): Promise<void> => {
      const stored = await getStored();
      const now = new Date().toISOString();
      if (source === "subscription") {
        stored.subscription = {
          ...stored.subscription,
          lastTestedAt: now,
          lastTestError: result.success ? null : result.error,
        };
      } else {
        stored.apiKey = {
          ...stored.apiKey,
          lastTestedAt: now,
          lastTestError: result.success ? null : result.error,
        };
      }
      await saveStored(stored);
    },

    /**
     * Auto-import CLAUDE_CODE_OAUTH_TOKEN from env if no subscription token is saved.
     * Returns true if an import happened (caller should prompt admin to confirm/save).
     */
    maybeImportFromEnv: async (): Promise<{ imported: boolean; token: string | null }> => {
      const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
      if (!envToken || !envToken.trim()) return { imported: false, token: null };
      const stored = await getStored();
      if (stored.subscription.encryptedValue) return { imported: false, token: null };
      return { imported: true, token: envToken.trim() };
    },

    /** Record that a subscription→API key fallback occurred */
    recordFallback: async (): Promise<void> => {
      const stored = await getStored();
      await saveStored({ ...stored, lastFallbackAt: new Date().toISOString() });
    },

    /** True if a fallback occurred within the active window */
    isFallbackActive: async (): Promise<boolean> => {
      const stored = await getStored();
      if (!stored.lastFallbackAt) return false;
      const age = Date.now() - new Date(stored.lastFallbackAt).getTime();
      return age < FALLBACK_ACTIVE_WINDOW_MS;
    },
  };
}
