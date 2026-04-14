import { api } from "./client";

export type MemberInfo = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export type PendingInvitation = {
  id: string;
  email: string;
  invitedByUserId: string;
  expiresAt: string;
  createdAt: string;
};

export type MembersResponse = {
  members: MemberInfo[];
  pendingInvitations: PendingInvitation[];
  emailConfigured: boolean;
};

export type InviteResult = {
  inviteId: string;
  emailSent: boolean;
  emailError?: string;
  alreadyInvited?: boolean;
  message?: string;
};

export type ValidateTokenResult =
  | { valid: true; email: string; userExists: boolean }
  | { valid: false; message: string };

export type AcceptInviteNewUserPayload = {
  token: string;
  name: string;
  password: string;
  confirmPassword: string;
};

export type AcceptInviteExistingUserPayload = {
  token: string;
  password: string;
};

export type AcceptInviteResult = {
  user: { id: string; email: string; name: string };
  sessionToken: string;
};

export const instanceMembersApi = {
  list: () => api.get<MembersResponse>("/instance/members"),

  invite: (email: string) =>
    api.post<InviteResult>("/instance/members/invite", { email }),

  resend: (inviteId: string) =>
    api.post<{ inviteId: string; emailSent: boolean; emailError?: string }>(
      `/instance/members/invite/${inviteId}/resend`,
      {},
    ),

  validateToken: (token: string) =>
    api
      .get<ValidateTokenResult>(`/instance/members/invite/validate?token=${encodeURIComponent(token)}`)
      .catch((err: unknown) => {
        // Surface 400/429 as a valid: false result
        const msg =
          err instanceof Error ? err.message : "Invalid invitation.";
        return { valid: false as const, message: msg };
      }),

  acceptNew: (payload: AcceptInviteNewUserPayload) =>
    api.post<AcceptInviteResult>("/instance/members/invite/accept/new", payload),

  acceptExisting: (payload: AcceptInviteExistingUserPayload) =>
    api.post<AcceptInviteResult>("/instance/members/invite/accept/existing", payload),

  revokeInvite: (inviteId: string) =>
    api.delete<{ ok: boolean }>(`/instance/members/invite/${inviteId}`),

  removeMember: (userId: string) =>
    api.delete<{ ok: boolean }>(`/instance/members/${userId}`),
};
