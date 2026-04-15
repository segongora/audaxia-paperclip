# Instance-Level Dual Claude Authentication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the instance-level dual Claude authentication feature, which allows Paperclip admins to configure a Subscription (OAuth Token) and an API Key, with automatic fallback to the API key when subscription credits are exhausted.

**Architecture:** The core fallback logic lives in `packages/adapters/claude-local/src/server/execute.ts` — when both credentials are configured, the server injects `_instanceClaudeApiKey` into the adapter config and the adapter retries with `ANTHROPIC_API_KEY` set if the subscription returns a credit-exhaustion error. The `heartbeat.ts` service handles the post-run side effect of recording the fallback and emitting a live event, which `LiveUpdatesProvider.tsx` turns into an in-app toast. The admin UI (`InstanceClaudeCredentials.tsx`) manages credential configuration via a fully implemented API route layer.

**Tech Stack:** TypeScript, React 19, Vitest 3, Express.js, Drizzle ORM (PostgreSQL), TanStack Query v5, Tailwind CSS 4

---

## Pre-Existing Work (Do Not Re-Implement)

The following is **already implemented** and must not be recreated:

| Layer | File | Status |
|---|---|---|
| Shared types & validators | `packages/shared/src/types/instance.ts`, `packages/shared/src/validators/instance.ts` | Complete |
| DB migration | `packages/db/src/migrations/0046_claude_credentials.sql` | Complete |
| Encryption helpers | `server/src/services/instance-crypto.ts` | Complete |
| Credential service | `server/src/services/instance-credentials.ts` | Complete |
| API routes | `server/src/routes/instance-settings.ts` | Complete |
| Test Connection | `server/src/routes/instance-credential-test.ts` | Complete |
| Heartbeat injection + fallback recording | `server/src/services/heartbeat.ts:3221–3233`, `:3709–3724` | Complete |
| Subscription exhaustion detection | `packages/adapters/claude-local/src/server/parse.ts` `isClaudeSubscriptionExhausted` | Complete |
| Dual-auth fallback logic | `packages/adapters/claude-local/src/server/execute.ts:614–653` | Complete |
| Admin UI page | `ui/src/pages/InstanceClaudeCredentials.tsx` | Complete |
| API client | `ui/src/api/instanceSettings.ts` | Complete |
| Route + sidebar nav | `ui/src/App.tsx:332`, `ui/src/components/InstanceSidebar.tsx:28` | Complete |
| Path normalization | `ui/src/lib/instance-settings.ts` | Complete |
| Live event → toast | `ui/src/context/LiveUpdatesProvider.tsx:788–799` | **Partially complete — FR-4 bug** |

---

## Remaining Work

### Gap 1 — FR-4 Bug: Fallback toast auto-dismisses instead of persisting

**PRD FR-4:** *"The toast must persist until dismissed (not auto-hide)."*

**Current bug:** `LiveUpdatesProvider.tsx:797` passes `ttlMs: 12000`, causing the toast to auto-dismiss after 12 seconds. `ToastContext.tsx` clamps all TTLs to `[1500ms, 15000ms]` — there is no "persist forever" support.

**Fix:** Add `ttlMs: 0` (zero) as a sentinel meaning "never auto-dismiss". The `normalizeTtl` function must return `Infinity` (or skip the timer) when `ttlMs` is exactly `0`. The `LiveUpdatesProvider` must then pass `ttlMs: 0` for the credential fallback toast.

---

### Task 1: Make ToastContext Support Persistent Toasts

**Files:**
- Modify: `ui/src/context/ToastContext.tsx`
- Test: `ui/src/context/ToastContext.test.tsx` (existing file)

**Step 1: Read the test file to understand the pattern**

Open `ui/src/context/ToastContext.test.tsx` and read to the end. Note that tests use `createRoot` + `act()` (no testing-library). Match this style exactly.

**Step 2: Write the failing test**

Add this test to `ui/src/context/ToastContext.test.tsx` (after the existing `it` blocks, inside the `describe`):

