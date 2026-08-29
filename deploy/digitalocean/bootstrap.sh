#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(id -u)" != "0" ]]; then
  echo "Run this once as root: sudo ./bootstrap.sh" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "This bootstrap requires Ubuntu 22.04, 24.04, or 26.04." >&2
  exit 1
fi

. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "This bootstrap is intended for Ubuntu, not '${ID:-unknown}'." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  architecture="$(dpkg --print-architecture)"
  codename="${UBUNTU_CODENAME:-$VERSION_CODENAME}"
  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $codename
Components: stable
Architectures: $architecture
Signed-By: /etc/apt/keyrings/docker.asc
EOF

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

systemctl enable --now docker
install -d -m 0755 /opt/sandbox
install -d -m 0750 -o 65532 -g 65532 /opt/sandbox/data /opt/sandbox/automation

docker version >/dev/null
docker compose version
echo "Droplet ready. Allow inbound TCP 22, 80, and 443 (plus UDP 443 for HTTP/3) in the DigitalOcean firewall."
