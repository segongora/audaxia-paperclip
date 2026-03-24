import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@/lib/router";
import { instanceMembersApi } from "@/api/instanceMembers";
import { authApi } from "@/api/auth";
import { queryKeys } from "../lib/queryKeys";

const PASSWORD_MIN_LENGTH = 8;

function getTokenFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return (params.get("token") ?? "").trim();
}

function FormField({
  label,
  id,
  type = "text",
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled,
}: {
  label: string;
  id: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      />
    </div>
  );
}

export function AcceptInvitePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [token] = useState(() => getTokenFromUrl());

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [existingPassword, setExistingPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const validateQuery = useQuery({
    queryKey: ["member-invite-validate", token],
    queryFn: () => instanceMembersApi.validateToken(token),
    enabled: token.length > 0,
    retry: false,
  });

  const acceptNewMutation = useMutation({
    mutationFn: () =>
      instanceMembersApi.acceptNew({ token, name: name.trim(), password, confirmPassword }),
    onSuccess: async (result) => {
      // Store session token so Better Auth session is picked up
      // The server set a session cookie via better-auth, but since we bypassed BA
      // we need to sign in normally. We'll use the session token to set a cookie
      // or just redirect to login.
      // The session token from our custom flow is stored in the DB session table.
      // We need to sign the user in via Better Auth to set the cookie.
      // The simplest approach: sign in via Better Auth with the credentials just created.
      await authApi.signInEmail({ email: result.user.email, password });
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      navigate("/");
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Failed to create account.");
    },
  });

  const acceptExistingMutation = useMutation({
    mutationFn: () =>
      instanceMembersApi.acceptExisting({ token, password: existingPassword }),
    onSuccess: async (result) => {
      // Sign in via Better Auth to set cookie
      await authApi.signInEmail({ email: result.user.email, password: existingPassword });
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      navigate("/");
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Failed to sign in.");
    },
  });

  useEffect(() => {
    setFormError(null);
  }, [name, password, confirmPassword, existingPassword]);

  if (!token) {
    return (
      <div className="mx-auto max-w-md py-10">
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="text-lg font-semibold">Invalid invitation link</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link is missing an invitation token. Please check the link from your email.
          </p>
        </div>
      </div>
    );
  }

  if (validateQuery.isLoading) {
    return (
      <div className="mx-auto max-w-md py-10 text-sm text-muted-foreground">
        Validating invitation…
      </div>
    );
  }

  const validation = validateQuery.data;

  if (!validation || !validation.valid) {
    return (
      <div className="mx-auto max-w-md py-10">
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="text-lg font-semibold">Invitation invalid</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {validation && !validation.valid
              ? validation.message
              : "This invitation link has expired or already been used. Please request a new invitation."}
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Contact the person who invited you to request a new invitation.
          </p>
        </div>
      </div>
    );
  }

  const { email, userExists } = validation;
  const isPending = acceptNewMutation.isPending || acceptExistingMutation.isPending;

  if (!userExists) {
    // Registration form
    const passwordMismatch = confirmPassword.length > 0 && password !== confirmPassword;
    const passwordTooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
    const canSubmit =
      name.trim().length > 0 &&
      password.length >= PASSWORD_MIN_LENGTH &&
      password === confirmPassword &&
      !isPending;

    return (
      <div className="mx-auto max-w-md py-10">
        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="text-xl font-semibold">Accept your invitation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You've been invited to join Paperclip. Create your account to get started.
          </p>

          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canSubmit) return;
              acceptNewMutation.mutate();
            }}
          >
            <FormField
              label="Email"
              id="accept-email"
              type="email"
              value={email}
              onChange={() => {}}
              disabled
              autoComplete="email"
            />

            <FormField
              label="Full name"
              id="accept-name"
              value={name}
              onChange={setName}
              placeholder="Your name"
              autoComplete="name"
              disabled={isPending}
            />

            <div className="space-y-1">
              <FormField
                label="Password"
                id="accept-password"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder={`Minimum ${PASSWORD_MIN_LENGTH} characters`}
                autoComplete="new-password"
                disabled={isPending}
              />
              {passwordTooShort && (
                <p className="text-xs text-destructive">
                  Password must be at least {PASSWORD_MIN_LENGTH} characters.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <FormField
                label="Confirm password"
                id="accept-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                placeholder="Re-enter password"
                autoComplete="new-password"
                disabled={isPending}
              />
              {passwordMismatch && (
                <p className="text-xs text-destructive">Passwords do not match.</p>
              )}
            </div>

            {formError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-md bg-foreground py-2 text-sm font-medium text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Creating account…" : "Create account & join"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Existing user login form
  return (
    <div className="mx-auto max-w-md py-10">
      <div className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Accept your invitation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An account already exists for <strong>{email}</strong>. Sign in to accept the invitation.
        </p>

        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!existingPassword || isPending) return;
            acceptExistingMutation.mutate();
          }}
        >
          <FormField
            label="Email"
            id="accept-email-existing"
            type="email"
            value={email}
            onChange={() => {}}
            disabled
            autoComplete="email"
          />

          <FormField
            label="Password"
            id="accept-password-existing"
            type="password"
            value={existingPassword}
            onChange={setExistingPassword}
            placeholder="Your password"
            autoComplete="current-password"
            disabled={isPending}
          />

          {formError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {formError}
            </div>
          )}

          <button
            type="submit"
            disabled={!existingPassword || isPending}
            className="w-full rounded-md bg-foreground py-2 text-sm font-medium text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Signing in…" : "Sign in & accept invitation"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Forgot your password?{" "}
          <Link to="/auth" className="text-foreground underline underline-offset-2">
            Go to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
