import { Router, type Request } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { authUsers, memberInvitations as memberInvitationsTbl } from "@paperclipai/db";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { memberInvitationService } from "../services/member-invitations.js";
import { sendEmail, isEmailConfigured } from "../services/email.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;

const inviteMemberSchema = z.object({
  email: z.string().email(),
});

const acceptInviteNewUserSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(100),
  password: z.string().min(PASSWORD_MIN_LENGTH),
  confirmPassword: z.string().min(1),
});

const acceptInviteExistingUserSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});

function requestBaseUrl(req: Request): string {
  const forwardedProto = req.header("x-forwarded-proto");
  const proto = forwardedProto?.split(",")[0]?.trim() || req.protocol || "http";
  const host =
    req.header("x-forwarded-host")?.split(",")[0]?.trim() || req.header("host");
  if (!host) return "";
  return `${proto}://${host}`;
}

function buildInviteEmail(opts: {
  inviteUrl: string;
  inviteEmail: string;
  invitedByName: string;
  invitedByEmail: string;
}): { subject: string; text: string; html: string } {
  const { inviteUrl, invitedByName, invitedByEmail } = opts;

  const subject = `You've been invited to join Paperclip`;

  const text = [
    `Hi,`,
    ``,
    `${invitedByName} (${invitedByEmail}) has invited you to join their Paperclip instance.`,
    ``,
    `Click the link below to accept the invitation (expires in 72 hours):`,
    inviteUrl,
    ``,
    `If you didn't expect this invitation, you can safely ignore this email.`,
  ].join("\n");

  const html = `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
      <h2 style="margin-bottom: 8px;">You've been invited to join Paperclip</h2>
      <p>${invitedByName} (${invitedByEmail}) has invited you to join their Paperclip instance.</p>
      <p>Click the button below to accept the invitation (expires in 72 hours):</p>
      <p>
        <a href="${inviteUrl}"
           style="display:inline-block;background:#18181b;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">
          Accept Invitation
        </a>
      </p>
      <p style="font-size:12px;color:#666;">
        Or copy this link: <a href="${inviteUrl}">${inviteUrl}</a>
      </p>
      <p style="font-size:12px;color:#888;">
        If you didn't expect this invitation, you can safely ignore this email.
      </p>
    </div>
  `;

  return { subject, text, html };
}

function buildAcceptedEmail(opts: {
  newMemberName: string;
  newMemberEmail: string;
}): { subject: string; text: string; html: string } {
  const subject = `${opts.newMemberName} has joined your Paperclip instance`;
  const text = [
    `Good news!`,
    ``,
    `${opts.newMemberName} (${opts.newMemberEmail}) has accepted your invitation and joined your Paperclip instance.`,
  ].join("\n");

  const html = `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
      <h2>New member joined!</h2>
      <p><strong>${opts.newMemberName}</strong> (${opts.newMemberEmail}) has accepted your invitation and joined your Paperclip instance.</p>
    </div>
  `;

  return { subject, text, html };
}

