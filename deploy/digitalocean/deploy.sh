#!/usr/bin/env bash
set -Eeuo pipefail

version="${1:-}"
deployment="${2:-website}"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$ ]]; then
  echo "Usage: ./deploy.sh VERSION [website|website+observability|website+runner|all]" >&2
  exit 2
fi

case "$deployment" in
  website|website+observability|website+runner|all) ;;
  *)
    echo "Unknown deployment target '$deployment'." >&2
    exit 2
    ;;
esac

deployment_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$deployment_root"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine and the Docker Compose plugin are required. Run ./bootstrap.sh first." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
fi

previous_version="$(sed -n 's/^SANDBOX_VERSION=//p' .env | tail -n 1)"
release_manifest_url() {
  printf 'https://github.com/ChristianRelf/sandbox/releases/download/v%s/release-manifest.json' "$1"
}
compose=(docker compose --env-file .env -f compose.yml)
services=(website docs account caddy)

for variable in OIDC_AUTHORIZE_URL OIDC_TOKEN_URL OIDC_CLIENT_ID OIDC_REDIRECT_URI OIDC_AUDIENCE; do
  if ! grep -Eq "^${variable}=.+" .env || grep -Eq "^${variable}=.*YOUR_" .env; then
    echo "$variable must be configured in .env before deploying the account portal." >&2
    exit 1
  fi
done

if [[ "$deployment" == "website+observability" || "$deployment" == "all" ]]; then
  for variable in GRAFANA_CLOUD_OTLP_ENDPOINT GRAFANA_CLOUD_INSTANCE_ID GRAFANA_CLOUD_API_KEY; do
    if ! grep -Eq "^${variable}=.+" .env; then
      echo "$variable must be configured in .env before enabling observability." >&2
      exit 1
    fi
  done
  compose+=(--profile observability)
  services+=(alloy)
fi

if [[ "$deployment" == "website+runner" || "$deployment" == "all" ]]; then
  if [[ ! -f runner.toml ]]; then
    echo "Copy runner.toml.example to runner.toml and replace its placeholders before enabling the runner." >&2
    exit 1
  fi
  if grep -Eq 'example\.com|replace-with-' runner.toml; then
    echo "runner.toml still contains example values." >&2
    exit 1
  fi
  install -d -m 0750 data automation
  if [[ "$(id -u)" == "0" ]]; then
    chown 65532:65532 data automation
  fi
  compose+=(--profile runner)
  services+=(runner)
fi

rollback() {
  local exit_code=$?
  trap - ERR
  echo "Deployment failed; restoring the previous public-site version." >&2
  if [[ "$previous_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$ ]]; then
    previous_manifest_url="$(release_manifest_url "$previous_version")"
    if SANDBOX_VERSION="$previous_version" SANDBOX_RELEASE_MANIFEST_URL="$previous_manifest_url" "${compose[@]}" pull docs account >/dev/null 2>&1; then
      SANDBOX_VERSION="$previous_version" SANDBOX_RELEASE_MANIFEST_URL="$previous_manifest_url" "${compose[@]}" up -d website docs account caddy || true
    else
      SANDBOX_VERSION="$previous_version" SANDBOX_RELEASE_MANIFEST_URL="$previous_manifest_url" "${compose[@]}" up -d website || true
      "${compose[@]}" stop docs account || true
      "${compose[@]}" up -d --no-deps caddy || true
    fi
  fi
  "${compose[@]}" ps || true
  "${compose[@]}" logs --tail=100 website docs account caddy || true
  exit "$exit_code"
}
trap rollback ERR

export SANDBOX_VERSION="$version"
export SANDBOX_RELEASE_MANIFEST_URL="$(release_manifest_url "$version")"
"${compose[@]}" config --quiet
"${compose[@]}" pull "${services[@]}"
"${compose[@]}" up -d --wait --wait-timeout 180 "${services[@]}"
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-connrefused http://127.0.0.1:3100/ >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-connrefused http://127.0.0.1:3200/ >/dev/null
curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-connrefused http://127.0.0.1:3300/ >/dev/null

if grep -q '^SANDBOX_VERSION=' .env; then
  sed -i "s/^SANDBOX_VERSION=.*/SANDBOX_VERSION=$version/" .env
else
  printf '\nSANDBOX_VERSION=%s\n' "$version" >> .env
fi
if grep -q '^SANDBOX_RELEASE_MANIFEST_URL=' .env; then
  sed -i "s|^SANDBOX_RELEASE_MANIFEST_URL=.*|SANDBOX_RELEASE_MANIFEST_URL=$SANDBOX_RELEASE_MANIFEST_URL|" .env
else
  printf 'SANDBOX_RELEASE_MANIFEST_URL=%s\n' "$SANDBOX_RELEASE_MANIFEST_URL" >> .env
fi

trap - ERR
"${compose[@]}" ps
echo "Sandbox $version is healthy. Caddy will serve https://${SANDBOX_DOMAIN:-sndbox.app}, https://${SANDBOX_DOCS_DOMAIN:-docs.sndbox.app}, and https://${SANDBOX_APP_DOMAIN:-app.sndbox.app}."
