import type {
  AccountOrganisation,
  AccountSession,
  OrganisationRole,
  ProductAccountSummary,
  ScimToken,
  SsoConnection,
  TokenSummary,
  WorkflowApproval,
  WorkspaceMember,
} from "@sandbox/api-client";
import { launchRelease } from "@sandbox/content";
import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  CircleAlert,
  Cloud,
  KeyRound,
  LifeBuoy,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { authenticatedClient } from "../../lib/auth";
import {
  createOrganisationAction,
  createRoleAction,
  createSsoConnectionAction,
  decideApprovalAction,
  inviteMemberAction,
  publishWorkflowAction,
  revokeScimTokenAction,
  revokeSessionAction,
  transitionDeploymentAction,
} from "../actions";
import { ScimTokenForm } from "../ScimTokenForm";

export const dynamic = "force-dynamic";
type Params = Promise<{ section: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const staticSections: Record<
  string,
  { title: string; description: string; items: string[] }
> = {
  downloads: {
    title: "Downloads",
    description: "Access signed releases allowed by your account.",
    items: [
      "Stable, preview and development channels",
      "Checksums and signatures",
      "Platform and architecture selection",
    ],
  },
  releases: {
    title: "Releases",
    description: "Review release notes and update policy before installing.",
    items: [
      `Sandbox ${launchRelease.version} · ${launchRelease.channel}`,
      launchRelease.summary,
      "Signed desktop, Linux agent and OCI-image pipeline",
    ],
  },
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { section } = await params;
  const query = await searchParams;
  const api = await authenticatedClient();
  if (!api)
    return (
      <Unavailable message="Your account session is unavailable. Sign in again." />
    );
  if (section === "organisations")
    return <OrganisationsPage api={api} query={query} />;
  if (section === "security") return <SecurityPage api={api} />;
  if (section === "usage") return <UsagePage api={api} query={query} />;
  if (section === "licences" || section === "purchases")
    return <CommercePage api={api} section={section} />;
  if (section === "settings") return <SettingsPage api={api} />;
  if (section === "support") return <SupportPage api={api} query={query} />;
  const page = staticSections[section];
  if (!page) notFound();
  return (
    <main className="portal-page">
      <PageHead
        eyebrow="ACCOUNT"
        title={page.title}
        description={page.description}
      />
      {section === "downloads" && (
        <section className="blocked-notice">
          <CircleAlert />
          <div>
            <strong>No entitlement-aware release manifest</strong>
            <p>
              The build pipeline signs artifacts, but customer download grants
              remain disabled until a release manifest is published.
            </p>
          </div>
        </section>
      )}
      <section className="section-list">
        <header>
          <h2>
            {section === "releases" ? "Current release" : "Release controls"}
          </h2>
          <span>Verified product metadata</span>
        </header>
        {page.items.map((item) => (
          <article key={item}>
            <span>{section === "releases" ? <CheckCircle2 /> : <CircleAlert />}</span>
            <strong>{item}</strong>
          </article>
        ))}
      </section>
      {section === "releases" && (
        <a className="cross-link" href="https://sndbox.app/changelog">
          Open public changelog <ArrowRight />
        </a>
      )}
    </main>
  );
}

async function OrganisationsPage({
  api,
  query,
}: {
  api: NonNullable<Awaited<ReturnType<typeof authenticatedClient>>>;
  query: Record<string, string | string[] | undefined>;
}) {
  const organisations = (await api.listAccountOrganisations()).data.items;
  const selected = selectWorkspace(organisations, query.workspaceId);
  const workspaceId = selected?.id;
  const organisation = organisations.find((item) =>
    item.workspaces.some((workspace) => workspace.id === workspaceId),
  );
  const results = workspaceId
    ? await Promise.allSettled([
        api.listWorkspaceMembers(workspaceId),
        api.listWorkspaceRunners(workspaceId),
        api.listWorkflowApprovals(workspaceId, "all"),
        api.listDeployments(workspaceId),
        api.listRunnerPools(workspaceId),
        api.listWorkspaceEnvironments(workspaceId),
        api.getWorkspaceGovernance(workspaceId),
      ])
    : [];
  const members = value<{ items: WorkspaceMember[] }>(results[0])?.items ?? [];
  const runners =
    value<{ items: Array<Record<string, unknown>> }>(results[1])?.items ?? [];
  const approvals =
    value<{ items: WorkflowApproval[] }>(results[2])?.items ?? [];
  const deployments =
    value<{ items: Array<Record<string, unknown>> }>(results[3])?.items ?? [];
  const pools =
    value<{ items: Array<Record<string, unknown>> }>(results[4])?.items ?? [];
  const environments =
    value<{ items: Array<{ environmentId: string; environment: string }> }>(
      results[5],
    )?.items ?? [];
  const governance =
    value<{ policies: Record<string, unknown> }>(results[6])?.policies ?? {};
  const enterprise = organisation
    ? await Promise.allSettled([
        api.listOrganisationRoles(organisation.id),
        api.listSsoConnections(organisation.id),
        api.listScimTokens(organisation.id),
      ])
    : [];
  const roles =
    value<{ items: OrganisationRole[] }>(enterprise[0])?.items ?? [];
  const sso = value<{ items: SsoConnection[] }>(enterprise[1])?.items ?? [];
  const scim = value<{ items: ScimToken[] }>(enterprise[2])?.items ?? [];
  return (
    <main className="portal-page">
      <PageHead
        eyebrow="TEAM OPERATIONS"
        title="Organisations"
        description="Manage real workspace membership, reviews, runners and deployments."
      />
      <section className="workspace-switcher">
        <form method="get">
          <label>
            Workspace
            <select name="workspaceId" defaultValue={workspaceId}>
              {organisations.flatMap((org) =>
                org.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {org.name} / {workspace.name} · {workspace.role}
                  </option>
                )),
              )}
            </select>
          </label>
          <button className="portal-primary">Open workspace</button>
        </form>
      </section>
      {!workspaceId ? (
        <section className="live-panel">
          <header>
            <div>
              <Building2 />
              <span>
                <strong>Create your first organisation</strong>
                <small>
                  A default workspace and three environments are provisioned
                  together.
                </small>
              </span>
            </div>
          </header>
          <form action={createOrganisationAction} className="portal-form">
            <label>
              Name
              <input name="name" required minLength={2} maxLength={100} />
            </label>
            <label>
              Slug
              <input
                name="slug"
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                maxLength={63}
              />
            </label>
            <button className="portal-primary">Create</button>
          </form>
        </section>
      ) : (
        <>
          <section className="operations-grid">
            <Metric icon={<Users />} label="Members" value={members.length} />
            <Metric icon={<Server />} label="Runners" value={runners.length} />
            <Metric
              icon={<ShieldCheck />}
              label="Pending reviews"
              value={
                approvals.filter((item) => item.status === "pending").length
              }
            />
            <Metric
              icon={<Cloud />}
              label="Deployments"
              value={deployments.length}
            />
          </section>
          <section className="live-panel">
            <header>
              <div>
                <Users />
                <span>
                  <strong>Members</strong>
                  <small>
                    Workspace roles are enforced at every API operation.
                  </small>
                </span>
              </div>
            </header>
            <div className="live-list">
              {members.map((member) => (
                <article key={member.accountId}>
                  <div>
                    <strong>{member.displayName}</strong>
                    <small>{member.email}</small>
                  </div>
                  <span className="status-pill">{member.role}</span>
                </article>
              ))}
              {!members.length && <EmptyRow text="No members were returned." />}
            </div>
            <form action={inviteMemberAction} className="portal-form compact">
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <label>
                Email
                <input type="email" name="email" required />
              </label>
              <label>
                Role
                <select name="role" defaultValue="developer">
                  <option>developer</option>
                  <option>operator</option>
                  <option>viewer</option>
                  <option>administrator</option>
                </select>
              </label>
              <button className="portal-primary">Invite member</button>
            </form>
          </section>
          <section className="live-panel">
            <header>
              <div>
                <ShieldCheck />
                <span>
                  <strong>Publication reviews</strong>
                  <small>
                    Approve an exact immutable revision before publishing it.
                  </small>
                </span>
              </div>
            </header>
            <div className="live-list">
              {approvals.map((approval) => (
                <article key={approval.approvalId} className="approval-row">
                  <div>
                    <strong>{approval.workflowId}</strong>
                    <small>
                      {approval.status} · {approval.approvalCount}/
                      {approval.requiredApprovals} approvals
                    </small>
                  </div>
                  {approval.status === "pending" && (
                    <form action={decideApprovalAction}>
                      <input
                        type="hidden"
                        name="workspaceId"
                        value={workspaceId}
                      />
                      <input
                        type="hidden"
                        name="approvalId"
                        value={approval.approvalId}
                      />
                      <input name="reason" placeholder="Review note" />
                      <button name="decision" value="approved">
                        Approve
                      </button>
                      <button name="decision" value="rejected">
                        Reject
                      </button>
                    </form>
                  )}
                  {approval.status === "approved" && (
                    <form action={publishWorkflowAction}>
                      <input
                        type="hidden"
                        name="workspaceId"
                        value={workspaceId}
                      />
                      <input
                        type="hidden"
                        name="workflowId"
                        value={approval.workflowId}
                      />
                      <input
                        type="hidden"
                        name="revisionId"
                        value={approval.revisionId}
                      />
                      <input
                        name="changeSummary"
                        placeholder="Change summary"
                        required
                      />
                      <button>Publish</button>
                    </form>
                  )}
                  <span className={`status-pill ${approval.status}`}>
                    {approval.status}
                  </span>
                </article>
              ))}
              {!approvals.length && (
                <EmptyRow text="No publication reviews yet." />
              )}
            </div>
          </section>
          <section className="two-panel-grid">
            <DataPanel
              icon={<Server />}
              title="Runner pools"
              rows={pools.map((pool) => [
                String(pool.name),
                `${String(pool.status)} · ${String(pool.memberCount)} members`,
              ])}
              empty="No runner pools configured."
            />
            <DeploymentPanel
              workspaceId={workspaceId}
              deployments={deployments}
            />
            <DataPanel
              icon={<Activity />}
              title="Environments"
              rows={environments.map((environment) => [
                environment.environment,
                environment.environmentId,
              ])}
              empty="No environments returned."
            />
            <DataPanel
              icon={<ShieldCheck />}
              title="Governance"
              rows={Object.entries(governance).map(([key, item]) => [
                key,
                JSON.stringify(item),
              ])}
              empty="Workspace defaults are active."
            />
          </section>
          {organisation && (
            <section className="enterprise-admin">
              <header>
                <p>ENTERPRISE IDENTITY</p>
                <h2>Roles, SSO and SCIM</h2>
                <span>
                  Owner-only controls; mutations require a fresh passkey or
                  multi-factor session where appropriate.
                </span>
              </header>
              <div className="two-panel-grid">
                <section className="live-panel">
                  <header>
                    <div>
                      <Users />
                      <span>
                        <strong>Organisation roles</strong>
                        <small>{roles.length} roles configured</small>
                      </span>
                    </div>
                  </header>
                  <div className="live-list">
                    {roles.map((role) => (
                      <article key={role.id}>
                        <div>
                          <strong>{role.displayName}</strong>
                          <small>
                            {role.builtIn ? "Built in" : "Custom"} ·{" "}
                            {role.permissions.length} permissions
                          </small>
                        </div>
                        <span className="status-pill">{role.key}</span>
                      </article>
                    ))}
                  </div>
                  <form
                    action={createRoleAction}
                    className="portal-form role-form"
                  >
                    <input
                      type="hidden"
                      name="organisationId"
                      value={organisation.id}
                    />
                    <label>
                      Role key
                      <input
                        name="key"
                        required
                        pattern="[a-z][a-z0-9_]{1,62}"
                      />
                    </label>
                    <label>
                      Display name
                      <input name="displayName" required />
                    </label>
                    <fieldset>
                      <legend>Permissions</legend>
                      <label>
                        <input
                          type="checkbox"
                          name="permission"
                          value="workflows.view"
                          defaultChecked
                        />
                        View
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          name="permission"
                          value="workflows.run"
                        />
                        Run
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          name="permission"
                          value="workflows.approve"
                        />
                        Approve
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          name="permission"
                          value="audit.view"
                        />
                        Audit
                      </label>
                    </fieldset>
                    <button className="portal-primary">Create role</button>
                  </form>
                </section>
                <section className="live-panel">
                  <header>
                    <div>
                      <KeyRound />
                      <span>
                        <strong>SSO connections</strong>
                        <small>OIDC or SAML configuration metadata</small>
                      </span>
                    </div>
                  </header>
                  <div className="live-list">
                    {sso.map((connection) => (
                      <article key={connection.id}>
                        <div>
                          <strong>{connection.displayName}</strong>
                          <small>
                            {connection.connectionType.toUpperCase()} ·{" "}
                            {connection.issuerUrl}
                          </small>
                        </div>
                        <span className="status-pill">
                          {connection.enabled ? "enabled" : "disabled"}
                        </span>
                      </article>
                    ))}
                    {!sso.length && <EmptyRow text="No SSO connections." />}
                  </div>
                  <form
                    action={createSsoConnectionAction}
                    className="portal-form sso-form"
                  >
                    <input
                      type="hidden"
                      name="organisationId"
                      value={organisation.id}
                    />
                    <label>
                      Type
                      <select name="connectionType">
                        <option value="oidc">OIDC</option>
                        <option value="saml">SAML</option>
                      </select>
                    </label>
                    <label>
                      Name
                      <input name="displayName" required />
                    </label>
                    <label>
                      Issuer / metadata URL
                      <input
                        type="url"
                        name="issuerUrl"
                        required
                        placeholder="https://identity.example.com"
                      />
                    </label>
                    <label>
                      Client / entity ID
                      <input name="clientIdentifier" required />
                    </label>
                    <label>
                      Verified domains
                      <input
                        name="verifiedDomains"
                        required
                        placeholder="example.com, subsidiary.com"
                      />
                    </label>
                    <button className="portal-primary">
                      Add disabled connection
                    </button>
                  </form>
                </section>
                <section className="live-panel">
                  <header>
                    <div>
                      <KeyRound />
                      <span>
                        <strong>SCIM credentials</strong>
                        <small>Secret material is displayed once</small>
                      </span>
                    </div>
                  </header>
                  <div className="live-list">
                    {scim.map((token) => (
                      <article key={token.id}>
                        <div>
                          <strong>{token.name}</strong>
                          <small>
                            {token.prefix} ·{" "}
                            {token.revokedAt
                              ? "revoked"
                              : `expires ${new Date(token.expiresAt).toLocaleDateString("en-GB")}`}
                          </small>
                        </div>
                        {!token.revokedAt && (
                          <form action={revokeScimTokenAction}>
                            <input
                              type="hidden"
                              name="organisationId"
                              value={organisation.id}
                            />
                            <input
                              type="hidden"
                              name="tokenId"
                              value={token.id}
                            />
                            <button>Revoke</button>
                          </form>
                        )}
                      </article>
                    ))}
                    {!scim.length && <EmptyRow text="No SCIM credentials." />}
                  </div>
                  <ScimTokenForm organisationId={organisation.id} />
                </section>
                <DataPanel
                  icon={<Activity />}
                  title="Audit stream"
                  rows={[
                    [
                      "NDJSON feed",
                      `/v1/workspaces/${workspaceId}/audit/stream`,
                    ],
                  ]}
                  empty=""
                />
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

async function SecurityPage({
  api,
}: {
  api: NonNullable<Awaited<ReturnType<typeof authenticatedClient>>>;
}) {
  const [profile, sessions, tokens] = await Promise.all([
    (await api.getAccountProfile()).data,
    (await api.listAccountSessions()).data.items,
    (await api.listPersonalAccessTokens()).data.items,
  ]);
  return (
    <main className="portal-page">
      <PageHead
        eyebrow="ACCOUNT SECURITY"
        title="Security"
        description="Inspect active sessions and scoped API credentials."
      />
      <section className="plan-banner">
        <div>
          <small>SIGNED IN AS</small>
          <strong>{profile.displayName}</strong>
          <span>{profile.email}</span>
        </div>
        <ShieldCheck />
      </section>
      <section className="two-panel-grid">
        <section className="live-panel">
          <header>
            <div>
              <KeyRound />
              <span>
                <strong>Sessions</strong>
                <small>Revoke devices you no longer recognise.</small>
              </span>
            </div>
          </header>
          <div className="live-list">
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        </section>
        <section className="live-panel">
          <header>
            <div>
              <KeyRound />
              <span>
                <strong>Personal access tokens</strong>
                <small>Token plaintext is shown only when issued.</small>
              </span>
            </div>
          </header>
          <div className="live-list">
            {tokens.map((token) => (
              <TokenRow key={token.id} token={token} />
            ))}
            {!tokens.length && <EmptyRow text="No personal access tokens." />}
          </div>
        </section>
      </section>
    </main>
  );
}

async function UsagePage({
  api,
  query,
}: {
  api: NonNullable<Awaited<ReturnType<typeof authenticatedClient>>>;
  query: Record<string, string | string[] | undefined>;
}) {
  const organisations = (await api.listAccountOrganisations()).data.items,
    workspace = selectWorkspace(organisations, query.workspaceId);
  const activity = workspace
    ? (await api.getWorkspaceActivity(workspace.id, 100)).data
    : null;
  return (
    <main className="portal-page">
      <PageHead
        eyebrow="OPERATIONS"
        title="Usage"
        description="Hosted infrastructure activity is measured separately from unmetered local runs."
      />
      <section className="operations-grid">
        <Metric
          icon={<Activity />}
          label="Recent runs"
          value={activity?.runs.length ?? 0}
        />
        <Metric
          icon={<Server />}
          label="Runners"
          value={activity?.runners.length ?? 0}
        />
        <Metric
          icon={<ShieldCheck />}
          label="Pending approvals"
          value={activity?.pendingApprovalCount ?? 0}
        />
        <Metric
          icon={<CircleAlert />}
          label="Webhook failures"
          value={activity?.webhookFailureCount ?? 0}
        />
      </section>
      <p className="support-fallback">
        Local desktop execution is not sent to the hosted usage ledger.
      </p>
    </main>
  );
}

async function CommercePage({
  api,
  section,
}: {
  api: NonNullable<Awaited<ReturnType<typeof authenticatedClient>>>;
  section: string;
}) {
  const account: ProductAccountSummary = (await api.getProductAccount()).data;
  const items =
    section === "licences" ? account.licences : account.subscriptions;
  return (
    <main className="portal-page">
      <PageHead
        eyebrow="COMMERCE"
        title={section === "licences" ? "Licences" : "Purchases"}
        description="Product subscriptions and licence grants from the commerce service."
      />
      <section className="section-list">
        <header>
          <h2>
            {section === "licences" ? "Active licences" : "Subscriptions"}
          </h2>
          <span>Live account data</span>
        </header>
        {items.map((item) => (
          <article key={item.id}>
            <span>
              <KeyRound />
            </span>
            <strong>{item.planId}</strong>
            <span>{item.status}</span>
          </article>
        ))}
        {!items.length && (
          <article>
            <span>—</span>
            <strong>No records for this account.</strong>
            <span>Local remains available</span>
          </article>
        )}
      </section>
    </main>
  );
}

async function SettingsPage({
  api,
}: {
  api: NonNullable<Awaited<ReturnType<typeof authenticatedClient>>>;
}) {
  const profile = (await api.getAccountProfile()).data;
  return (
    <main className="portal-page">
      <PageHead
        eyebrow="ACCOUNT"
        title="Settings"
        description="Account identity and privacy controls."
      />
      <section className="live-panel">
        <header>
          <div>
            <ShieldCheck />
            <span>
              <strong>{profile.displayName}</strong>
              <small>{profile.email}</small>
            </span>
          </div>
        </header>
        <div className="detail-grid">
          <div>
            <small>Account ID</small>
            <code>{profile.accountId}</code>
          </div>
          <div>
            <small>Current session</small>
            <code>{profile.sessionId}</code>
          </div>
        </div>
        <div className="panel-actions">
          <Link className="portal-primary" href="/security">
            Manage sessions
          </Link>
          <a href="/api/account/export">Export account data</a>
        </div>
      </section>
    </main>
  );
}

async function SupportPage({
  api,
  query,
}: {
  api: NonNullable<Awaited<ReturnType<typeof authenticatedClient>>>;
  query: Record<string, string | string[] | undefined>;
}) {
  const organisations = (await api.listAccountOrganisations()).data.items,
    workspace = selectWorkspace(organisations, query.workspaceId);
  let requests: Array<Record<string, unknown>> = [];
  if (workspace)
    try {
      requests = (
        await api.request<{ items: Array<Record<string, unknown>> }>({
          path: `/v1/workspaces/${workspace.id}/support-access-requests`,
        })
      ).data.items;
    } catch {}
  return (
    <main className="portal-page">
      <PageHead
        eyebrow="SUPPORT"
        title="Support access"
        description="Temporary diagnostic access is explicit, scoped, auditable and revocable."
      />
      <section className="live-panel">
        <header>
          <div>
            <LifeBuoy />
            <span>
              <strong>Diagnostic access requests</strong>
              <small>
                Support cannot collect diagnostics until a workspace
                administrator approves.
              </small>
            </span>
          </div>
        </header>
        <div className="live-list">
          {requests.map((item) => (
            <article key={String(item.id)}>
              <div>
                <strong>{String(item.reason)}</strong>
                <small>
                  {String(item.status)} · expires{" "}
                  {new Date(String(item.expiresAt)).toLocaleString("en-GB")}
                </small>
              </div>
              <span className="status-pill">{String(item.status)}</span>
            </article>
          ))}
          {!requests.length && <EmptyRow text="No support access requests." />}
        </div>
      </section>
      <p className="support-fallback">
        For product questions, use{" "}
        <a href="https://docs.sndbox.app/troubleshooting">
          Sandbox troubleshooting
        </a>
        . Never send credentials or an unreviewed diagnostic bundle.
      </p>
    </main>
  );
}

function PageHead({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="page-head">
      <div>
        <p>{eyebrow}</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
    </header>
  );
}
function selectWorkspace(
  organisations: AccountOrganisation[],
  requested: string | string[] | undefined,
) {
  const workspaces = organisations.flatMap((item) => item.workspaces);
  return (
    workspaces.find(
      (item) =>
        item.id === (Array.isArray(requested) ? requested[0] : requested),
    ) ?? workspaces[0]
  );
}
function value<T>(
  result: PromiseSettledResult<unknown> | undefined,
): T | undefined {
  return result?.status === "fulfilled"
    ? (result.value as { data: T }).data
    : undefined;
}
function Metric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <article>
      {icon}
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </article>
  );
}
function EmptyRow({ text }: { text: string }) {
  return (
    <article className="empty-row">
      <small>{text}</small>
    </article>
  );
}
function DataPanel({
  icon,
  title,
  rows,
  empty,
}: {
  icon: ReactNode;
  title: string;
  rows: string[][];
  empty: string;
}) {
  return (
    <section className="live-panel">
      <header>
        <div>
          {icon}
          <span>
            <strong>{title}</strong>
            <small>Live workspace state</small>
          </span>
        </div>
      </header>
      <div className="live-list">
        {rows.map(([name, detail], index) => (
          <article key={`${name}-${index}`}>
            <div>
              <strong>{name}</strong>
              <small>{detail}</small>
            </div>
          </article>
        ))}
        {!rows.length && <EmptyRow text={empty} />}
      </div>
    </section>
  );
}
function DeploymentPanel({
  workspaceId,
  deployments,
}: {
  workspaceId: string;
  deployments: Array<Record<string, unknown>>;
}) {
  return (
    <section className="live-panel">
      <header>
        <div>
          <Cloud />
          <span>
            <strong>Deployments</strong>
            <small>Pause or resume a validated deployment.</small>
          </span>
        </div>
      </header>
      <div className="live-list">
        {deployments.map((deployment) => {
          const deploymentId = String(
            deployment.deploymentId ?? deployment.id,
          );
          const status = String(deployment.status);
          const nextStatus =
            status === "paused"
              ? "active"
              : status === "active"
                ? "paused"
                : null;
          return (
            <article key={deploymentId}>
              <div>
                <strong>{String(deployment.workflowId)}</strong>
                <small>
                  {String(deployment.environment)} · {status}
                </small>
              </div>
              {nextStatus && (
                <form action={transitionDeploymentAction}>
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input
                    type="hidden"
                    name="deploymentId"
                    value={deploymentId}
                  />
                  <input type="hidden" name="status" value={nextStatus} />
                  <input
                    type="hidden"
                    name="reason"
                    value={`${nextStatus === "paused" ? "Paused" : "Resumed"} from the account portal`}
                  />
                  <button>{nextStatus === "paused" ? "Pause" : "Resume"}</button>
                </form>
              )}
            </article>
          );
        })}
        {!deployments.length && <EmptyRow text="No deployments created." />}
      </div>
    </section>
  );
}
function SessionRow({ session }: { session: AccountSession }) {
  return (
    <article>
      <div>
        <strong>
          {session.deviceName}
          {session.current ? " · current" : ""}
        </strong>
        <small>
          Last seen {new Date(session.lastSeenAt).toLocaleString("en-GB")}
        </small>
      </div>
      {!session.current && (
        <form action={revokeSessionAction}>
          <input type="hidden" name="sessionId" value={session.id} />
          <button>Revoke</button>
        </form>
      )}
    </article>
  );
}
function TokenRow({ token }: { token: TokenSummary }) {
  return (
    <article>
      <div>
        <strong>{token.name}</strong>
        <small>
          {token.prefix} · expires{" "}
          {new Date(token.expiresAt).toLocaleDateString("en-GB")}
        </small>
      </div>
      <span className="status-pill">
        {token.revokedAt ? "revoked" : "active"}
      </span>
    </article>
  );
}
function Unavailable({ message }: { message: string }) {
  return (
    <main className="portal-page">
      <section className="blocked-notice">
        <CircleAlert />
        <div>
          <strong>Account unavailable</strong>
          <p>{message}</p>
        </div>
      </section>
    </main>
  );
}