export function instanceMembersRoutes(db: Db) {
  const router = Router();
  const svc = memberInvitationService(db);

  function assertBoardAccess(req: Request) {
    if (req.actor.type !== "board") {
      throw forbidden("Board access required");
    }
  }

  function assertAuthenticated(req: Request): string {
    assertBoardAccess(req);
    if (!req.actor.userId) {
      throw forbidden("User session required");
    }
    return req.actor.userId;
  }

  /** GET /api/instance/members — list members and pending invitations */
  router.get("/instance/members", async (req, res) => {
    assertBoardAccess(req);
    const [members, pendingInvitations] = await Promise.all([
      svc.listMembers(),
      svc.listPendingInvitations(),
    ]);
    res.json({
      members,
      pendingInvitations: pendingInvitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        invitedByUserId: inv.invitedByUserId,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
      })),
      emailConfigured: isEmailConfigured(),
    });
  });

  /** POST /api/instance/members/invite — send an invitation */
  router.post(
    "/instance/members/invite",
    validate(inviteMemberSchema),
    async (req, res) => {
      const userId = assertAuthenticated(req);
      const { email } = req.body as { email: string };

      const normalizedEmail = email.toLowerCase().trim();

      if (!EMAIL_REGEX.test(normalizedEmail)) {
        throw badRequest("Invalid email format");
      }

      // Check if already a member
      const existingUser = await svc.findUserByEmail(normalizedEmail);
      if (existingUser) {
        throw conflict("This user is already a member.");
      }

      // Check for existing pending invite
      const existingInvite = await svc.findExistingPendingInvite(normalizedEmail);
      if (existingInvite) {
        res.json({
          alreadyInvited: true,
          inviteId: existingInvite.id,
          message: "A pending invitation already exists for this email. Use resend to issue a fresh link.",
        });
        return;
      }

      if (!isEmailConfigured()) {
        throw unprocessable(
          "Email service not configured. Please contact your administrator.",
        );
      }

      // Get inviter info
      const inviter = await db
        .select({ name: authUsers.name, email: authUsers.email })
        .from(authUsers)
        .where(eq(authUsers.id, userId))
        .then((rows) => rows[0] ?? null);

      const { invite, token } = await svc.createInvitation(normalizedEmail, userId);

      const baseUrl = requestBaseUrl(req);
      const inviteUrl = `${baseUrl}/auth/accept-invite?token=${token}`;

      const emailContent = buildInviteEmail({
        inviteUrl,
        inviteEmail: normalizedEmail,
        invitedByName: inviter?.name ?? "A Paperclip member",
        invitedByEmail: inviter?.email ?? "",
      });

      const emailResult = await sendEmail({
        to: normalizedEmail,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      });

      if (!emailResult.ok) {
        // Invitation was created but email failed — surface this to the caller
        res.status(202).json({
          inviteId: invite.id,
          emailSent: false,
          emailError:
            emailResult.reason === "not_configured"
              ? "Email service not configured."
              : `Failed to send email: ${emailResult.error ?? "unknown error"}`,
        });
        return;
      }

      res.status(201).json({
        inviteId: invite.id,
        emailSent: true,
      });
    },
  );

  /** POST /api/instance/members/invite/:inviteId/resend — resend an invitation */
  router.post("/instance/members/invite/:inviteId/resend", async (req, res) => {
    const userId = assertAuthenticated(req);
    const { inviteId } = req.params as { inviteId: string };

    if (!isEmailConfigured()) {
      throw unprocessable("Email service not configured. Please contact your administrator.");
    }

    const result = await svc.resendInvitation(inviteId, userId);
    if (!result) {
      throw notFound("Invitation not found");
    }

    const { invite, token } = result;

    const inviter = await db
      .select({ name: authUsers.name, email: authUsers.email })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .then((rows) => rows[0] ?? null);

    const baseUrl = requestBaseUrl(req);
    const inviteUrl = `${baseUrl}/auth/accept-invite?token=${token}`;

    const emailContent = buildInviteEmail({
      inviteUrl,
      inviteEmail: invite.email,
      invitedByName: inviter?.name ?? "A Paperclip member",
      invitedByEmail: inviter?.email ?? "",
    });

    const emailResult = await sendEmail({
      to: invite.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    res.json({
      inviteId: invite.id,
      emailSent: emailResult.ok,
      emailError: emailResult.ok ? undefined : (emailResult.error ?? "Email send failed"),
    });
  });

  /** GET /api/instance/members/invite/validate?token=... — validate a token (public) */
  router.get("/instance/members/invite/validate", async (req, res) => {
    const token = (req.query.token as string | undefined)?.trim();
    if (!token) throw badRequest("token is required");

    const result = await svc.validateToken(token);

    if (!result.valid) {
      const messages: Record<string, string> = {
        not_found: "This invitation link has expired or already been used. Please request a new invitation.",
        expired: "This invitation link has expired or already been used. Please request a new invitation.",
        already_used: "This invitation link has expired or already been used. Please request a new invitation.",
        rate_limited: "Too many validation attempts. Please try again later.",
      };
      res.status(400).json({ valid: false, message: messages[result.reason] ?? "Invalid invitation." });
      return;
    }

    res.json({
      valid: true,
      email: result.invite.email,
      userExists: result.userExists,
    });
  });

  /** POST /api/instance/members/invite/accept/new — register new user and accept invite */
  router.post(
    "/instance/members/invite/accept/new",
    validate(acceptInviteNewUserSchema),
    async (req, res) => {
      const { token, name, password, confirmPassword } = req.body as {
        token: string;
        name: string;
        password: string;
        confirmPassword: string;
      };

      if (password !== confirmPassword) {
        throw badRequest("Passwords do not match");
      }

      if (password.length < PASSWORD_MIN_LENGTH) {
        throw badRequest(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
      }

      const result = await svc.createUserFromInvite({ inviteToken: token, name, password });

      if ("error" in result) {
        const messages: Record<string, { status: number; message: string }> = {
          not_found: { status: 400, message: "This invitation link has expired or already been used. Please request a new invitation." },
          expired: { status: 400, message: "This invitation link has expired or already been used. Please request a new invitation." },
          already_used: { status: 400, message: "This invitation link has expired or already been used. Please request a new invitation." },
          rate_limited: { status: 429, message: "Too many validation attempts. Please try again later." },
          user_exists: { status: 409, message: "An account with this email already exists. Please sign in instead." },
        };
        const mapped = messages[result.error] ?? { status: 400, message: "Failed to accept invitation." };
        res.status(mapped.status).json({ error: mapped.message });
        return;
      }

      // Send acceptance notification to inviter
      const { invite } = await getInviteForNotification(token);
      if (invite?.invitedByUserId) {
        void sendAcceptanceNotification({
          inviterUserId: invite.invitedByUserId,
          newMemberName: result.user.name,
          newMemberEmail: result.user.email,
        });
      }

      res.status(201).json({
        user: result.user,
        sessionToken: result.sessionToken,
      });
    },
  );

  /** POST /api/instance/members/invite/accept/existing — sign in existing user and accept invite */
  router.post(
    "/instance/members/invite/accept/existing",
    validate(acceptInviteExistingUserSchema),
    async (req, res) => {
      const { token, password } = req.body as { token: string; password: string };

      const result = await svc.acceptInviteExistingUser({ inviteToken: token, password });

      if ("error" in result) {
        const messages: Record<string, { status: number; message: string }> = {
          not_found: { status: 400, message: "This invitation link has expired or already been used. Please request a new invitation." },
          expired: { status: 400, message: "This invitation link has expired or already been used. Please request a new invitation." },
          already_used: { status: 400, message: "This invitation link has expired or already been used. Please request a new invitation." },
          rate_limited: { status: 429, message: "Too many validation attempts. Please try again later." },
          user_not_found: { status: 404, message: "No account found with this email." },
          invalid_password: { status: 401, message: "Incorrect password." },
          no_password: { status: 400, message: "This account does not use password authentication." },
        };
        const mapped = messages[result.error] ?? { status: 400, message: "Failed to accept invitation." };
        res.status(mapped.status).json({ error: mapped.message });
        return;
      }

      // Send acceptance notification to inviter
      const { invite } = await getInviteForNotification(token);
      if (invite?.invitedByUserId) {
        void sendAcceptanceNotification({
          inviterUserId: invite.invitedByUserId,
          newMemberName: result.user.name,
          newMemberEmail: result.user.email,
        });
      }

      res.json({
        user: result.user,
        sessionToken: result.sessionToken,
      });
    },
  );

  /** DELETE /api/instance/members/invite/:inviteId — revoke a pending invitation */
  router.delete("/instance/members/invite/:inviteId", async (req, res) => {
    assertAuthenticated(req);
    const { inviteId } = req.params as { inviteId: string };

    const result = await svc.revokeInvitation(inviteId);

    if (!result.ok) {
      const messages: Record<string, { status: number; message: string }> = {
        not_found: { status: 404, message: "Invitation not found." },
        already_accepted: { status: 409, message: "This invitation has already been accepted." },
        already_revoked: { status: 409, message: "This invitation has already been revoked." },
      };
      const mapped = messages[result.reason] ?? { status: 400, message: result.reason };
      res.status(mapped.status).json({ error: mapped.message });
      return;
    }

    res.json({ ok: true });
  });

  /** DELETE /api/instance/members/:userId — remove a member */
  router.delete("/instance/members/:userId", async (req, res) => {
    const requestingUserId = assertAuthenticated(req);
    const { userId } = req.params as { userId: string };

    const result = await svc.removeMember(userId, requestingUserId);

    if (!result.ok) {
      const messages: Record<string, { status: number; message: string }> = {
        cannot_remove_self: { status: 400, message: "You cannot remove yourself." },
        last_member: { status: 400, message: "Cannot remove the last member of the instance." },
        not_found: { status: 404, message: "Member not found." },
      };
      const mapped = messages[result.reason] ?? { status: 400, message: result.reason };
      res.status(mapped.status).json({ error: mapped.message });
      return;
    }

    res.json({ ok: true });
  });

  // --- helpers ---

  async function getInviteForNotification(token: string) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const invite = await db
      .select()
      .from(memberInvitationsTbl)
      .where(eq(memberInvitationsTbl.tokenHash, tokenHash))
      .then((rows) => rows[0] ?? null);
    return { invite };
  }

  async function sendAcceptanceNotification(opts: {
    inviterUserId: string;
    newMemberName: string;
    newMemberEmail: string;
  }) {
    if (!isEmailConfigured()) return;
    const inviter = await db
      .select({ email: authUsers.email })
      .from(authUsers)
      .where(eq(authUsers.id, opts.inviterUserId))
      .then((rows) => rows[0] ?? null);
    if (!inviter?.email) return;

    const emailContent = buildAcceptedEmail({
      newMemberName: opts.newMemberName,
      newMemberEmail: opts.newMemberEmail,
    });
    await sendEmail({ to: inviter.email, ...emailContent });
  }

  return router;
}
