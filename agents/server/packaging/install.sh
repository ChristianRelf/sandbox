#!/usr/bin/env sh
set -eu

runner_user="sandbox-runner"
runner_group="sandbox-runner"
binary_path="/usr/local/bin/sandbox-runner"
config_directory="/etc/sandbox-runner"
config_path="$config_directory/config.toml"
data_directory="/var/lib/sandbox-runner"
unit_path="/etc/systemd/system/sandbox-runner.service"
install_root="${DESTDIR:-}"

package_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

fail() {
  printf 'sandbox-runner install: %s\n' "$*" >&2
  exit 1
}

target() {
  printf '%s%s\n' "$install_root" "$1"
}

if [ "$(uname -s)" != "Linux" ] && [ -z "$install_root" ]; then
  fail "the standalone runner supports Linux only"
fi

if [ -z "$install_root" ] && [ "$(id -u)" -ne 0 ]; then
  fail "run this installer as root (for example: sudo ./install.sh)"
fi

for required_file in sandbox-runner config.example.toml sandbox-runner.service; do
  [ -f "$package_directory/$required_file" ] || fail "$required_file is missing from the extracted archive"
done
[ -x "$package_directory/sandbox-runner" ] || fail "sandbox-runner is not executable"

if [ -z "$install_root" ]; then
  if ! getent group "$runner_group" >/dev/null 2>&1; then
    if command -v groupadd >/dev/null 2>&1; then
      groupadd --system "$runner_group"
    elif command -v addgroup >/dev/null 2>&1; then
      addgroup --system "$runner_group"
    else
      fail "groupadd or addgroup is required to create the service account"
    fi
  fi

  if ! id "$runner_user" >/dev/null 2>&1; then
    nologin_shell="/bin/false"
    [ -x /usr/sbin/nologin ] && nologin_shell="/usr/sbin/nologin"
    [ -x /sbin/nologin ] && nologin_shell="/sbin/nologin"
    if command -v useradd >/dev/null 2>&1; then
      useradd --system --gid "$runner_group" --home-dir "$data_directory" \
        --shell "$nologin_shell" --comment "sndbox workflow runner" "$runner_user"
    elif command -v adduser >/dev/null 2>&1; then
      adduser --system --ingroup "$runner_group" --home "$data_directory" \
        --shell "$nologin_shell" --disabled-password "$runner_user"
    else
      fail "useradd or adduser is required to create the service account"
    fi
  fi
fi

binary_target=$(target "$binary_path")
config_directory_target=$(target "$config_directory")
config_target=$(target "$config_path")
data_target=$(target "$data_directory")
unit_target=$(target "$unit_path")

mkdir -p "$(dirname -- "$binary_target")" "$config_directory_target" \
  "$data_target/plugins" "$(dirname -- "$unit_target")"

# Replace the executable atomically so an upgrade cannot truncate a running binary.
binary_temporary="${binary_target}.new.$$"
trap 'rm -f -- "$binary_temporary"' EXIT HUP INT TERM
cp -- "$package_directory/sandbox-runner" "$binary_temporary"
chmod 0755 "$binary_temporary"
mv -f -- "$binary_temporary" "$binary_target"
trap - EXIT HUP INT TERM

if [ ! -e "$config_target" ]; then
  cp -- "$package_directory/config.example.toml" "$config_target"
  printf 'Installed example configuration at %s\n' "$config_path"
else
  printf 'Preserved existing configuration at %s\n' "$config_path"
fi

cp -- "$package_directory/sandbox-runner.service" "$unit_target"
chmod 0750 "$config_directory_target"
chmod 0640 "$config_target"
chmod 0700 "$data_target" "$data_target/plugins"
chmod 0644 "$unit_target"

if [ -z "$install_root" ]; then
  chown root:"$runner_group" "$config_directory_target" "$config_target"
  chown -R "$runner_user":"$runner_group" "$data_target"
  chown root:root "$binary_target" "$unit_target"

  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    systemctl daemon-reload
  fi
fi

printf '\nInstalled sandbox-runner at %s.\n' "$binary_path"
printf 'Next: run "sudo sandbox-runner" for guided setup, pairing, and health checks.\n'
printf 'Linux guide: https://docs.sndbox.app/linux\n'
