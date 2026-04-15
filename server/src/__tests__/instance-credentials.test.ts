import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instanceCredentialsService } from "../services/instance-credentials.js";

// ─── DB mock helpers ──────────────────────────────────────────────────────────

/**
 * Build a chainable Drizzle-like mock.
 *
 * getOrCreateRow() does:
 *   db.select().from().where().then(rows => rows[0] ?? null)
 *
 * We model the chain as a thenable so `.then()` is called on the chain itself.
 */
function makeSelectChain(resolvedRows: unknown[]) {
  const chain: Record<string, unknown> = {};
  // Make it a thenable so `.then()` works inline
  const promise = Promise.resolve(resolvedRows);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(Object.assign(promise, chain));
  return chain;
}

function makeDb(options: {
  /** Rows returned by the initial SELECT (getOrCreateRow) */
  selectRows?: unknown[];
  /** Row returned by insert().returning() — used when selectRows is empty */
  insertedRow?: unknown;
} = {}) {
  const { selectRows = [], insertedRow = null } = options;

  const selectChain = makeSelectChain(selectRows);

  const returningMock = vi.fn().mockResolvedValue(insertedRow ? [insertedRow] : []);
  const onConflictMock = vi.fn().mockReturnValue({ returning: returningMock });
  const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictMock });

  const updateWhere = vi.fn().mockResolvedValue([]);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

  return {
    db: {
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockReturnValue({ values: valuesMock }),
      update: vi.fn().mockReturnValue({ set: updateSet }),
    },
    mocks: { returningMock, valuesMock, updateSet, updateWhere },
  };
}

/** A minimal DB row with empty credentials (no tokens stored). */
function emptyRow() {
  return {
    id: "row-1",
    singletonKey: "default",
    credentials: {},
    general: {},
    experimental: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("instanceCredentialsService", () => {
  // Save / restore env
  let originalEnvToken: string | undefined;

  beforeEach(() => {
    originalEnvToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  afterEach(() => {
    if (originalEnvToken === undefined) {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    } else {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = originalEnvToken;
    }
  });

  // ── get() ──────────────────────────────────────────────────────────────────

  describe("get()", () => {
    it("returns unconfigured status when no credentials are stored", async () => {
      const { db } = makeDb({ selectRows: [emptyRow()] });
      const svc = instanceCredentialsService(db as any);

      const result = await svc.get();

      expect(result.subscription.configured).toBe(false);
      expect(result.subscription.status).toBe("unconfigured");
      expect(result.subscription.maskedValue).toBeNull();
      expect(result.apiKey.configured).toBe(false);
      expect(result.apiKey.status).toBe("unconfigured");
      expect(result.apiKey.maskedValue).toBeNull();
      expect(result.lastFallbackAt).toBeNull();
    });
  });

  // ── maybeImportFromEnv() ───────────────────────────────────────────────────

  describe("maybeImportFromEnv()", () => {
    it("returns { imported: false, token: null } when env var is not set", async () => {
      const { db } = makeDb({ selectRows: [emptyRow()] });
      const svc = instanceCredentialsService(db as any);

      const result = await svc.maybeImportFromEnv();

      expect(result).toEqual({ imported: false, token: null });
    });

    it("returns { imported: false, token: null } when env var is an empty string", async () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "   ";
      const { db } = makeDb({ selectRows: [emptyRow()] });
      const svc = instanceCredentialsService(db as any);

      const result = await svc.maybeImportFromEnv();

      expect(result).toEqual({ imported: false, token: null });
    });

    it("returns { imported: true, token } when env var is set and no subscription token saved", async () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-oauth-token-123";
      const { db } = makeDb({ selectRows: [emptyRow()] });
      const svc = instanceCredentialsService(db as any);

      const result = await svc.maybeImportFromEnv();

      expect(result).toEqual({ imported: true, token: "test-oauth-token-123" });
    });

    it("trims the env var token before returning it", async () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "  trimmed-token  ";
      const { db } = makeDb({ selectRows: [emptyRow()] });
      const svc = instanceCredentialsService(db as any);

      const result = await svc.maybeImportFromEnv();

      expect(result).toEqual({ imported: true, token: "trimmed-token" });
    });

    it("returns { imported: false } when env var is set but subscription already exists", async () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-oauth-token-123";
      // Row with a non-null encryptedValue — using a fake object; isEncryptedValue()
      // checks for scheme === "instance_v1" so we set that to prevent decrypt attempts.
      const rowWithToken = {
        ...emptyRow(),
        credentials: {
          subscription: {
            enabled: true,
            encryptedValue: { scheme: "instance_v1", iv: "aaa", tag: "bbb", ciphertext: "ccc" },
            lastTestedAt: null,
            lastTestError: null,
          },
          apiKey: { enabled: true, encryptedValue: null, lastTestedAt: null, lastTestError: null },
          lastFallbackAt: null,
        },
      };
      const { db } = makeDb({ selectRows: [rowWithToken] });
      const svc = instanceCredentialsService(db as any);

      const result = await svc.maybeImportFromEnv();

      expect(result).toEqual({ imported: false, token: null });
    });
  });

  // ── isFallbackActive() ─────────────────────────────────────────────────────

  describe("isFallbackActive()", () => {
    it("returns false when lastFallbackAt is null", async () => {
      const { db } = makeDb({ selectRows: [emptyRow()] });
      const svc = instanceCredentialsService(db as any);

      expect(await svc.isFallbackActive()).toBe(false);
    });

    it("returns true when lastFallbackAt is recent (within 24 h)", async () => {
      const recentTimestamp = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
      const row = {
        ...emptyRow(),
        credentials: { lastFallbackAt: recentTimestamp },
      };
      const { db } = makeDb({ selectRows: [row] });
      const svc = instanceCredentialsService(db as any);

      expect(await svc.isFallbackActive()).toBe(true);
    });

    it("returns false when lastFallbackAt is older than 24 h", async () => {
      const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 h ago
      const row = {
        ...emptyRow(),
        credentials: { lastFallbackAt: oldTimestamp },
      };
      const { db } = makeDb({ selectRows: [row] });
      const svc = instanceCredentialsService(db as any);

      expect(await svc.isFallbackActive()).toBe(false);
    });

    it("returns false when lastFallbackAt is exactly at the boundary (24 h ago)", async () => {
      const boundaryTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1).toISOString();
      const row = {
        ...emptyRow(),
        credentials: { lastFallbackAt: boundaryTimestamp },
      };
      const { db } = makeDb({ selectRows: [row] });
      const svc = instanceCredentialsService(db as any);

      expect(await svc.isFallbackActive()).toBe(false);
    });
  });
});
