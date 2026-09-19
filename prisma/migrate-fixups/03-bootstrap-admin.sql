-- One-time fixup (temporary): promote the requested account to ADMIN and set
-- its password to the value the user asked for, since there is no UI path
-- to grant the FIRST admin without already being one. Remove this file (and
-- the reference to it in the start script) after this deploy has run once.
UPDATE "User"
SET "role" = 'ADMIN', "passwordHash" = '$2a$10$TxrlN.aO6gpT0W74CmfOb.wTDqKwoghFzxTTMa8cEVnXpCf7eTWX.', "mustChangePassword" = false
WHERE "email" = 'panupong.muntaworn1998@gmail.com';
