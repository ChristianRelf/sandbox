# Team permission matrix

Sandbox evaluates explicit permissions against a concrete workspace resource. Role names are only default permission bundles; API routes never authorize by hiding UI controls or comparing a role-name string.

| Permission area | Owner | Administrator | Developer | Operator | Viewer |
| --- | --- | --- | --- | --- | --- |
| Billing, organisation deletion, owner assignment, security | Yes | No | No | No | No |
| Members and invitations | Yes | Yes | No | No | No |
| Plugins and runner administration | Yes | Yes | Private development/request only | No | No |
| Shared connections | Manage/use | Manage/use | Use | Use | No |
| Create, edit and test workflows | Yes | Yes | Yes | No | No |
| Run and pause workflows | Yes | Yes | Test only | Yes | No |
| Approve and publish workflow revisions | Yes | Yes | No | Approvals only | No |
| View workflow and run summaries | Yes | Yes | Yes | Yes | Yes |
| Detailed execution history | Yes | Yes | No | No | No |
| Audit, webhook and governance administration | Yes | Yes | No | No | No |

Owner assignment requires `organisation.owners.manage`, which is distinct from `members.manage`. Owners cannot be removed through the ordinary workspace-member endpoint; ownership must first be transferred or removed through an organisation-level operation.

Shared resources carry an explicit `(ownerType, ownerId)` tuple. Personal-local workflows are not inferred to belong to a workspace after sign-in. Invitations expose no workspace data until the one-time token is accepted by the invited email address.

## Workflow publication

An edit creates or advances the current draft revision. The published revision pointer remains unchanged until this sequence succeeds:

1. Submit the exact current draft for approval.
2. Collect the workspace policy's required number of distinct approval votes.
3. Verify that every exact plugin ID/version/integrity requirement is enabled for the workspace.
4. Publish with a change summary.

Rejection returns the revision to a rejected state with a reason. Rollback selects a previously published revision and records both the previous and restored revision in the append-only audit log.

