#!/usr/bin/env bash
# Update only NestJS; keep the running Python process and its current release.
set -Eeuo pipefail
umask 027
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
ROOT=/var/www/cranbourne
NODE="$ROOT/runtime/node24/bin/node"
NPM="$ROOT/runtime/node24/bin/npm"
PM2="$ROOT/runtime/node24/bin/pm2"
SOURCE="$ROOT/repos/booran-metador-replacement"
exec 8>/run/lock/cranbourne-git-update.lock
flock -n 8 || { echo 'Another source update is running.' >&2; exit 1; }
exec 9>/run/lock/cranbourne-deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
[[ -s /etc/cranbourne/backend.env ]] || { echo 'Restore /etc/cranbourne/backend.env first.' >&2; exit 1; }
PREVIOUS=$(readlink -e "$ROOT/current")
[[ $PREVIOUS == "$ROOT/releases/"* && -d $PREVIOUS/backend ]] || { echo 'Invalid active release.' >&2; exit 1; }
AUTOMATION=$(readlink -e "$PREVIOUS/automation")
RELEASE="$ROOT/releases/$(date -u +%Y%m%dT%H%M%S)-backend-$$"
SWITCHED=0
as_app() {
    runuser -u cranbourne -- env HOME=/var/lib/cranbourne PM2_HOME=/var/lib/cranbourne/.pm2 \
        PATH="$ROOT/runtime/node24/bin:/usr/local/bin:/usr/bin:/bin" "$@"
}
restore_on_error() {
    local result=$?
    trap - ERR
    if [[ $SWITCHED == 1 ]]; then
        ln -sfn "$PREVIOUS" "$ROOT/current.rollback"
        mv -Tf "$ROOT/current.rollback" "$ROOT/current"
        as_app "$PM2" startOrRestart "$ROOT/deploy/ecosystem.config.cjs" --update-env || true
        as_app "$PM2" save || true
        echo 'Previous backend release restored.' >&2
    fi
    exit "$result"
}
trap restore_on_error ERR
[[ $(git -C "$SOURCE" remote get-url origin) == https://github.com/macworldgithub/booran-metador-replacement.git ]]
[[ $(git -C "$SOURCE" branch --show-current) == master ]]
[[ -z $(git -C "$SOURCE" status --porcelain) ]] || { echo 'Source checkout has uncommitted changes.' >&2; exit 1; }
GIT_TERMINAL_PROMPT=0 git -C "$SOURCE" pull --ff-only origin master
install -d -o root -g cranbourne -m 0755 "$RELEASE"
install -d -o cranbourne -g cranbourne -m 0755 "$RELEASE/backend"
rsync -a --chown=cranbourne:cranbourne --exclude='.git' --exclude='.env' --exclude='.env.*' \
    --exclude=node_modules --exclude=dist --exclude='*.tsbuildinfo' "$SOURCE/" "$RELEASE/backend/"
as_app "$NPM" --prefix "$RELEASE/backend" ci --include=dev --no-audit --no-fund
as_app "$NPM" --prefix "$RELEASE/backend" run build
as_app "$NPM" --prefix "$RELEASE/backend" test -- --runInBand
[[ -s $RELEASE/backend/dist/main.js ]]
as_app "$NPM" --prefix "$RELEASE/backend" prune --omit=dev --no-audit --no-fund
ln -s "$AUTOMATION" "$RELEASE/automation"
ln -s /etc/cranbourne/backend.env "$RELEASE/backend/.env"
chown -R root:cranbourne "$RELEASE/backend"
chmod -R go-w "$RELEASE/backend"
git -C "$SOURCE" rev-parse HEAD > "$RELEASE/backend-source-revision.txt"
ln -sfn "$RELEASE" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
SWITCHED=1
as_app "$PM2" startOrRestart "$ROOT/deploy/ecosystem.config.cjs" --update-env
healthy=0
for attempt in {1..60}; do
    if curl -fsS --max-time 5 http://127.0.0.1:5972/health >/dev/null; then healthy=1; break; fi
    sleep 2
done
[[ $healthy == 1 ]] || { echo 'Backend health check failed.' >&2; false; }
as_app "$PM2" save
SWITCHED=0
printf 'Backend deployed: %s\n' "$(git -C "$SOURCE" rev-parse --short HEAD)"
printf 'Active release: %s\n' "$RELEASE"
echo 'Backend health passed. Python automation was not restarted.'
