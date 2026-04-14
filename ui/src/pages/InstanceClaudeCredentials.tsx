import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, XCircle } from "lucide-react";
import type { InstanceClaudeCredentialSource } from "@paperclipai/shared";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, enabled }: { status: InstanceClaudeCredentialSource["status"]; enabled: boolean }) {
  if (!enabled) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
        Disabled
      </span>
    );
  }
  if (status === "unconfigured") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
        Not configured
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-destructive">
        <XCircle className="h-3.5 w-3.5" />
        Error
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-600">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-blue-600">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Configured
    </span>
  );
}

// ─── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({
  enabled,
  disabled,
  onToggle,
  label,
}: {
  enabled: boolean;
  disabled?: boolean;
  onToggle: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        enabled ? "bg-green-600" : "bg-muted",
      )}
      onClick={() => onToggle(!enabled)}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform",
          enabled ? "translate-x-4.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

// ─── Credential input ──────────────────────────────────────────────────────────

function CredentialInput({
  label,
  placeholder,
  value,
  maskedCurrent,
  onChange,
  disabled,
}: {
  label: string;
  placeholder: string;
  value: string;
  maskedCurrent: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [showValue, setShowValue] = useState(false);

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="relative">
        <input
          type={showValue ? "text" : "password"}
          placeholder={maskedCurrent ? `Current: ${maskedCurrent}` : placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 pr-9 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => setShowValue((v) => !v)}
          title={showValue ? "Hide" : "Show"}
        >
          {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ─── Credential section ────────────────────────────────────────────────────────

function CredentialSection({
  title,
  description,
  source,
  inputLabel,
  inputPlaceholder,
  envNotice,
  onSave,
  onClear,
  onToggle,
  onTest,
  onImportEnv,
  saving,
  testing,
  testResult,
}: {
  title: string;
  description: string;
  source: InstanceClaudeCredentialSource;
  inputLabel: string;
  inputPlaceholder: string;
  envNotice?: string;
  onSave: (value: string) => void;
  onClear: () => void;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onImportEnv?: () => void;
  saving: boolean;
  testing: boolean;
  testResult: { success: boolean; error: string | null } | null;
}) {
  const [inputValue, setInputValue] = useState("");

  function handleSave() {
    if (inputValue.trim()) {
      onSave(inputValue.trim());
      setInputValue("");
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            <StatusBadge status={source.status} enabled={source.enabled} />
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
        <Toggle
          label={`Toggle ${title}`}
          enabled={source.enabled}
          disabled={saving}
          onToggle={onToggle}
        />
      </div>

      {envNotice && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-3 py-2">
          <p className="text-xs text-amber-800 dark:text-amber-200">{envNotice}</p>
          {onImportEnv && (
            <button
              type="button"
              disabled={saving}
              className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              onClick={onImportEnv}
            >
              Save Now
            </button>
          )}
        </div>
      )}

      <div className="space-y-3">
        {source.configured && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{source.maskedValue}</span>
            <button
              type="button"
              className="text-destructive hover:underline"
              disabled={saving}
              onClick={onClear}
            >
              Remove
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <CredentialInput
              label={inputLabel}
              placeholder={inputPlaceholder}
              value={inputValue}
              maskedCurrent={source.maskedValue}
              onChange={setInputValue}
              disabled={saving}
            />
          </div>
          <button
            type="button"
            disabled={!inputValue.trim() || saving}
            className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={handleSave}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={!source.configured || testing}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          onClick={onTest}
        >
          {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Test Connection
        </button>

        {testResult && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs",
              testResult.success ? "text-green-600" : "text-destructive",
            )}
          >
            {testResult.success ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected successfully
              </>
            ) : (
              <>
                <XCircle className="h-3.5 w-3.5" />
                {testResult.error ?? "Test failed"}
              </>
            )}
          </span>
        )}
      </div>

      {source.lastTestError && !testResult && (
        <p className="text-xs text-destructive">Last test error: {source.lastTestError}</p>
      )}
    </section>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function InstanceClaudeCredentials() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [subTestResult, setSubTestResult] = useState<{ success: boolean; error: string | null } | null>(null);
  const [apiTestResult, setApiTestResult] = useState<{ success: boolean; error: string | null } | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "Claude Credentials" },
    ]);
  }, [setBreadcrumbs]);

  const credsQuery = useQuery({
    queryKey: queryKeys.instance.claudeCredentials,
    queryFn: () => instanceSettingsApi.getClaudeCredentials(),
  });

  const invalidateCreds = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.instance.claudeCredentials });

  const subSaveMutation = useMutation({
    mutationFn: (token: string | null) =>
      instanceSettingsApi.updateClaudeSubscription({ token }),
    onSuccess: async () => { setActionError(null); await invalidateCreds(); },
    onError: (e) => setActionError(e instanceof Error ? e.message : "Failed to save subscription token."),
  });

  const subToggleMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      instanceSettingsApi.updateClaudeSubscription({ enabled }),
    onSuccess: async () => { setActionError(null); await invalidateCreds(); },
    onError: (e) => setActionError(e instanceof Error ? e.message : "Failed to update subscription."),
  });

  const apiSaveMutation = useMutation({
    mutationFn: (key: string | null) =>
      instanceSettingsApi.updateClaudeApiKey({ key }),
    onSuccess: async () => { setActionError(null); await invalidateCreds(); },
    onError: (e) => setActionError(e instanceof Error ? e.message : "Failed to save API key."),
  });

  const apiToggleMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      instanceSettingsApi.updateClaudeApiKey({ enabled }),
    onSuccess: async () => { setActionError(null); await invalidateCreds(); },
    onError: (e) => setActionError(e instanceof Error ? e.message : "Failed to update API key."),
  });

  const subTestMutation = useMutation({
    mutationFn: () => instanceSettingsApi.testClaudeSubscription(),
    onSuccess: (result) => { setSubTestResult(result); invalidateCreds(); },
    onError: (e) => setSubTestResult({ success: false, error: e instanceof Error ? e.message : "Test failed" }),
  });

  const apiTestMutation = useMutation({
    mutationFn: () => instanceSettingsApi.testClaudeApiKey(),
    onSuccess: (result) => { setApiTestResult(result); invalidateCreds(); },
    onError: (e) => setApiTestResult({ success: false, error: e instanceof Error ? e.message : "Test failed" }),
  });

  const importEnvMutation = useMutation({
    mutationFn: () => instanceSettingsApi.importClaudeSubscriptionFromEnv(),
    onSuccess: async () => { setActionError(null); await invalidateCreds(); },
    onError: (e) => setActionError(e instanceof Error ? e.message : "Failed to import env token."),
  });

  if (credsQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading Claude credentials...</div>;
  }
  if (credsQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {credsQuery.error instanceof Error ? credsQuery.error.message : "Failed to load Claude credentials."}
      </div>
    );
  }

  const creds = credsQuery.data;
  if (!creds) return null;

  const lastFallback = creds.lastFallbackAt ? new Date(creds.lastFallbackAt) : null;
  const fallbackRecent = lastFallback
    ? Date.now() - lastFallback.getTime() < 24 * 60 * 60 * 1000
    : false;

  // Env var import notice for subscription
  const envNotice = creds._envTokenAvailable && !creds.subscription.configured
    ? "Imported from environment variable (CLAUDE_CODE_OAUTH_TOKEN) — save to persist."
    : undefined;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Claude Credentials</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure instance-level Claude authentication. When both sources are enabled, subscription credits are used
          first with automatic fallback to the API key when credits are exhausted.
        </p>
      </div>

      {fallbackRecent && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-200">
            <span className="font-semibold">Subscription credits exhausted</span> — requests are now using your API
            key. Last fallback: {lastFallback?.toLocaleString()}.
          </div>
        </div>
      )}

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <CredentialSection
        title="Subscription (OAuth Token)"
        description="Authenticate using an Anthropic subscription OAuth token. Uses subscription credits — preferred over the API key when both are configured."
        source={creds.subscription}
        inputLabel="OAuth Token"
        inputPlaceholder="Paste your subscription OAuth token"
        envNotice={envNotice}
        onSave={(token) => subSaveMutation.mutate(token)}
        onClear={() => subSaveMutation.mutate(null)}
        onToggle={(enabled) => subToggleMutation.mutate(enabled)}
        onTest={() => subTestMutation.mutate()}
        onImportEnv={creds._envTokenAvailable ? () => importEnvMutation.mutate() : undefined}
        saving={subSaveMutation.isPending || subToggleMutation.isPending || importEnvMutation.isPending}
        testing={subTestMutation.isPending}
        testResult={subTestResult}
      />

      <CredentialSection
        title="API Key"
        description="Authenticate using an Anthropic API key (sk-ant-...). Used as fallback when subscription credits are exhausted, or as the sole credential when subscription is disabled."
        source={creds.apiKey}
        inputLabel="API Key"
        inputPlaceholder="sk-ant-..."
        onSave={(key) => apiSaveMutation.mutate(key)}
        onClear={() => apiSaveMutation.mutate(null)}
        onToggle={(enabled) => apiToggleMutation.mutate(enabled)}
        onTest={() => apiTestMutation.mutate()}
        saving={apiSaveMutation.isPending || apiToggleMutation.isPending}
        testing={apiTestMutation.isPending}
        testResult={apiTestResult}
      />

      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <h2 className="text-sm font-semibold">How it works</h2>
        <ul className="list-disc pl-4 text-sm text-muted-foreground space-y-1">
          <li>When only one source is configured and enabled, that source is used exclusively.</li>
          <li>When both sources are enabled, subscription is always tried first.</li>
          <li>
            If the subscription returns <code className="text-xs bg-muted px-1 rounded">is_error: true</code> with
            message containing <em>"You&apos;ve hit your limit"</em>, the same request is automatically retried
            using the API key.
          </li>
          <li>An alert appears on this page when a fallback has occurred in the last 24 hours.</li>
          <li>When both sources fail, the agent run surfaces a clear error.</li>
          <li>Credential changes are recorded in the instance audit log.</li>
        </ul>
      </div>
    </div>
  );
}
