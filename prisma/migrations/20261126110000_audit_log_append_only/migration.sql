-- Audit trail you can rely on (specification: admin and compliance).
--
-- 1. Indexes for the admin audit viewer (newest first, by person, by action).
-- 2. The database refuses to edit, delete or truncate audit rows, the same way it protects the
--    ledger. The one change it allows is the foreign key clearing "userId" when that user is
--    deleted (ON DELETE SET NULL); every other column must stay exactly as written.
--
-- Additive only: no existing row changes.
--
-- Rollback:
--   DROP TRIGGER "AuditLog_append_only" ON "AuditLog";
--   DROP TRIGGER "AuditLog_no_truncate" ON "AuditLog";
--   DROP FUNCTION nexora_audit_append_only();
--   DROP INDEX "AuditLog_createdAt_idx";
--   DROP INDEX "AuditLog_userId_createdAt_idx";
--   DROP INDEX "AuditLog_action_createdAt_idx";

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

CREATE FUNCTION nexora_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Row fields are only read for UPDATE (they are not set for DELETE or TRUNCATE).
  IF TG_OP = 'UPDATE' THEN
    IF OLD."userId" IS NOT NULL
       AND NEW."userId" IS NULL
       AND NEW."id" = OLD."id"
       AND NEW."action" = OLD."action"
       AND NEW."meta" IS NOT DISTINCT FROM OLD."meta"
       AND NEW."ipHash" IS NOT DISTINCT FROM OLD."ipHash"
       AND NEW."createdAt" = OLD."createdAt" THEN
      -- The person was deleted: keep the event, drop the link.
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Audit log rows are append-only (% on %)', TG_OP, TG_TABLE_NAME;
END $$;

CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION nexora_audit_append_only();
CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION nexora_audit_append_only();
