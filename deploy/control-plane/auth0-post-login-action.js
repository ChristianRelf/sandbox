const { randomUUID } = require("crypto");

const audience = "https://api.sndbox.app";
const namespace = "https://sndbox.app/claims";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

exports.onExecutePostLogin = async (event, api) => {
  const resourceServerIdentifier = event.resource_server?.identifier;
  if (resourceServerIdentifier && resourceServerIdentifier !== audience) return;

  let accountId = event.user.app_metadata?.sandbox_account_id;
  if (typeof accountId !== "string" || !uuidPattern.test(accountId)) {
    accountId = randomUUID();
    api.user.setAppMetadata("sandbox_account_id", accountId);
  }

  const sessionId = event.session?.id
    ?? event.refresh_token?.session_id
    ?? event.refresh_token?.device?.session_id
    ?? event.refresh_token?.id
    ?? randomUUID();
  const permissions = Array.isArray(event.authorization?.permissions)
    ? event.authorization.permissions.filter(permission => typeof permission === "string")
    : [];

  api.accessToken.setCustomClaim(`${namespace}/account_id`, accountId);
  api.accessToken.setCustomClaim(`${namespace}/session_id`, sessionId);
  api.accessToken.setCustomClaim(`${namespace}/email`, event.user.email);
  api.accessToken.setCustomClaim(`${namespace}/email_verified`, event.user.email_verified === true);
  api.accessToken.setCustomClaim(`${namespace}/platform_permissions`, permissions);
};
