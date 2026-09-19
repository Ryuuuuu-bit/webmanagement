-- One-time fixup (temporary): the Role enum is being narrowed to ADMIN/MEMBER
-- only. Postgres can't drop an enum value while a row still uses it, so
-- reassign any existing "SENIOR" rows to "MEMBER" BEFORE `prisma db push`
-- tries to rebuild the enum type. Safe to run repeatedly (no-op once no rows
-- use SENIOR). Remove this step (and this file) after the deploy that
-- narrows the enum has gone out successfully.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'role') THEN
    UPDATE "User" SET role = 'MEMBER' WHERE role::text = 'SENIOR';
  END IF;
END $$;
