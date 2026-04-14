import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  patchInstanceExperimentalSettingsSchema,
  patchInstanceGeneralSettingsSchema,
  patchInstanceClaudeSubscriptionSchema,
  patchInstanceClaudeApiKeySchema,
} from "@paperclipai/shared";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { instanceSettingsService, instanceCredentialsService, logActivity } from "../services/index.js";
import { getActorInfo } from "./authz.js";
import { testClaudeCredential } from "./instance-credential-test.js";

function assertCanManageInstanceSettings(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

export function instanceSettingsRoutes(db: Db) {
  const router = Router();
  const svc = instanceSettingsService(db);
  const credSvc = instanceCredentialsService(db);

  router.get("/instance/settings/general", async (req, res) => {
    // General settings (e.g. keyboardShortcuts) are readable by any
    // authenticated board user.  Only PATCH requires instance-admin.
    if (req.actor.type !== "board") {
      throw forbidden("Board access required");
    }
    res.json(await svc.getGeneral());
  });

  router.patch(
    "/instance/settings/general",
    validate(patchInstanceGeneralSettingsSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const updated = await svc.updateGeneral(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.general_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              general: updated.general,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.general);
    },
  );

  router.get("/instance/settings/experimental", async (req, res) => {
    // Experimental settings are readable by any authenticated board user.
    // Only PATCH requires instance-admin.
    if (req.actor.type !== "board") {
      throw forbidden("Board access required");
    }
    res.json(await svc.getExperimental());
  });

  router.patch(
    "/instance/settings/experimental",
    validate(patchInstanceExperimentalSettingsSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const updated = await svc.updateExperimental(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.experimental_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              experimental: updated.experimental,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.experimental);
    },
  );

  // ─── Claude Credentials ────────────────────────────────────────────────────

  router.get("/instance/settings/claude-credentials", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const creds = await credSvc.get();
    // Also check if an env var token is available for auto-import
    const envCheck = await credSvc.maybeImportFromEnv();
    if (envCheck.imported && envCheck.token) {
      // Return the current state with a hint that env var is available
      res.json({ ...creds, _envTokenAvailable: true });
    } else {
      res.json(creds);
    }
  });

  router.patch(
    "/instance/settings/claude-credentials/subscription",
    validate(patchInstanceClaudeSubscriptionSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const updated = await credSvc.updateSubscription(req.body);
      const actor = getActorInfo(req);
      const settingsRow = await svc.get();
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.claude_subscription_updated",
            entityType: "instance_settings",
            entityId: settingsRow.id,
            details: { changedKeys: Object.keys(req.body).sort() },
          }),
        ),
      );
      res.json(updated);
    },
  );

  router.patch(
    "/instance/settings/claude-credentials/api-key",
    validate(patchInstanceClaudeApiKeySchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const updated = await credSvc.updateApiKey(req.body);
      const actor = getActorInfo(req);
      const settingsRow = await svc.get();
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.claude_api_key_updated",
            entityType: "instance_settings",
            entityId: settingsRow.id,
            details: { changedKeys: Object.keys(req.body).sort() },
          }),
        ),
      );
      res.json(updated);
    },
  );

  /** FR-12: Explicitly import CLAUDE_CODE_OAUTH_TOKEN env var as the subscription token */
  router.post("/instance/settings/claude-credentials/subscription/import-env", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (!envToken || !envToken.trim()) {
      res.status(400).json({ error: "CLAUDE_CODE_OAUTH_TOKEN is not set in the environment" });
      return;
    }
    const updated = await credSvc.updateSubscription({ token: envToken.trim() });
    const actor = getActorInfo(req);
    const settingsRow = await svc.get();
    const companyIds = await svc.listCompanyIds();
    await Promise.all(
      companyIds.map((companyId) =>
        logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "instance.settings.claude_subscription_updated",
          entityType: "instance_settings",
          entityId: settingsRow.id,
          details: { changedKeys: ["token"], source: "env_import" },
        }),
      ),
    );
    res.json(updated);
  });

  router.post("/instance/settings/claude-credentials/subscription/test", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const runtime = await credSvc.getForRuntime();
    if (!runtime.subscriptionToken) {
      res.status(400).json({ success: false, error: "No subscription token configured" });
      return;
    }
    const result = await testClaudeCredential({ type: "subscription", token: runtime.subscriptionToken });
    await credSvc.updateTestResult("subscription", result);
    res.json(result);
  });

  router.post("/instance/settings/claude-credentials/api-key/test", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const runtime = await credSvc.getForRuntime();
    if (!runtime.apiKey) {
      res.status(400).json({ success: false, error: "No API key configured" });
      return;
    }
    const result = await testClaudeCredential({ type: "api_key", token: runtime.apiKey });
    await credSvc.updateTestResult("apiKey", result);
    res.json(result);
  });

  return router;
}
