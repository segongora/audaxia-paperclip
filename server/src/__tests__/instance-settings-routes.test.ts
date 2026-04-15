import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInstanceSettingsService = vi.hoisted(() => ({
  getGeneral: vi.fn(),
  getExperimental: vi.fn(),
  updateGeneral: vi.fn(),
  updateExperimental: vi.fn(),
  listCompanyIds: vi.fn(),
  get: vi.fn(),
}));
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
const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  instanceSettingsService: () => mockInstanceSettingsService,
  instanceCredentialsService: () => mockInstanceCredentialsService,
  logActivity: mockLogActivity,
}));

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    instanceSettingsService: () => mockInstanceSettingsService,
    instanceCredentialsService: () => mockInstanceCredentialsService,
    logActivity: mockLogActivity,
  }));
}

async function createApp(actor: any) {
  const [{ errorHandler }, { instanceSettingsRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/instance-settings.js")>("../routes/instance-settings.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", instanceSettingsRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("instance settings routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../routes/instance-settings.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.resetAllMocks();
    mockInstanceSettingsService.getGeneral.mockReset();
    mockInstanceSettingsService.getExperimental.mockReset();
    mockInstanceSettingsService.updateGeneral.mockReset();
    mockInstanceSettingsService.updateExperimental.mockReset();
    mockInstanceSettingsService.listCompanyIds.mockReset();
    mockInstanceSettingsService.get.mockReset();
    mockLogActivity.mockReset();
    mockInstanceSettingsService.getGeneral.mockResolvedValue({
      censorUsernameInLogs: false,
      keyboardShortcuts: false,
      feedbackDataSharingPreference: "prompt",
    });
    mockInstanceSettingsService.getExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      autoRestartDevServerWhenIdle: false,
    });
    mockInstanceSettingsService.updateGeneral.mockResolvedValue({
      id: "instance-settings-1",
      general: {
        censorUsernameInLogs: true,
        keyboardShortcuts: true,
        feedbackDataSharingPreference: "allowed",
      },
    });
    mockInstanceSettingsService.updateExperimental.mockResolvedValue({
      id: "instance-settings-1",
      experimental: {
        enableIsolatedWorkspaces: true,
        autoRestartDevServerWhenIdle: false,
      },
    });
    mockInstanceSettingsService.listCompanyIds.mockResolvedValue(["company-1", "company-2"]);
    mockInstanceSettingsService.get.mockResolvedValue({ id: "settings-1" });

    // Reset credential mocks
    Object.values(mockInstanceCredentialsService).forEach(fn => (fn as ReturnType<typeof vi.fn>).mockReset());

    // Default credential mock values
    mockInstanceCredentialsService.get.mockResolvedValue({
      subscription: { configured: false, enabled: true, maskedValue: null, status: "unconfigured", lastTestedAt: null, lastTestError: null },
      apiKey: { configured: false, enabled: true, maskedValue: null, status: "unconfigured", lastTestedAt: null, lastTestError: null },
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
      subscriptionToken: null, subscriptionEnabled: true, apiKey: null, apiKeyEnabled: true,
    });
  });

  it("allows local board users to read and update experimental settings", async () => {
    const app = await createApp({
      type: "board",
      userId: "local-board",
      source: "local_implicit",
      isInstanceAdmin: true,
    });

    const getRes = await request(app).get("/api/instance/settings/experimental");
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({
      enableIsolatedWorkspaces: false,
      autoRestartDevServerWhenIdle: false,
    });

    const patchRes = await request(app)
      .patch("/api/instance/settings/experimental")
      .send({ enableIsolatedWorkspaces: true });

    expect(patchRes.status).toBe(200);
    expect(mockInstanceSettingsService.updateExperimental).toHaveBeenCalledWith({
      enableIsolatedWorkspaces: true,
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(2);
  });

  it("allows local board users to update guarded dev-server auto-restart", async () => {
    const app = await createApp({
      type: "board",
      userId: "local-board",
      source: "local_implicit",
      isInstanceAdmin: true,
    });

    await request(app)
      .patch("/api/instance/settings/experimental")
      .send({ autoRestartDevServerWhenIdle: true })
      .expect(200);

    expect(mockInstanceSettingsService.updateExperimental).toHaveBeenCalledWith({
      autoRestartDevServerWhenIdle: true,
    });
  });

  it("allows local board users to read and update general settings", async () => {
    const app = await createApp({
      type: "board",
      userId: "local-board",
      source: "local_implicit",
      isInstanceAdmin: true,
    });

    const getRes = await request(app).get("/api/instance/settings/general");
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({
      censorUsernameInLogs: false,
      keyboardShortcuts: false,
      feedbackDataSharingPreference: "prompt",
    });

    const patchRes = await request(app)
      .patch("/api/instance/settings/general")
      .send({
        censorUsernameInLogs: true,
        keyboardShortcuts: true,
        feedbackDataSharingPreference: "allowed",
      });

    expect(patchRes.status).toBe(200);
    expect(mockInstanceSettingsService.updateGeneral).toHaveBeenCalledWith({
      censorUsernameInLogs: true,
      keyboardShortcuts: true,
      feedbackDataSharingPreference: "allowed",
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(2);
  });

  it("allows non-admin board users to read general settings", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
    });

    const res = await request(app).get("/api/instance/settings/general");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      censorUsernameInLogs: false,
      keyboardShortcuts: false,
      feedbackDataSharingPreference: "prompt",
    });
  });

  it("rejects non-admin board users from updating general settings", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
    });

    const res = await request(app)
      .patch("/api/instance/settings/general")
      .send({ censorUsernameInLogs: true, keyboardShortcuts: true });

    expect(res.status).toBe(403);
    expect(mockInstanceSettingsService.updateGeneral).not.toHaveBeenCalled();
  });

  it("rejects agent callers", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
    });

    const res = await request(app)
      .patch("/api/instance/settings/general")
      .send({ feedbackDataSharingPreference: "not_allowed" });

    expect(res.status).toBe(403);
    expect(mockInstanceSettingsService.updateGeneral).not.toHaveBeenCalled();
  });

  describe("claude credential routes", () => {
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

    it("POST /claude-credentials/subscription/test returns 400 when no token is configured", async () => {
      const app = await createApp(adminActor);
      const res = await request(app).post("/api/instance/settings/claude-credentials/subscription/test");
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false });
    });

    it("POST /claude-credentials/api-key/test returns 400 when no key is configured", async () => {
      const app = await createApp(adminActor);
      const res = await request(app).post("/api/instance/settings/claude-credentials/api-key/test");
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false });
    });
  });
});
