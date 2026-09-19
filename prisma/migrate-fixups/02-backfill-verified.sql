-- One-time fixup (temporary): mark all pre-existing accounts (seeded/admin
-- accounts created before the email-verification feature existed) as already
-- verified, so this deploy doesn't lock out everyone who could already log
-- in. Only NEW self-registered accounts go through Gmail verification.
-- Remove this step (and this file) after the deploy that adds
-- User.emailVerified has gone out successfully.
UPDATE "User" SET "emailVerified" = NOW() WHERE "emailVerified" IS NULL;
