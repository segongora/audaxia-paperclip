export interface InstanceGeneralSettings {
  censorUsernameInLogs: boolean;
}

export interface InstanceExperimentalSettings {
  enableIsolatedWorkspaces: boolean;
  autoRestartDevServerWhenIdle: boolean;
}

export interface InstanceSettings {
  id: string;
  general: InstanceGeneralSettings;
  experimental: InstanceExperimentalSettings;
  createdAt: Date;
  updatedAt: Date;
}

// Claude credential status
export type InstanceClaudeCredentialStatus = "unconfigured" | "configured" | "active" | "error";

// What the API returns (masked, safe for client)
export interface InstanceClaudeCredentialSource {
  configured: boolean;
  enabled: boolean;
  maskedValue: string | null;
  status: InstanceClaudeCredentialStatus;
  lastTestedAt: string | null;
  lastTestError: string | null;
  importedFromEnv?: boolean;
}

export interface InstanceClaudeCredentials {
  subscription: InstanceClaudeCredentialSource;
  apiKey: InstanceClaudeCredentialSource;
  /** Timestamp of the most recent automatic fallback from subscription to API key */
  lastFallbackAt: string | null;
}

// Patch shapes for each source
export interface PatchInstanceClaudeSubscription {
  token?: string | null;
  enabled?: boolean;
}

export interface PatchInstanceClaudeApiKey {
  key?: string | null;
  enabled?: boolean;
}

// Internal runtime shape (plaintext, never sent to client)
export interface InstanceClaudeCredentialsRuntime {
  subscriptionToken: string | null;
  subscriptionEnabled: boolean;
  apiKey: string | null;
  apiKeyEnabled: boolean;
}
