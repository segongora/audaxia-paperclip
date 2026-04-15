ALTER TABLE "instance_settings" ADD COLUMN IF NOT EXISTS "credentials" jsonb DEFAULT '{}'::jsonb NOT NULL;
