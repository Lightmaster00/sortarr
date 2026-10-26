#!/bin/sh
set -e

# Unraid : nobody:users = 99:100
PUID=${PUID:-99}
PGID=${PGID:-100}

case "$PUID" in ''|*[!0-9]*) echo "PUID doit être un nombre (reçu '$PUID')." >&2; exit 1 ;; esac
case "$PGID" in ''|*[!0-9]*) echo "PGID doit être un nombre (reçu '$PGID')." >&2; exit 1 ;; esac

if { [ "$PUID" = "0" ] || [ "$PGID" = "0" ]; } && [ "${ALLOW_ROOT:-false}" != "true" ]; then
  echo "Refus de tourner en root (PUID=$PUID, PGID=$PGID). Mets un utilisateur non privilégié, ou ALLOW_ROOT=true." >&2
  exit 1
fi

CONFIG_DIR=${SORTARR_CONFIG_DIR:-/config}
mkdir -p "$CONFIG_DIR"

# Seul /config change de propriétaire, et seulement si nécessaire.
# -h : un lien symbolique dans /config n'est jamais suivi, donc un lien vers /media ne change pas les droits du NAS.
# /media n'est jamais modifié ici : les droits du NAS restent ceux de l'utilisateur.
OWNER=$(ls -nd "$CONFIG_DIR" | awk '{print $3":"$4}')
if [ "$OWNER" != "$PUID:$PGID" ]; then
  chown -R -h "$PUID:$PGID" "$CONFIG_DIR"
fi

umask "${UMASK:-022}"
exec su-exec "$PUID:$PGID" node .output/server/index.mjs