```typescript
it("does not auto-dismiss a toast with ttlMs: 0 (persistent)", async () => {
  vi.useFakeTimers();
  const root = createRoot(container);
  let pushToastRef: ((input: ToastInput) => string | null) | null = null;
  let stateRef: ToastItem[] = [];

  function Consumer() {
    const { pushToast } = useToastActions();
    const toasts = useToastState();
    pushToastRef = pushToast;
    stateRef = toasts;
    return null;
  }

  act(() => {
    root.render(
      <ToastProvider>
        <Consumer />
      </ToastProvider>,
    );
  });

  act(() => {
    pushToastRef!({ title: "Persistent toast", ttlMs: 0 });
  });

  expect(stateRef).toHaveLength(1);

  // Advance time way past any reasonable TTL — toast should still be visible
  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });

  expect(stateRef).toHaveLength(1);
  vi.useRealTimers();
});
```

Note: you'll need to import `ToastInput` and `ToastItem` if not already imported.

**Step 3: Run the test to verify it fails**

```bash
pnpm vitest run ui/src/context/ToastContext.test.tsx
```
Expected: FAIL — the toast is auto-dismissed after the clamped max TTL.

**Step 4: Implement the fix in ToastContext.tsx**

In `ui/src/context/ToastContext.tsx`:

1. Add a `persistent` boolean to `ToastInput` and `ToastItem`:
```typescript
export interface ToastInput {
  // ... existing fields ...
  ttlMs?: number; // 0 = persist until manually dismissed
}

export interface ToastItem {
  // ... existing fields ...
  persistent: boolean;
}
```

2. Update `normalizeTtl` to handle `ttlMs: 0`:
```typescript
function normalizeTtl(value: number | undefined, tone: ToastTone): { ttlMs: number; persistent: boolean } {
  if (value === 0) return { ttlMs: 0, persistent: true };
  const fallback = DEFAULT_TTL_BY_TONE[tone];
  if (typeof value !== "number" || !Number.isFinite(value)) return { ttlMs: fallback, persistent: false };
  return { ttlMs: Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, Math.floor(value))), persistent: false };
}
```

3. In `pushToast`, use the new shape:
```typescript
const { ttlMs, persistent } = normalizeTtl(input.ttlMs, tone);
// ...
const nextToast: ToastItem = {
  id,
  title: input.title,
  body: input.body,
  tone,
  ttlMs,
  persistent,
  action: input.action,
  createdAt: now,
};
// Only set timeout when not persistent
if (!persistent) {
  const timeout = window.setTimeout(() => {
    dismissToast(id);
  }, ttlMs);
  timersRef.current.set(id, timeout);
}
return id;
```

**Step 5: Run the test to verify it passes**

```bash
pnpm vitest run ui/src/context/ToastContext.test.tsx
```
Expected: All tests PASS.

**Step 6: Commit**

```bash
git add ui/src/context/ToastContext.tsx ui/src/context/ToastContext.test.tsx
git commit -m "feat: support persistent toasts (ttlMs: 0) in ToastContext"
```

---

### Task 2: Fix the Fallback Toast to Be Persistent

**Files:**
- Modify: `ui/src/context/LiveUpdatesProvider.tsx`

**Step 1: Update the credential fallback toast**

In `ui/src/context/LiveUpdatesProvider.tsx`, find the block at line ~791–798:

```typescript
gatedPushToast(gate, pushToast, "claude-fallback", {
  id: "claude-credential-fallback",
  dedupeKey: "claude-credential-fallback",
  title: "Subscription credits exhausted",
  body: "Claude requests are now using your API key.",
  tone: "warn",
  ttlMs: 12000,
});
```

Change `ttlMs: 12000` to `ttlMs: 0`:

```typescript
gatedPushToast(gate, pushToast, "claude-fallback", {
  id: "claude-credential-fallback",
  dedupeKey: "claude-credential-fallback",
  title: "Subscription credits exhausted",
  body: "Claude requests are now using your API key.",
  tone: "warn",
  ttlMs: 0,
});
```

**Step 2: Run all UI tests to check for regressions**

```bash
pnpm vitest run ui/
```
Expected: All tests PASS (including the ToastContext test added in Task 1).

**Step 3: Commit**

```bash
git add ui/src/context/LiveUpdatesProvider.tsx
git commit -m "fix: make credential fallback toast persistent until dismissed (FR-4)"
```

---

### Task 3: Test `isClaudeSubscriptionExhausted` in parse.ts

**Files:**
- Create: `packages/adapters/claude-local/src/server/parse.test.ts`

