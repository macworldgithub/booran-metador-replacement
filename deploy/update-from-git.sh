#!/usr/bin/env bash
# Pull both source repositories, then build and activate a new release.
set -Eeuo pipefail
umask 027
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
export GIT_TERMINAL_PROMPT=0
exec 8>/run/lock/cranbourne-git-update.lock
flock -n 8 || { echo 'Another source update is running.' >&2; exit 1; }
ROOT=/var/www/cranbourne
REPOS="$ROOT/repos"
install -d -m 0755 "$REPOS"

update_repo() {
    local name=$1 branch=$2 url=$3 path="$REPOS/$1"
    if [[ ! -e $path ]]; then
        git clone --branch "$branch" --single-branch "$url" "$path"
    else
        [[ -d $path/.git ]] || { echo "Not a Git checkout: $path" >&2; return 1; }
        [[ $(git -C "$path" remote get-url origin) == "$url" ]] || {
            echo "Unexpected origin for $name; refusing to update." >&2; return 1;
        }
        [[ $(git -C "$path" branch --show-current) == "$branch" ]] || {
            echo "Unexpected branch for $name; expected $branch." >&2; return 1;
        }
        [[ -z $(git -C "$path" status --porcelain) ]] || {
            echo "Uncommitted changes in $path; preserve or commit them before updating." >&2; return 1;
        }
        git -C "$path" pull --ff-only origin "$branch"
    fi
    printf '%s: ' "$name"
    git -C "$path" rev-parse --short HEAD
}

# HTTPS works directly for public repositories. For private repositories,
# configure read access on the server or pass SSH URLs using these variables.
update_repo booran-metador-replacement master "${BACKEND_REPO_URL:-https://github.com/macworldgithub/booran-metador-replacement.git}"
update_repo metaphor-replacement-api main "${AUTOMATION_REPO_URL:-https://github.com/macworldgithub/metaphor-replacement-api.git}"
DEPLOY="$REPOS/booran-metador-replacement/deploy"
[[ -f $DEPLOY/deploy.sh ]] || { echo 'The backend branch is missing deploy/deploy.sh.' >&2; exit 1; }
if [[ ${CHECK_ONLY:-0} == 1 ]]; then
    bash -n "$DEPLOY/deploy.sh"
    echo 'Both source checkouts are ready. No application deployment was run.'
    exit 0
fi
# Both pulls must succeed before running the deployment. It copies the current
# versioned deployment tools into /var/www/cranbourne/deploy automatically.
bash "$DEPLOY/deploy.sh"
umask 027
{
    printf 'backend '
    git -C "$REPOS/booran-metador-replacement" rev-parse HEAD
    printf 'automation '
    git -C "$REPOS/metaphor-replacement-api" rev-parse HEAD
} > "$ROOT/current/source-revisions.txt"
python3 "$ROOT/deploy/verify.py"
