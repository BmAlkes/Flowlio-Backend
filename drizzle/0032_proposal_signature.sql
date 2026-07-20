ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "signed_name" text;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "signature_image" text;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "signed_ip" text;
