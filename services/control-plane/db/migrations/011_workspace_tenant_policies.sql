CREATE OR REPLACE FUNCTION account_can_access_organisation(target uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM memberships membership WHERE membership.organisation_id=target AND membership.account_id=app_account_id() AND membership.status='active')
$$;

ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE protected_variables ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_approval_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_connection_runner_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_visibility_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_checkout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY environment_workspace_member ON environments USING (account_can_access_workspace(workspace_id));
CREATE POLICY protected_variable_workspace_member ON protected_variables USING (EXISTS(SELECT 1 FROM environments environment WHERE environment.id=environment_id AND account_can_access_workspace(environment.workspace_id)));
CREATE POLICY workflow_approval_workspace_member ON workflow_approvals USING (account_can_access_workspace(workspace_id));
CREATE POLICY workflow_vote_workspace_member ON workflow_approval_votes USING (EXISTS(SELECT 1 FROM workflow_approvals approval WHERE approval.id=approval_id AND account_can_access_workspace(approval.workspace_id)));
CREATE POLICY shared_connection_workspace_member ON shared_connections USING (account_can_access_workspace(workspace_id));
CREATE POLICY connection_deployment_workspace_member ON shared_connection_runner_deployments USING (EXISTS(SELECT 1 FROM shared_connections connection WHERE connection.id=connection_id AND account_can_access_workspace(connection.workspace_id)));
CREATE POLICY governance_workspace_member ON governance_policies USING (account_can_access_workspace(workspace_id));
CREATE POLICY installation_owner_member ON plugin_installations USING ((owner_type='personal' AND owner_id=app_account_id()) OR (owner_type='workspace' AND account_can_access_workspace(owner_id)));
CREATE POLICY plugin_visibility_workspace_member ON plugin_visibility_workspaces USING (account_can_access_workspace(workspace_id));
CREATE POLICY checkout_owner_member ON marketplace_checkout_sessions USING ((owner_type='personal' AND owner_id=app_account_id()) OR (owner_type='workspace' AND account_can_access_workspace(owner_id)));