**Step 1: Write failing tests**

Create `packages/adapters/claude-local/src/server/parse.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isClaudeSubscriptionExhausted } from "./parse.js";

describe("isClaudeSubscriptionExhausted", () => {
  it("returns false when parsed is null", () => {
    expect(isClaudeSubscriptionExhausted(null)).toBe(false);
  });

  it("returns false when is_error is false", () => {
    expect(isClaudeSubscriptionExhausted({ is_error: false, result: "You've hit your limit" })).toBe(false);
  });

  it("returns false when is_error is true but result does not mention limit", () => {
    expect(isClaudeSubscriptionExhausted({ is_error: true, result: "Some other error" })).toBe(false);
  });

  it("returns false when is_error is true and result is empty", () => {
    expect(isClaudeSubscriptionExhausted({ is_error: true, result: "" })).toBe(false);
  });

  it("returns true when is_error: true and result contains \"You've hit your limit\"", () => {
    expect(
      isClaudeSubscriptionExhausted({ is_error: true, result: "You've hit your limit · resets 10pm (UTC)" }),
    ).toBe(true);
  });

  it("returns true for the alternate phrasing \"you have hit your limit\"", () => {
    expect(
      isClaudeSubscriptionExhausted({ is_error: true, result: "you have hit your limit on usage" }),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(
      isClaudeSubscriptionExhausted({ is_error: true, result: "YOU'VE HIT YOUR LIMIT" }),
    ).toBe(true);
  });

  it("returns false when result is missing", () => {
    expect(isClaudeSubscriptionExhausted({ is_error: true })).toBe(false);
  });
});
```

**Step 2: Check the vitest config to confirm where to run**

Look at `packages/adapters/claude-local/` — if no `vitest.config.ts` exists, tests in this package are picked up by the root workspace config. Verify with:

```bash
pnpm vitest run packages/adapters/claude-local/src/server/parse.test.ts
```

