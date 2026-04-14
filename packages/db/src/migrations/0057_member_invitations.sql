CREATE TABLE IF NOT EXISTS "member_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"validation_attempts" integer DEFAULT 0 NOT NULL,
	"validation_attempts_reset_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "member_invitations_token_hash_unique_idx" ON "member_invitations" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_invitations_email_idx" ON "member_invitations" USING btree ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "member_invitations_status_idx" ON "member_invitations" USING btree ("accepted_at", "revoked_at", "expires_at");
