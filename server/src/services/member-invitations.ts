import { createHash, randomBytes, scrypt, timingSafeEqual, type BinaryLike } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  authUsers,
  authSessions,
  authAccounts,
  instanceUserRoles,
  companyMemberships,
  companies,
  memberInvitations,
} from "@paperclipai/db";

const scryptAsync = promisify(scrypt) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
const RATE_LIMIT_MAX = 10; // max validation attempts per hour per token
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}

/** Hash password using scrypt (compatible with Better Auth's credential format) */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, 32, { N: 16384, r: 8, p: 1 })) as Buffer;
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Verify a password against a Better Auth scrypt hash */
async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts as [string, string];
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expectedHash = (await scryptAsync(password, salt, 32, { N: 16384, r: 8, p: 1 })) as Buffer;
    const actual = Buffer.from(hashHex, "hex");
    return actual.length === expectedHash.length && timingSafeEqual(actual, expectedHash);
  } catch {
    return false;
  }
}

function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function generateUserId(): string {
  return randomBytes(16).toString("hex");
}

export type InviteValidationResult =
  | { valid: true; invite: typeof memberInvitations.$inferSelect; userExists: boolean }
  | { valid: false; reason: "not_found" | "expired" | "already_used" | "rate_limited" };

export function memberInvitationService(db: Db) {
  async function listMembers() {
    return db
      .select({
        id: authUsers.id,
        name: authUsers.name,
        email: authUsers.email,
        createdAt: authUsers.createdAt,
      })
      .from(authUsers)
      .orderBy(authUsers.createdAt);
  }

  async function listPendingInvitations() {
    const now = new Date();
    return db
      .select()
      .from(memberInvitations)
      .where(
        and(
          isNull(memberInvitations.acceptedAt),
          isNull(memberInvitations.revokedAt),
          gt(memberInvitations.expiresAt, now),
        ),
      )
      .orderBy(desc(memberInvitations.createdAt));
  }

  async function findExistingPendingInvite(email: string) {
    const now = new Date();
    const normalizedEmail = email.toLowerCase().trim();
    return db
      .select()
      .from(memberInvitations)
      .where(
        and(
          eq(memberInvitations.email, normalizedEmail),
          isNull(memberInvitations.acceptedAt),
          isNull(memberInvitations.revokedAt),
          gt(memberInvitations.expiresAt, now),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function findUserByEmail(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    return db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, normalizedEmail))
      .then((rows) => rows[0] ?? null);
  }

  async function createInvitation(
    email: string,
    invitedByUserId: string,
  ): Promise<{ invite: typeof memberInvitations.$inferSelect; token: string }> {
    const token = generateInviteToken();
    const tokenHash = hashToken(token);
    const normalizedEmail = email.toLowerCase().trim();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = await db
      .insert(memberInvitations)
      .values({
        email: normalizedEmail,
        tokenHash,
        invitedByUserId,
        expiresAt,
      })
      .returning()
      .then((rows) => rows[0]!);

    return { invite, token };
  }

  async function resendInvitation(
    inviteId: string,
    invitedByUserId: string,
  ): Promise<{ invite: typeof memberInvitations.$inferSelect; token: string } | null> {
    const existing = await db
      .select()
      .from(memberInvitations)
      .where(eq(memberInvitations.id, inviteId))
      .then((rows) => rows[0] ?? null);

    if (!existing) return null;

    // Revoke old invite
    await db
      .update(memberInvitations)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(memberInvitations.id, inviteId));

    // Create a fresh one
    return createInvitation(existing.email, invitedByUserId);
  }

  async function validateToken(token: string): Promise<InviteValidationResult> {
    const tokenHash = hashToken(token);
    const invite = await db
      .select()
      .from(memberInvitations)
      .where(eq(memberInvitations.tokenHash, tokenHash))
      .then((rows) => rows[0] ?? null);

    if (!invite || invite.revokedAt) {
      return { valid: false, reason: "not_found" };
    }

    if (invite.acceptedAt) {
      return { valid: false, reason: "already_used" };
    }

    if (invite.expiresAt < new Date()) {
      return { valid: false, reason: "expired" };
    }

    // Rate limiting: check validation attempts
    const now = new Date();
    const resetAt = invite.validationAttemptsResetAt;
    const windowExpired = !resetAt || now.getTime() - resetAt.getTime() > RATE_LIMIT_WINDOW_MS;

    const currentAttempts = windowExpired ? 0 : invite.validationAttempts;

    if (currentAttempts >= RATE_LIMIT_MAX) {
      return { valid: false, reason: "rate_limited" };
    }

    // Increment attempts
    await db
      .update(memberInvitations)
      .set({
        validationAttempts: windowExpired ? 1 : currentAttempts + 1,
        validationAttemptsResetAt: windowExpired ? now : invite.validationAttemptsResetAt,
        updatedAt: now,
      })
      .where(eq(memberInvitations.id, invite.id));

    const existingUser = await findUserByEmail(invite.email);

    return {
      valid: true,
      invite,
      userExists: Boolean(existingUser),
    };
  }

  async function grantInstanceAccess(userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Grant instance admin role
      const existing = await tx
        .select({ id: instanceUserRoles.id })
        .from(instanceUserRoles)
        .where(and(eq(instanceUserRoles.userId, userId), eq(instanceUserRoles.role, "instance_admin")))
        .then((rows) => rows[0] ?? null);

      if (!existing) {
        await tx.insert(instanceUserRoles).values({
          userId,
          role: "instance_admin",
        });
      }

      // Grant company memberships for all companies
      const allCompanies = await tx.select({ id: companies.id }).from(companies);
      for (const company of allCompanies) {
        const existingMembership = await tx
          .select({ id: companyMemberships.id })
          .from(companyMemberships)
          .where(
            and(
              eq(companyMemberships.companyId, company.id),
              eq(companyMemberships.principalType, "user"),
              eq(companyMemberships.principalId, userId),
            ),
          )
          .then((rows) => rows[0] ?? null);

        if (!existingMembership) {
          await tx.insert(companyMemberships).values({
            companyId: company.id,
            principalType: "user",
            principalId: userId,
            status: "active",
          });
        }
      }
    });
  }

  /** Create a new user and return them with a session token */
  async function createUserFromInvite(opts: {
    inviteToken: string;
    name: string;
    password: string;
  }): Promise<{ user: { id: string; email: string; name: string }; sessionToken: string } | { error: string }> {
    const validation = await validateToken(opts.inviteToken);
    if (!validation.valid) {
      return { error: validation.reason };
    }

    const { invite } = validation;

    if (validation.userExists) {
      return { error: "user_exists" };
    }

    const passwordHash = await hashPassword(opts.password);
    const userId = generateUserId();
    const sessionToken = generateSessionToken();
    const now = new Date();
    const sessionExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await db.transaction(async (tx) => {
      // Create user
      await tx.insert(authUsers).values({
        id: userId,
        name: opts.name,
        email: invite.email,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });

      // Create credential account
      await tx.insert(authAccounts).values({
        id: generateUserId(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });

      // Create session
      await tx.insert(authSessions).values({
        id: generateUserId(),
        userId,
        token: sessionToken,
        expiresAt: sessionExpiry,
        createdAt: now,
        updatedAt: now,
      });

      // Mark invite as accepted
      await tx
        .update(memberInvitations)
        .set({ acceptedAt: now, acceptedByUserId: userId, updatedAt: now })
        .where(eq(memberInvitations.id, invite.id));
    });

    await grantInstanceAccess(userId);

    return { user: { id: userId, email: invite.email, name: opts.name }, sessionToken };
  }

  /** Accept an invite for an existing user and create a session */
  async function acceptInviteExistingUser(opts: {
    inviteToken: string;
    password: string;
  }): Promise<{ user: { id: string; email: string; name: string }; sessionToken: string } | { error: string }> {
    const validation = await validateToken(opts.inviteToken);
    if (!validation.valid) {
      return { error: validation.reason };
    }

    const { invite } = validation;

    const user = await findUserByEmail(invite.email);
    if (!user) {
      return { error: "user_not_found" };
    }

    // Verify password
    const account = await db
      .select()
      .from(authAccounts)
      .where(and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, "credential")))
      .then((rows) => rows[0] ?? null);

    if (!account?.password) {
      return { error: "no_password" };
    }

    const passwordOk = await verifyPassword(account.password, opts.password);
    if (!passwordOk) {
      return { error: "invalid_password" };
    }

    const now = new Date();
    const sessionToken = generateSessionToken();
    const sessionExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db.transaction(async (tx) => {
      await tx.insert(authSessions).values({
        id: generateUserId(),
        userId: user.id,
        token: sessionToken,
        expiresAt: sessionExpiry,
        createdAt: now,
        updatedAt: now,
      });

      await tx
        .update(memberInvitations)
        .set({ acceptedAt: now, acceptedByUserId: user.id, updatedAt: now })
        .where(eq(memberInvitations.id, invite.id));
    });

    await grantInstanceAccess(user.id);

    return { user: { id: user.id, email: user.email, name: user.name }, sessionToken };
  }

  async function revokeInvitation(
    inviteId: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const existing = await db
      .select()
      .from(memberInvitations)
      .where(eq(memberInvitations.id, inviteId))
      .then((rows) => rows[0] ?? null);

    if (!existing) {
      return { ok: false, reason: "not_found" };
    }

    if (existing.acceptedAt) {
      return { ok: false, reason: "already_accepted" };
    }

    if (existing.revokedAt) {
      return { ok: false, reason: "already_revoked" };
    }

    await db
      .update(memberInvitations)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(memberInvitations.id, inviteId));

    return { ok: true };
  }

  async function removeMember(
    targetUserId: string,
    requestingUserId: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (targetUserId === requestingUserId) {
      return { ok: false, reason: "cannot_remove_self" };
    }

    // Check last-member protection
    const allUsers = await db.select({ id: authUsers.id }).from(authUsers);
    if (allUsers.length <= 1) {
      return { ok: false, reason: "last_member" };
    }

    // Check user exists
    const user = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.id, targetUserId))
      .then((rows) => rows[0] ?? null);

    if (!user) {
      return { ok: false, reason: "not_found" };
    }

    await db.transaction(async (tx) => {
      // Revoke all sessions
      await tx.delete(authSessions).where(eq(authSessions.userId, targetUserId));

      // Remove instance admin role
      await tx.delete(instanceUserRoles).where(eq(instanceUserRoles.userId, targetUserId));

      // Deactivate company memberships
      await tx
        .update(companyMemberships)
        .set({ status: "inactive" })
        .where(
          and(
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, targetUserId),
          ),
        );
    });

    return { ok: true };
  }

  return {
    listMembers,
    listPendingInvitations,
    findExistingPendingInvite,
    findUserByEmail,
    createInvitation,
    resendInvitation,
    revokeInvitation,
    validateToken,
    createUserFromInvite,
    acceptInviteExistingUser,
    removeMember,
  };
}