Expected: All tests PASS (the function is already implemented; we're testing existing code).

**Step 3: Commit**

```bash
git add packages/adapters/claude-local/src/server/parse.test.ts
git commit -m "test: add unit tests for isClaudeSubscriptionExhausted"
```

---

### Task 4: Test the Dual-Auth Fallback in execute.ts

**Files:**
- Modify: `server/src/__tests__/claude-local-execute.test.ts` (existing file)

**Context:** The test file in `server/src/__tests__/` already has test infrastructure that writes fake Node.js "claude" scripts and runs them via `execute()`. Follow the exact same pattern.

**Step 1: Read the existing test file fully**

Read `server/src/__tests__/claude-local-execute.test.ts` to understand:
- How `setupExecuteEnv` works
- The `CapturePayload` shape
- How `writeFakeClaudeCommand` and `writeRetryThenSucceedClaudeCommand` are structured

**Step 2: Write a fake claude script that simulates subscription exhaustion then succeeds**

Add a new helper function `writeSubscriptionExhaustedThenApiKeySuccessCommand` at the top of the test file (near the other helper functions):

```typescript
/**
 * First invocation outputs a subscription-exhausted error.
 * Second invocation (with ANTHROPIC_API_KEY set) succeeds.
 * Writes capture payloads as a JSON array indexed by call count.
 */
async function writeSubscriptionExhaustedThenApiKeySuccessCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH;
const payload = {
  argv: process.argv.slice(2),
  prompt: fs.readFileSync(0, "utf8"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
};

const entries = capturePath && fs.existsSync(capturePath)
  ? JSON.parse(fs.readFileSync(capturePath, "utf8"))
  : [];
entries.push(payload);
if (capturePath) fs.writeFileSync(capturePath, JSON.stringify(entries), "utf8");

const isSecondCall = entries.length > 1;

if (!isSecondCall) {
  // First call: subscription exhausted
  console.log(JSON.stringify({
    type: "result",
    subtype: "error",
    is_error: true,
    session_id: null,
    result: "You've hit your limit · resets 10pm (UTC)",
    errors: [],
  }));
  process.exit(1);
} else {
  // Second call: API key path succeeds
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "api-key-session", model: "claude-sonnet" }));
  console.log(JSON.stringify({ type: "result", session_id: "api-key-session", result: "done", usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 } }));
}
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}
```

**Step 3: Add the test cases**

Add a new `describe` block inside the existing describe (or at the top level, matching the file's style):

```typescript
describe("dual-auth API key fallback", () => {
  it("retries with ANTHROPIC_API_KEY and sets credentialFallbackOccurred when subscription is exhausted", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-dual-auth-"));
    const capturePath = path.join(root, "capture.json");

    const commandPath = path.join(root, "bin", "claude");
    await fs.mkdir(path.join(root, "bin"), { recursive: true });
    await writeSubscriptionExhaustedThenApiKeySuccessCommand(commandPath);

    const ctx = await setupExecuteEnv(root, {
      commandWriter: async (p) => {
        // commandWriter already called above — no-op; the env was set up externally
      },
    });

    // Actually, match the pattern: let setupExecuteEnv do its thing but override the command
    // (check how setupExecuteEnv works and adapt accordingly — do NOT guess this)

    // Inject the dual-auth config key
    const result = await execute({
      runId: "test-run-dual-auth",
      agent: ctx.agent,
      runtime: ctx.runtime,
      config: {
        command: commandPath,
        cwd: ctx.cwd,
        _instanceClaudeApiKey: "sk-ant-test-api-key",
        env: { PAPERCLIP_TEST_CAPTURE_PATH: capturePath },
      },
      context: {},
      onLog: async () => {},
      onMeta: async () => {},
      onSpawn: async () => {},
    });

    expect(result.credentialFallbackOccurred).toBe(true);
    expect(result.billingType).toBe("api");
    expect(result.errorMessage).toBeNull();

    const captures = JSON.parse(await fs.readFile(capturePath, "utf8"));
    expect(captures).toHaveLength(2);
    // First call had no API key
    expect(captures[0].anthropicApiKey).toBeNull();
    // Second call had the API key injected
    expect(captures[1].anthropicApiKey).toBe("sk-ant-test-api-key");
  });

  it("does NOT fall back when _instanceClaudeApiKey is absent", async () => {
    // A standard subscription-exhausted scenario with no dual-auth config
    // should NOT retry and should return the error as-is
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-claude-dual-auth-nokey-"));
    const capturePath = path.join(root, "capture.json");

    // Write a command that always outputs subscription exhausted
    const commandPath = path.join(root, "bin", "claude");
    await fs.mkdir(path.join(root, "bin"), { recursive: true });
    const script = `#!/usr/bin/env node
const fs = require("node:fs");
const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH;
const entries = capturePath && fs.existsSync(capturePath) ? JSON.parse(fs.readFileSync(capturePath, "utf8")) : [];
entries.push({ call: entries.length + 1 });
if (capturePath) fs.writeFileSync(capturePath, JSON.stringify(entries), "utf8");
console.log(JSON.stringify({ type: "result", subtype: "error", is_error: true, session_id: null, result: "You've hit your limit · resets 10pm (UTC)", errors: [] }));
process.exit(1);
`;
    await fs.writeFile(commandPath, script, "utf8");
    await fs.chmod(commandPath, 0o755);

    const ctx = await setupExecuteEnv(root);

    const result = await execute({
      runId: "test-run-no-fallback",
      agent: ctx.agent,
      runtime: ctx.runtime,
      config: {
        command: commandPath,
        cwd: ctx.cwd,
        // No _instanceClaudeApiKey
        env: { PAPERCLIP_TEST_CAPTURE_PATH: capturePath },
      },
      context: {},
      onLog: async () => {},
      onMeta: async () => {},
      onSpawn: async () => {},
    });

    expect(result.credentialFallbackOccurred).toBeUndefined();
    // Only one attempt was made
    const captures = JSON.parse(await fs.readFile(capturePath, "utf8"));
    expect(captures).toHaveLength(1);
  });
});
```

**Important:** Before adding these tests, read `setupExecuteEnv` in the existing test file carefully to understand what `ctx.agent`, `ctx.runtime`, and `ctx.cwd` look like. Adapt the test calls to match exactly — do not guess the shape.

**Step 4: Run the tests**

```bash
pnpm vitest run server/src/__tests__/claude-local-execute.test.ts
```
Expected: New tests PASS along with all existing tests.

**Step 5: Commit**

```bash
git add server/src/__tests__/claude-local-execute.test.ts
git commit -m "test: add dual-auth API key fallback tests for claude-local execute"
```

---

### Task 5: Test Claude Credential Routes

**Files:**
- Modify: `server/src/__tests__/instance-settings-routes.test.ts` (existing file)

**Context:** The existing test file mocks `instanceSettingsService` and `logActivity` but does NOT mock `instanceCredentialsService`. The credential routes require `instanceCredentialsService`. You'll need to add a mock for it.

**Step 1: Read the full existing test file**

Read `server/src/__tests__/instance-settings-routes.test.ts` to understand the full mock setup before modifying it.

**Step 2: Add mock for instanceCredentialsService**

Extend the existing mocks at the top of the file to also mock `instanceCredentialsService`. Add alongside the existing mock declarations:

```typescript
const mockInstanceCredentialsService = vi.hoisted(() => ({
  get: vi.fn(),
  getForRuntime: vi.fn(),
  updateSubscription: vi.fn(),
  updateApiKey: vi.fn(),
  updateTestResult: vi.fn(),
  maybeImportFromEnv: vi.fn(),
  recordFallback: vi.fn(),
  isFallbackActive: vi.fn(),
}));
```

Update the `vi.mock` call to also include `instanceCredentialsService`:

```typescript
vi.mock("../services/index.js", () => ({
  instanceSettingsService: () => mockInstanceSettingsService,
  instanceCredentialsService: () => mockInstanceCredentialsService,
  logActivity: mockLogActivity,
}));
```

Do the same in `vi.doMock` inside `registerModuleMocks()`.

In `beforeEach`, add resets and default return values for the credential mock:

```typescript
mockInstanceCredentialsService.get.mockResolvedValue({
  subscription: {
    configured: false,
    enabled: true,
    maskedValue: null,
    status: "unconfigured",
    lastTestedAt: null,
    lastTestError: null,
  },
  apiKey: {
    configured: false,
    enabled: true,
    maskedValue: null,
    status: "unconfigured",
    lastTestedAt: null,
    lastTestError: null,
  },
  lastFallbackAt: null,
});
mockInstanceCredentialsService.maybeImportFromEnv.mockResolvedValue({ imported: false, token: null });
mockInstanceCredentialsService.updateSubscription.mockResolvedValue({
  subscription: { configured: true, enabled: true, maskedValue: "sk-ant-...XXXX", status: "configured", lastTestedAt: null, lastTestError: null },
  apiKey: { configured: false, enabled: true, maskedValue: null, status: "unconfigured", lastTestedAt: null, lastTestError: null },
  lastFallbackAt: null,
});
mockInstanceCredentialsService.updateApiKey.mockResolvedValue({
  subscription: { configured: false, enabled: true, maskedValue: null, status: "unconfigured", lastTestedAt: null, lastTestError: null },
  apiKey: { configured: true, enabled: true, maskedValue: "sk-ant-...XXXX", status: "configured", lastTestedAt: null, lastTestError: null },
  lastFallbackAt: null,
});
mockInstanceCredentialsService.getForRuntime.mockResolvedValue({
  subscriptionToken: null,
  subscriptionEnabled: true,
  apiKey: null,
  apiKeyEnabled: true,
});
```

Also add a mock for `svc.get()` that the credential patch routes use (the existing routes call `svc.get()` which is `instanceSettingsService.get`). Check `instance-settings.ts` to see if there's a `get()` method or if it uses a different method name. If needed, add `get: vi.fn()` to `mockInstanceSettingsService` and set a return value.

**Step 3: Add the credential route tests**

Add a new `describe("claude credentials routes")` block:

```typescript
describe("claude credentials routes", () => {
  const adminActor = {
    type: "board",
    userId: "admin-1",
    source: "local_implicit",
    isInstanceAdmin: true,
  };
  const nonAdminActor = {
    type: "board",
    userId: "user-1",
    source: "session",
    isInstanceAdmin: false,
    companyIds: ["company-1"],
  };

  it("GET /claude-credentials returns masked credentials for instance admins", async () => {
    const app = await createApp(adminActor);
    const res = await request(app).get("/api/instance/settings/claude-credentials");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      subscription: { configured: false, status: "unconfigured" },
      apiKey: { configured: false, status: "unconfigured" },
    });
  });

  it("GET /claude-credentials is rejected for non-admin board users", async () => {
    const app = await createApp(nonAdminActor);
    const res = await request(app).get("/api/instance/settings/claude-credentials");
    expect(res.status).toBe(403);
  });

  it("PATCH /claude-credentials/subscription saves token and logs activity", async () => {
    mockInstanceSettingsService.get = vi.fn().mockResolvedValue({ id: "settings-1" });
    const app = await createApp(adminActor);
    const res = await request(app)
      .patch("/api/instance/settings/claude-credentials/subscription")
      .send({ token: "some-oauth-token" });
    expect(res.status).toBe(200);
    expect(mockInstanceCredentialsService.updateSubscription).toHaveBeenCalledWith({ token: "some-oauth-token" });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "instance.settings.claude_subscription_updated" }),
    );
  });

  it("PATCH /claude-credentials/api-key saves key and logs activity", async () => {
    mockInstanceSettingsService.get = vi.fn().mockResolvedValue({ id: "settings-1" });
    const app = await createApp(adminActor);
    const res = await request(app)
      .patch("/api/instance/settings/claude-credentials/api-key")
      .send({ key: "sk-ant-test123" });
    expect(res.status).toBe(200);
    expect(mockInstanceCredentialsService.updateApiKey).toHaveBeenCalledWith({ key: "sk-ant-test123" });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "instance.settings.claude_api_key_updated" }),
    );
  });

  it("PATCH /claude-credentials/subscription/test returns 400 when no token is configured", async () => {
    // getForRuntime returns null token (default mock)
    const app = await createApp(adminActor);
    const res = await request(app).post("/api/instance/settings/claude-credentials/subscription/test");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
  });

  it("PATCH /claude-credentials/api-key/test returns 400 when no key is configured", async () => {
    const app = await createApp(adminActor);
    const res = await request(app).post("/api/instance/settings/claude-credentials/api-key/test");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
  });
});
```

**Step 4: Run the tests**

```bash
pnpm vitest run server/src/__tests__/instance-settings-routes.test.ts
```
Expected: All tests PASS (existing + new).

**Step 5: Commit**

```bash
git add server/src/__tests__/instance-settings-routes.test.ts
git commit -m "test: add Claude credential route tests to instance-settings-routes"
```

---

### Task 6: Test the instance-credentials Service

**Files:**
- Create: `server/src/__tests__/instance-credentials.test.ts`

**Context:** The `instanceCredentialsService` in `server/src/services/instance-credentials.ts` uses a Drizzle `Db` instance. You'll need to mock the DB. Look at how other service tests in `server/src/__tests__/` mock Drizzle — check a file like `costs-service.test.ts` for the pattern.

**Step 1: Read the costs-service.test.ts (or similar) test for the DB mock pattern**

Open `server/src/__tests__/costs-service.test.ts` and identify how they mock the Drizzle DB.

**Step 2: Write the failing tests**

Create `server/src/__tests__/instance-credentials.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { instanceCredentialsService } from "../services/instance-credentials.js";

// ─── DB mock ─────────────────────────────────────────────────────────────────
// Pattern: mock the drizzle query chain using a builder pattern
// Adapt to match the pattern you find in the existing service tests.

function makeMockDb(storedCredentials: Record<string, unknown> = {}) {
  const row = {
    id: "instance-settings-1",
    singletonKey: "default",
    credentials: storedCredentials,
    general: {},
    experimental: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue(
          Promise.resolve([row]),
        ),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([row]),
        }),
      }),
    }),
  };
  return { db, row };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("instanceCredentialsService", () => {
  describe("get()", () => {
    it("returns unconfigured status when no credentials are stored", async () => {
      const { db } = makeMockDb({});
      const svc = instanceCredentialsService(db as any);
      const result = await svc.get();
      expect(result.subscription.configured).toBe(false);
      expect(result.subscription.status).toBe("unconfigured");
      expect(result.apiKey.configured).toBe(false);
      expect(result.apiKey.status).toBe("unconfigured");
      expect(result.lastFallbackAt).toBeNull();
    });
  });

  describe("maybeImportFromEnv()", () => {
    beforeEach(() => {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    });

    it("returns { imported: false } when env var is not set", async () => {
      const { db } = makeMockDb({});
      const svc = instanceCredentialsService(db as any);
      const result = await svc.maybeImportFromEnv();
      expect(result.imported).toBe(false);
      expect(result.token).toBeNull();
    });

    it("returns { imported: true, token } when env var is set and no subscription is saved", async () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-oauth-token";
      const { db } = makeMockDb({});
      const svc = instanceCredentialsService(db as any);
      const result = await svc.maybeImportFromEnv();
      expect(result.imported).toBe(true);
      expect(result.token).toBe("test-oauth-token");
    });

    it("returns { imported: false } when subscription token already exists in DB", async () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-oauth-token";
      // Simulate already having an encrypted value
      const { db } = makeMockDb({
        subscription: {
          enabled: true,
          encryptedValue: { scheme: "instance_v1", iv: "abc", tag: "def", ciphertext: "ghi" },
          lastTestedAt: null,
          lastTestError: null,
        },
        apiKey: { enabled: true, encryptedValue: null, lastTestedAt: null, lastTestError: null },
        lastFallbackAt: null,
      });
      const svc = instanceCredentialsService(db as any);
      const result = await svc.maybeImportFromEnv();
      expect(result.imported).toBe(false);
    });
  });

  describe("isFallbackActive()", () => {
    it("returns false when lastFallbackAt is null", async () => {
      const { db } = makeMockDb({ lastFallbackAt: null });
      const svc = instanceCredentialsService(db as any);
      expect(await svc.isFallbackActive()).toBe(false);
    });

    it("returns true when lastFallbackAt is recent (within 24h)", async () => {
      const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 minutes ago
      const { db } = makeMockDb({ lastFallbackAt: recentTime });
      const svc = instanceCredentialsService(db as any);
      expect(await svc.isFallbackActive()).toBe(true);
    });

    it("returns false when lastFallbackAt is older than 24h", async () => {
      const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
      const { db } = makeMockDb({ lastFallbackAt: oldTime });
      const svc = instanceCredentialsService(db as any);
      expect(await svc.isFallbackActive()).toBe(false);
    });
  });
});
```

**Step 3: Run the tests**

```bash
pnpm vitest run server/src/__tests__/instance-credentials.test.ts
```

Expected: Tests PASS (you may need to adapt the DB mock to match the actual Drizzle query chain — read the service file carefully and adjust).

**Step 4: Commit**

```bash
git add server/src/__tests__/instance-credentials.test.ts
git commit -m "test: add unit tests for instanceCredentialsService"
```

---

### Task 7: Final Verification

**Step 1: Run all tests**

```bash
pnpm run test:run
```
Expected: All tests PASS with no regressions.

**Step 2: Verify TypeScript compilation**

```bash
pnpm run build 2>&1 | grep -E "error TS|Error"
```
Expected: No TypeScript errors.

**Step 3: Commit if any cleanup was needed**

If you made any small fixes during verification:
```bash
git add -p  # stage only relevant changes
git commit -m "fix: cleanup from final verification"
```

---

## Acceptance Criteria Checklist

Review against PRD before declaring done:

- [ ] **FR-4**: Fallback toast persists until manually dismissed (not auto-hidden)
- [ ] **FR-4**: Toast message is "Subscription credits exhausted — requests are now using your API key" (or equivalent)
- [ ] **AC-2**: Dual-auth fallback retry logic is tested (Task 4)
- [ ] **AC-3**: Toast notification on fallback is persistent (Tasks 1+2)
- [ ] All Vitest tests pass (`pnpm run test:run`)
- [ ] No TypeScript compilation errors

## Files Changed Summary

| File | Change |
|---|---|
| `ui/src/context/ToastContext.tsx` | Add `persistent` field + `ttlMs: 0` support |
| `ui/src/context/ToastContext.test.tsx` | Add persistent toast test |
| `ui/src/context/LiveUpdatesProvider.tsx` | Change `ttlMs: 12000` → `ttlMs: 0` |
| `server/src/__tests__/claude-local-execute.test.ts` | Add dual-auth fallback tests |
| `server/src/__tests__/instance-settings-routes.test.ts` | Add credential service mock + credential route tests |
| `server/src/__tests__/instance-credentials.test.ts` | New file — service unit tests |
| `packages/adapters/claude-local/src/server/parse.test.ts` | New file — `isClaudeSubscriptionExhausted` tests |
