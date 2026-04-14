import type {
  InstanceExperimentalSettings,
  InstanceGeneralSettings,
  PatchInstanceGeneralSettings,
  PatchInstanceExperimentalSettings,
  InstanceClaudeCredentials,
  PatchInstanceClaudeSubscription,
  PatchInstanceClaudeApiKey,
} from "@paperclipai/shared";
import { api } from "./client";

export const instanceSettingsApi = {
  getGeneral: () =>
    api.get<InstanceGeneralSettings>("/instance/settings/general"),
  updateGeneral: (patch: PatchInstanceGeneralSettings) =>
    api.patch<InstanceGeneralSettings>("/instance/settings/general", patch),
  getExperimental: () =>
    api.get<InstanceExperimentalSettings>("/instance/settings/experimental"),
  updateExperimental: (patch: PatchInstanceExperimentalSettings) =>
    api.patch<InstanceExperimentalSettings>("/instance/settings/experimental", patch),
  getClaudeCredentials: () =>
    api.get<InstanceClaudeCredentials & { _envTokenAvailable?: boolean }>("/instance/settings/claude-credentials"),
  updateClaudeSubscription: (patch: PatchInstanceClaudeSubscription) =>
    api.patch<InstanceClaudeCredentials>("/instance/settings/claude-credentials/subscription", patch),
  updateClaudeApiKey: (patch: PatchInstanceClaudeApiKey) =>
    api.patch<InstanceClaudeCredentials>("/instance/settings/claude-credentials/api-key", patch),
  testClaudeSubscription: () =>
    api.post<{ success: boolean; error: string | null }>("/instance/settings/claude-credentials/subscription/test", {}),
  testClaudeApiKey: () =>
    api.post<{ success: boolean; error: string | null }>("/instance/settings/claude-credentials/api-key/test", {}),
  importClaudeSubscriptionFromEnv: () =>
    api.post<InstanceClaudeCredentials>("/instance/settings/claude-credentials/subscription/import-env", {}),
};
