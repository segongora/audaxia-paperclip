import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Users, RefreshCw, Trash2, AlertCircle } from "lucide-react";
import { instanceMembersApi } from "@/api/instanceMembers";
import { authApi } from "@/api/auth";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function InstanceMembers() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "Members" },
    ]);
  }, [setBreadcrumbs]);

  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  const membersQuery = useQuery({
    queryKey: queryKeys.instance.members,
    queryFn: () => instanceMembersApi.list(),
  });

  const data = membersQuery.data;
  const currentUserId = sessionQuery.data?.user.id ?? null;
  const memberCount = data?.members.length ?? 0;
  const emailConfigured = data?.emailConfigured ?? false;

  const inviteMutation = useMutation({
    mutationFn: (email: string) => instanceMembersApi.invite(email),
    onSuccess: (result) => {
      setInviteError(null);
      setInviteEmail("");
      if (result.alreadyInvited) {
        setInviteSuccess(result.message ?? "A pending invitation already exists for this email.");
      } else if (!result.emailSent) {
        setInviteSuccess(
          `Invitation created but email could not be sent: ${result.emailError ?? "unknown error"}. Share the invite link manually.`,
        );
      } else {
        setInviteSuccess(`Invitation sent to ${inviteEmail}.`);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.instance.members });
    },
    onError: (err) => {
      setInviteSuccess(null);
      setInviteError(err instanceof Error ? err.message : "Failed to send invitation.");
    },
  });

  const resendMutation = useMutation({
    mutationFn: (inviteId: string) => instanceMembersApi.resend(inviteId),
    onSuccess: (result) => {
      if (result.emailSent) {
        setInviteSuccess("Invitation resent successfully.");
      } else {
        setInviteSuccess(`Resend failed: ${result.emailError ?? "unknown error"}.`);
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.instance.members });
    },
    onError: (err) => {
      setInviteError(err instanceof Error ? err.message : "Failed to resend invitation.");
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => instanceMembersApi.removeMember(userId),
    onSuccess: () => {
      setRemoveError(null);
      setConfirmRemoveId(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.instance.members });
    },
    onError: (err) => {
      setConfirmRemoveId(null);
      setRemoveError(err instanceof Error ? err.message : "Failed to remove member.");
    },
  });

  if (membersQuery.isLoading || sessionQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading members...</div>;
  }

  if (membersQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {membersQuery.error instanceof Error ? membersQuery.error.message : "Failed to load members."}
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Members</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Manage who has access to this Paperclip instance. All members have full admin access.
        </p>
      </div>

      {/* Email not configured warning */}
      {!emailConfigured && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <span className="font-medium">Email service not configured.</span> Set{" "}
            <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/50">SMTP_HOST</code> (and related env vars) to
            enable email invitations. Without email, invitations cannot be sent.
          </div>
        </div>
      )}

      {/* Invite form */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Invite a new member</h2>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="email"
              placeholder="name@example.com"
              value={inviteEmail}
              onChange={(e) => {
                setInviteEmail(e.target.value);
                setInviteError(null);
                setInviteSuccess(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && validateEmail(inviteEmail) && !inviteMutation.isPending) {
                  inviteMutation.mutate(inviteEmail.trim());
                }
              }}
              disabled={inviteMutation.isPending}
              className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
            />
          </div>
          <button
            type="button"
            onClick={() => inviteMutation.mutate(inviteEmail.trim())}
            disabled={inviteMutation.isPending || !validateEmail(inviteEmail)}
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {inviteMutation.isPending ? "Sending…" : "Send invite"}
          </button>
        </div>

        {inviteError && (
          <p className="mt-2 text-sm text-destructive">{inviteError}</p>
        )}
        {inviteSuccess && (
          <p className="mt-2 text-sm text-green-600 dark:text-green-400">{inviteSuccess}</p>
        )}
      </section>

      {/* Remove error */}
      {removeError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {removeError}
        </div>
      )}

      {/* Active members */}
      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">
            Active members
            {memberCount > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">({memberCount})</span>
            )}
          </h2>
        </div>
        <ul className="divide-y divide-border">
          {(data?.members ?? []).map((member) => {
            const isCurrentUser = member.id === currentUserId;
            const isOnlyMember = memberCount === 1;
            const canRemove = !isCurrentUser && !isOnlyMember;

            return (
              <li key={member.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{member.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    Joined {formatDate(member.createdAt)}
                  </span>
                  {isCurrentUser ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">You</span>
                  ) : canRemove ? (
                    confirmRemoveId === member.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Remove?</span>
                        <button
                          type="button"
                          onClick={() => removeMutation.mutate(member.id)}
                          disabled={removeMutation.isPending}
                          className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                        >
                          {removeMutation.isPending ? "Removing…" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setRemoveError(null);
                          setConfirmRemoveId(member.id);
                        }}
                        className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
                        aria-label={`Remove ${member.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )
                  ) : null}
                </div>
              </li>
            );
          })}
          {(data?.members ?? []).length === 0 && (
            <li className="px-5 py-4 text-sm text-muted-foreground">No members found.</li>
          )}
        </ul>
      </section>

      {/* Pending invitations */}
      {(data?.pendingInvitations ?? []).length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">
              Pending invitations
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({data?.pendingInvitations.length})
              </span>
            </h2>
          </div>
          <ul className="divide-y divide-border">
            {(data?.pendingInvitations ?? []).map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{inv.email}</div>
                  <div className="text-xs text-muted-foreground">
                    Invited {formatDate(inv.createdAt)} · Expires {formatDate(inv.expiresAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setInviteError(null);
                    setInviteSuccess(null);
                    resendMutation.mutate(inv.id);
                  }}
                  disabled={resendMutation.isPending}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCw className="h-3 w-3" />
                  Resend
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
