import { z } from "zod";

export const instanceGeneralSettingsSchema = z.object({
  censorUsernameInLogs: z.boolean().default(false),
}).strict();

export const patchInstanceGeneralSettingsSchema = instanceGeneralSettingsSchema.partial();

export const instanceExperimentalSettingsSchema = z.object({
  enableIsolatedWorkspaces: z.boolean().default(false),
  autoRestartDevServerWhenIdle: z.boolean().default(false),
}).strict();

export const patchInstanceExperimentalSettingsSchema = instanceExperimentalSettingsSchema.partial();

export const patchInstanceClaudeSubscriptionSchema = z.object({
  token: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export const patchInstanceClaudeApiKeySchema = z.object({
  key: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export type InstanceGeneralSettings = z.infer<typeof instanceGeneralSettingsSchema>;
export type PatchInstanceGeneralSettings = z.infer<typeof patchInstanceGeneralSettingsSchema>;
export type InstanceExperimentalSettings = z.infer<typeof instanceExperimentalSettingsSchema>;
export type PatchInstanceExperimentalSettings = z.infer<typeof patchInstanceExperimentalSettingsSchema>;
export type PatchInstanceClaudeSubscription = z.infer<typeof patchInstanceClaudeSubscriptionSchema>;
export type PatchInstanceClaudeApiKey = z.infer<typeof patchInstanceClaudeApiKeySchema>;
