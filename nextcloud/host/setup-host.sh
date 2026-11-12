#!/bin/bash
# One-time host setup for Nextcloud's NAS mount. Run with sudo:
#   sudo ./setup-host.sh
# Prerequisite (DSM): an NFS rule for 192.168.0.27 on the "nextcloud" shared folder:
# read/write, Squash "No mapping", "Allow connections from non-privileged ports" ticked.

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOUNT_DIR="/mnt/nextcloud"
[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }

# ─── NFS client ───
apt-get install -y nfs-common || exit 1

# ─── Mountpoint: empty and immutable, so nothing can write to local disk if unmounted ───
if mountpoint -q "${MOUNT_DIR}"; then
  echo "${MOUNT_DIR} is already mounted; skipping chattr"
else
  mkdir -p "${MOUNT_DIR}" || exit 1
  chattr +i "${MOUNT_DIR}" || exit 1
fi

# ─── systemd units ───
install -m 644 "${BASE_DIR}/mnt-nextcloud.mount" /etc/systemd/system/ || exit 1
install -d /etc/systemd/system/docker.service.d || exit 1
install -m 644 "${BASE_DIR}/docker-nas-mounts.conf" /etc/systemd/system/docker.service.d/nas-mounts.conf || exit 1
systemctl daemon-reload || exit 1
systemctl enable --now mnt-nextcloud.mount || exit 1

# ─── Verify ───
mountpoint -q "${MOUNT_DIR}" || { echo "${MOUNT_DIR} did not mount"; exit 1; }

# ─── Data dir owned by the container's www-data (uid 33), as Nextcloud requires ───
chown 33:33 "${MOUNT_DIR}" || exit 1
chmod 0770 "${MOUNT_DIR}" || exit 1

df -h "${MOUNT_DIR}"
echo "Done. Docker picks up the drop-in on its next restart; no restart is needed now."
