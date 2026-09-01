export function publicAppOrigin(redirectUri: string | undefined): string {
  if (!redirectUri) throw new Error("OIDC_REDIRECT_URI is required");

  const url = new URL(redirectUri);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("OIDC_REDIRECT_URI must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("OIDC_REDIRECT_URI must not contain credentials");
  }

  return url.origin;
}
