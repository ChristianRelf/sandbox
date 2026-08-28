#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "usage: $0 <version>" >&2
  exit 2
fi

version="$1"
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
manifest="$repository_root/agents/server/Cargo.toml"
output="$repository_root/agents/server/dist"
source_date_epoch="${SOURCE_DATE_EPOCH:-0}"

rm -rf "$output"
mkdir -p "$output"

build_archive() {
  local rust_target="$1"
  local archive_architecture="$2"
  local stage
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' RETURN

  cargo zigbuild --locked --release --manifest-path "$manifest" --target "$rust_target"
  install -m 0755 "$repository_root/agents/server/target/$rust_target/release/sandbox-server-runner" "$stage/sandbox-runner"
  tar --sort=name --mtime="@$source_date_epoch" --owner=0 --group=0 --numeric-owner -C "$stage" \
    -czf "$output/sandbox-runner-$version-linux-$archive_architecture.tar.gz" sandbox-runner
}

build_archive x86_64-unknown-linux-gnu x86_64
build_archive aarch64-unknown-linux-gnu aarch64

(
  cd "$output"
  sha256sum ./*.tar.gz > SHA256SUMS
  if [[ "${RELEASE_SIGNING_REQUIRED:-0}" == "1" ]]; then
    if ! command -v cosign >/dev/null 2>&1; then
      echo "cosign is required for a production release." >&2
      exit 1
    fi
    if [[ -n "${COSIGN_KEY:-}" ]]; then
      cosign sign-blob --yes --key "$COSIGN_KEY" --bundle SHA256SUMS.sigstore.json SHA256SUMS
    else
      cosign sign-blob --yes --bundle SHA256SUMS.sigstore.json SHA256SUMS
    fi
    test -s SHA256SUMS.sigstore.json
  elif [[ -n "${COSIGN_KEY:-}" ]]; then
    cosign sign-blob --yes --key "$COSIGN_KEY" --bundle SHA256SUMS.sigstore.json SHA256SUMS
  else
    echo "COSIGN_KEY is unset; created checksums without a Sigstore bundle." >&2
  fi
)
