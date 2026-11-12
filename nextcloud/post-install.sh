#!/bin/bash
# Post-install: trim Nextcloud down to a Dropbox/Google Drive replacement (files only).
# Run once after the first `mc nextcloud u` finishes installing:
#   ./post-install.sh
# Safe to re-run. Apps that don't exist in this version are skipped.

OCC=(docker exec -u www-data nextcloud php occ)

"${OCC[@]}" status >/dev/null || { echo "nextcloud container not ready"; exit 1; }

# ─── Disable everything that isn't file sync/share ───
# Kept: files, files_sharing, files_versions, files_trashbin, files_pdfviewer, viewer,
#       text (open .md/.txt in the browser), activity, notifications, password_policy,
#       privacy, theming, settings, logreader, serverinfo, twofactor_totp.
# Note: the core "dav" app can't be disabled; desktop/mobile clients sync files over WebDAV.
DISABLE=(
  dashboard weather_status user_status
  photos                                  # Immich owns photos
  contactsinteraction circles             # contacts / teams
  recommendations related_resources
  firstrunwizard nextcloud_announcements survey_client support
  sharebymail                             # no SMTP configured
  federation                              # no sharing with other Nextcloud servers
  app_api                                # external app runtime (AI etc.)
  office webhook_listeners
  systemtags comments
)
for APP in "${DISABLE[@]}"; do
  if "${OCC[@]}" app:list --output=json | grep -q "\"${APP}\""; then
    "${OCC[@]}" app:disable "${APP}" || echo "could not disable ${APP}"
  fi
done

# ─── Core apps that can't be disabled: turn their features off instead ───
# federatedfilesharing: no shares to/from other Nextcloud servers
# lookup_server_connector: don't publish or query profiles on lookup.nextcloud.com
for KEY in outgoing_server2server_share_enabled incoming_server2server_share_enabled \
           outgoing_server2server_group_share_enabled incoming_server2server_group_share_enabled \
           lookupServerEnabled lookupServerUploadEnabled; do
  "${OCC[@]}" config:app:set files_sharing "${KEY}" --value=no || exit 1
done

# ─── Background jobs via the nextcloud-cron container ───
"${OCC[@]}" background:cron || exit 1

# ─── Housekeeping ───
"${OCC[@]}" config:system:set default_phone_region --value=US || exit 1
"${OCC[@]}" config:system:set maintenance_window_start --type=integer --value=7 || exit 1  # 07:00 UTC = 02:00 ET
"${OCC[@]}" db:add-missing-indices || exit 1
"${OCC[@]}" maintenance:repair --include-expensive || exit 1

"${OCC[@]}" app:list --enabled
