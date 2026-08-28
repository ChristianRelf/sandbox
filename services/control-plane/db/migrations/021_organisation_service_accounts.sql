DROP POLICY service_accounts_credential_manager ON service_accounts;
CREATE POLICY service_accounts_credential_manager ON service_accounts USING(
  (workspace_id IS NOT NULL AND account_has_workspace_permission(workspace_id,'service_accounts.manage'))
  OR (workspace_id IS NULL AND EXISTS(
    SELECT 1 FROM service_account_role_assignments assignment
    WHERE assignment.service_account_id=service_accounts.id
      AND account_has_workspace_permission(assignment.workspace_id,'service_accounts.manage')
  ))
) WITH CHECK(
  (workspace_id IS NOT NULL AND account_has_workspace_permission(workspace_id,'service_accounts.manage'))
  OR (workspace_id IS NULL AND created_by=app_account_id() AND EXISTS(
    SELECT 1 FROM workspaces workspace
    WHERE workspace.organisation_id=service_accounts.organisation_id
      AND account_has_workspace_permission(workspace.id,'service_accounts.manage')
  ))
);

DROP POLICY service_account_owners_credential_manager ON service_account_owners;
CREATE POLICY service_account_owners_credential_manager ON service_account_owners USING(EXISTS(
  SELECT 1 FROM service_accounts service
  WHERE service.id=service_account_id AND (
    (service.workspace_id IS NOT NULL AND account_has_workspace_permission(service.workspace_id,'service_accounts.manage'))
    OR EXISTS(SELECT 1 FROM service_account_role_assignments assignment WHERE assignment.service_account_id=service.id AND account_has_workspace_permission(assignment.workspace_id,'service_accounts.manage'))
  )
));

CREATE OR REPLACE FUNCTION require_service_account_owner_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status<>'revoked' AND NOT EXISTS(
    SELECT 1 FROM service_account_owners owner JOIN accounts account ON account.id=owner.account_id
    WHERE owner.service_account_id=NEW.id AND account.account_kind='human'
  ) THEN RAISE EXCEPTION 'service_account_human_owner_required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION require_service_account_owner_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id uuid:=COALESCE(NEW.service_account_id,OLD.service_account_id);
BEGIN
  IF EXISTS(SELECT 1 FROM service_accounts WHERE id=target_id AND status<>'revoked') AND NOT EXISTS(
    SELECT 1 FROM service_account_owners owner JOIN accounts account ON account.id=owner.account_id
    WHERE owner.service_account_id=target_id AND account.account_kind='human'
  ) THEN RAISE EXCEPTION 'service_account_human_owner_required';
  END IF;
  RETURN COALESCE(NEW,OLD);
END;
$$;
