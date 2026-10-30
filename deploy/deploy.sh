#!/usr/bin/env bash
# Ubuntu 24.04/26.04 LTS, amd64, systemd. No Docker.
set -Eeuo pipefail
umask 027

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n[cranbourne] %s\n' "$*"; }
[[ $EUID -eq 0 ]] || fail 'Run this script with sudo.'
CERTBOT_EMAIL=${CERTBOT_EMAIL:-}
CERTBOT_CONTACT=(--register-unsafely-without-email)
if [[ -n $CERTBOT_EMAIL ]]; then
    [[ $CERTBOT_EMAIL == *@*.* ]] || fail 'CERTBOT_EMAIL must be a valid email address.'
    CERTBOT_CONTACT=(--email "$CERTBOT_EMAIL")
fi
[[ -d /run/systemd/system ]] || fail 'A systemd VPS is required.'
source /etc/os-release
[[ $ID == ubuntu && ( $VERSION_ID == 24.04 || $VERSION_ID == 26.04 ) ]] || fail 'Supported targets: Ubuntu 24.04/26.04 LTS.'
[[ $(dpkg --print-architecture) == amd64 ]] || fail 'amd64 is required for the connector Google Chrome channel.'

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
if [[ -f $SOURCE_DIR/package.json && -d $SOURCE_DIR/../metaphor-replacement-api ]]; then
    # The versioned copy lives in booran-metador-replacement/deploy/.
    SOURCE_DIR=$(cd -- "$SOURCE_DIR/.." && pwd)
fi
[[ -f $SOURCE_DIR/booran-metador-replacement/package-lock.json ]] || fail 'Upload both projects and deploy/ in the same parent directory.'
[[ -f $SOURCE_DIR/metaphor-replacement-api/run_connector.py ]] || fail 'Python project is missing.'
exec 9>/run/lock/cranbourne-deploy.lock
flock -n 9 || fail 'Another deployment is running.'
RELEASE="/var/www/cranbourne/releases/$(date -u +%Y%m%dT%H%M%S)-$$"
PREVIOUS=''
if [[ -L /var/www/cranbourne/current ]]; then
    PREVIOUS=$(readlink -e /var/www/cranbourne/current 2>/dev/null || true)
elif [[ -e /var/www/cranbourne/current ]]; then
    fail '/var/www/cranbourne/current must be a managed release symlink.'
fi
SWITCHED=0
BUILD_COMPLETE=0
NGINX_CHANGED=0
NGINX_BACKUP=''
NGINX_FILES=(/etc/nginx/snippets/cranbourne-proxy.conf /etc/nginx/conf.d/cranbourne-limits.conf
    /etc/nginx/sites-available/cranbourne-automation.conf /etc/nginx/sites-available/cranbourne-backend.conf
    /etc/nginx/sites-enabled/cranbourne-automation.conf /etc/nginx/sites-enabled/cranbourne-backend.conf)

as_app() {
    runuser -u cranbourne -- env HOME=/var/lib/cranbourne PM2_HOME=/var/lib/cranbourne/.pm2 \
        PLAYWRIGHT_BROWSERS_PATH=/var/lib/cranbourne/browsers PATH=/var/www/cranbourne/runtime/node24/bin:/usr/local/bin:/usr/bin:/bin "$@"
}
rollback_on_error() {
    local code=$?
    trap - ERR
    printf '\nDeployment failed (exit %s). Inspect service logs; failed release: %s\n' "$code" "$RELEASE" >&2
    if [[ $NGINX_CHANGED == 1 ]]; then
        for managed in "${NGINX_FILES[@]}"; do
            rm -f -- "$managed"
            if [[ -e $NGINX_BACKUP$managed || -L $NGINX_BACKUP$managed ]]; then
                cp -a -- "$NGINX_BACKUP$managed" "$managed"
            fi
        done
        if nginx -t; then systemctl reload nginx || true; fi
        printf 'Restored the previous Nginx configuration.\n' >&2
    fi
    if [[ $SWITCHED == 1 && $BUILD_COMPLETE == 0 ]]; then
        if [[ -n $PREVIOUS && -d $PREVIOUS ]]; then
            ln -sfn "$PREVIOUS" /var/www/cranbourne/current.rollback
            mv -Tf /var/www/cranbourne/current.rollback /var/www/cranbourne/current
            systemctl restart cranbourne-automation || true
            as_app /var/www/cranbourne/runtime/node24/bin/pm2 startOrRestart /var/www/cranbourne/deploy/ecosystem.config.cjs --update-env || true
            as_app /var/www/cranbourne/runtime/node24/bin/pm2 save || true
            printf 'Restored previous application release: %s\n' "$PREVIOUS" >&2
        else
            systemctl stop cranbourne-automation || true
            as_app /var/www/cranbourne/runtime/node24/bin/pm2 delete cranbourne-backend || true
            printf 'First deployment stopped because application health checks failed.\n' >&2
        fi
    fi
    exit "$code"
}
trap rollback_on_error ERR

log 'Installing system dependencies'
export DEBIAN_FRONTEND=noninteractive
PACKAGES=(ca-certificates curl gnupg rsync build-essential python3 python3-venv python3-dev nginx
    certbot python3-certbot-nginx xvfb xauth fonts-liberation logrotate dnsutils acl iproute2 xz-utils)
MISSING_PACKAGES=()
for package in "${PACKAGES[@]}"; do
    if [[ $(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true) != installed ]]; then
        MISSING_PACKAGES+=("$package")
    fi
done
if (( ${#MISSING_PACKAGES[@]} )); then
    apt-get update
    apt-get install -y --no-upgrade "${MISSING_PACKAGES[@]}"
fi
if [[ -z $PREVIOUS ]]; then
    for port in 5971 5972; do
        if ss -ltnH "sport = :$port" | grep -q .; then
            fail "Port $port is already occupied. Stop or relocate the existing listener before the first deployment."
        fi
    done
fi
if ! id cranbourne >/dev/null 2>&1; then
    useradd --system --create-home --home-dir /var/lib/cranbourne --shell /usr/sbin/nologin cranbourne
fi
install -d -o cranbourne -g cranbourne -m 0700 /var/lib/cranbourne
install -d -o cranbourne -g cranbourne -m 0750 /var/log/cranbourne
install -d -o root -g cranbourne -m 0750 /etc/cranbourne
install -d -m 0755 /var/www/cranbourne/releases /var/www/cranbourne/deploy
if [[ $(readlink -f "$SCRIPT_DIR") != /var/www/cranbourne/deploy ]]; then
    rsync -a --exclude='__pycache__' "$SCRIPT_DIR/" /var/www/cranbourne/deploy/
fi
chown -R root:root /var/www/cranbourne/deploy
chmod -R go-w /var/www/cranbourne/deploy

log 'Configuring isolated Node.js 24 LTS and PM2 without changing system Node'
install -d -m 0755 /var/www/cranbourne/runtime
if [[ ! -x /var/www/cranbourne/runtime/node24/bin/node ]]; then
    curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o /var/www/cranbourne/runtime/SHASUMS256.txt
    NODE_ARCHIVE=$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2; exit}' /var/www/cranbourne/runtime/SHASUMS256.txt)
    [[ -n $NODE_ARCHIVE ]] || fail 'Could not identify the official Node 24 binary.'
    curl -fsSL "https://nodejs.org/dist/latest-v24.x/$NODE_ARCHIVE" -o "/var/www/cranbourne/runtime/$NODE_ARCHIVE"
    (cd /var/www/cranbourne/runtime && grep -F " $NODE_ARCHIVE" SHASUMS256.txt | sha256sum --check -)
    install -d -m 0755 /var/www/cranbourne/runtime/node24
    tar -xJf "/var/www/cranbourne/runtime/$NODE_ARCHIVE" -C /var/www/cranbourne/runtime/node24 --strip-components=1
fi
if [[ ! -x /var/www/cranbourne/runtime/node24/bin/pm2 ]]; then
    env PATH=/var/www/cranbourne/runtime/node24/bin:/usr/bin:/bin \
        /var/www/cranbourne/runtime/node24/bin/npm install --global --prefix /var/www/cranbourne/runtime/node24 pm2@6
fi
# Root's restrictive umask must not prevent the service account from reading
# the public Node/PM2 runtime packages. No credentials are stored in this tree.
chown -R root:root /var/www/cranbourne/runtime/node24
chmod -R go+rX,go-w /var/www/cranbourne/runtime/node24

log 'Creating or preserving production secrets and settings'
python3 /var/www/cranbourne/deploy/configure.py
chown root:cranbourne /etc/cranbourne/backend.env /etc/cranbourne/automation.env
chmod 0640 /etc/cranbourne/backend.env /etc/cranbourne/automation.env

if [[ $(python3 /var/www/cranbourne/deploy/configure.py mode) == local ]]; then
    [[ $VERSION_ID == 24.04 ]] || fail 'On Ubuntu 26.04, supply MONGODB_URI for an existing supported database.'
    log 'Installing private authenticated MongoDB on 127.0.0.1:27019'
    if [[ ! -f /etc/systemd/system/cranbourne-mongodb.service ]] && ss -ltnH 'sport = :27019' | grep -q .; then
        fail 'Port 27019 is occupied. Supply MONGODB_URI for your existing database.'
    fi
    if ! command -v mongod >/dev/null || ! command -v mongosh >/dev/null; then
        curl --fail --silent --show-error --location https://www.mongodb.org/static/pgp/server-8.0.asc \
            -o /var/www/cranbourne/deploy/mongodb-key.asc
        gpg --batch --yes --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg /var/www/cranbourne/deploy/mongodb-key.asc
        chmod 0644 /usr/share/keyrings/mongodb-server-8.0.gpg
        printf '%s\n' 'deb [arch=amd64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse' \
            > /etc/apt/sources.list.d/cranbourne-mongodb-8.0.list
        apt-get update
        # Install binaries only; do not start or reconfigure another mongod service.
        apt-get install -y mongodb-org-server mongodb-mongosh
    fi
    if ! id mongodb >/dev/null 2>&1; then
        useradd --system --no-create-home --shell /usr/sbin/nologin mongodb
    fi
    install -o root -g mongodb -m 0640 /var/www/cranbourne/deploy/mongod.conf /etc/cranbourne/mongod.conf
    # mongodb needs to traverse the directory to read only its own config.
    setfacl -m u:mongodb:--x /etc/cranbourne
    install -m 0644 /var/www/cranbourne/deploy/systemd/cranbourne-mongodb.service /etc/systemd/system/cranbourne-mongodb.service
    systemctl daemon-reload
    systemctl enable --now cranbourne-mongodb
    for attempt in {1..30}; do
        if mongosh 'mongodb://127.0.0.1:27019/admin?serverSelectionTimeoutMS=1000' --quiet \
            --eval 'quit(db.runCommand({ping:1}).ok === 1 ? 0 : 1)' >/dev/null 2>&1; then break; fi
        sleep 2
    done
    python3 /var/www/cranbourne/deploy/configure.py mongo-init
fi

log 'Building an isolated release before switching traffic'
install -d -o root -g cranbourne -m 0755 "$RELEASE"
install -d -o cranbourne -g cranbourne -m 0755 "$RELEASE/backend" "$RELEASE/automation"
COPY_EXCLUDES=(--exclude='.git' --exclude='.env' --exclude='.env.*' --exclude='node_modules' \
    --exclude='dist' --exclude='.venv' --exclude='venv' --exclude='__pycache__' \
    --exclude='.pytest_cache' --exclude='.private' --exclude='*.tsbuildinfo' \
    --exclude='dealersocket_browser_profile' --exclude='dealersocket_profile' \
    --exclude='dealersocket_state.json' --exclude='outputs' --exclude='downloads')
rsync -a --chown=cranbourne:cranbourne "${COPY_EXCLUDES[@]}" "$SOURCE_DIR/booran-metador-replacement/" "$RELEASE/backend/"
rsync -a --chown=cranbourne:cranbourne "${COPY_EXCLUDES[@]}" "$SOURCE_DIR/metaphor-replacement-api/" "$RELEASE/automation/"
RULES_FILE=outputs/dealersocket_csv_sync/download_dealersocket_chrome.py
install -d -o cranbourne -g cranbourne -m 0755 "$RELEASE/automation/outputs" "$RELEASE/automation/outputs/dealersocket_csv_sync"
install -o cranbourne -g cranbourne -m 0644 "$SOURCE_DIR/metaphor-replacement-api/$RULES_FILE" "$RELEASE/automation/$RULES_FILE"
as_app /var/www/cranbourne/runtime/node24/bin/npm --prefix "$RELEASE/backend" ci --include=dev --no-audit --no-fund
as_app /var/www/cranbourne/runtime/node24/bin/npm --prefix "$RELEASE/backend" run build
[[ -s $RELEASE/backend/dist/main.js ]] || fail 'NestJS dist/main.js was not built.'
as_app /var/www/cranbourne/runtime/node24/bin/npm --prefix "$RELEASE/backend" prune --omit=dev --no-audit --no-fund
as_app python3 -m venv "$RELEASE/automation/.venv"
as_app "$RELEASE/automation/.venv/bin/python" -m pip install --upgrade pip
as_app "$RELEASE/automation/.venv/bin/python" -m pip install -r "$RELEASE/automation/requirements-production.txt"
as_app "$RELEASE/automation/.venv/bin/python" -m pip check
# Import the API from the packaged release before touching running services.
as_app env PYTHONPATH="$RELEASE/automation" ENVIRONMENT=development DEBUG=false \
    DEALERSOCKET_AUTO_LOGIN_ENABLED=false DEALERSOCKET_LEAD_SYNC_ENABLED=false \
    "$RELEASE/automation/.venv/bin/python" -c 'import app.main; print("Packaged automation API imports successfully")'
# Chrome is required because the application explicitly uses channel="chrome".
"$RELEASE/automation/.venv/bin/python" -m playwright install-deps chromium
if ! command -v google-chrome >/dev/null; then
    "$RELEASE/automation/.venv/bin/python" -m playwright install chrome
else
    apt-get install -y --only-upgrade google-chrome-stable
fi
# The API's /health alone cannot prove that the browser sandbox works.
systemd-run --quiet --wait --pipe --collect --unit="cranbourne-browser-smoke-$$" \
    -p User=cranbourne -p Group=cranbourne -p NoNewPrivileges=true -p PrivateTmp=true \
    -p ProtectSystem=strict -p ProtectHome=true -p ReadWritePaths=/var/lib/cranbourne \
    -p Environment=HOME=/var/lib/cranbourne -p Environment=PYTHONDONTWRITEBYTECODE=1 \
    /usr/bin/xvfb-run -a "$RELEASE/automation/.venv/bin/python" /var/www/cranbourne/deploy/smoke_browser.py
# Capture exact resolved Python versions for this release without rewriting sources.
as_app "$RELEASE/automation/.venv/bin/python" -m pip freeze > "$RELEASE/python-requirements.resolved.txt"
# Runtime accounts write only to their dedicated state and log directories.
chown -R root:cranbourne "$RELEASE"
chmod -R go-w "$RELEASE"
ln -sfn /etc/cranbourne/backend.env "$RELEASE/backend/.env"

log 'Installing startup services and switching to the new release'
install -m 0644 /var/www/cranbourne/deploy/systemd/cranbourne-automation.service /etc/systemd/system/cranbourne-automation.service
install -m 0644 /var/www/cranbourne/deploy/logrotate.conf /etc/logrotate.d/cranbourne
ln -sfn "$RELEASE" /var/www/cranbourne/current.next
mv -Tf /var/www/cranbourne/current.next /var/www/cranbourne/current
SWITCHED=1
systemctl daemon-reload
systemctl enable cranbourne-automation
systemctl reset-failed cranbourne-automation
systemctl restart cranbourne-automation
as_app /var/www/cranbourne/runtime/node24/bin/pm2 startOrRestart /var/www/cranbourne/deploy/ecosystem.config.cjs --update-env
as_app /var/www/cranbourne/runtime/node24/bin/pm2 save
env PM2_HOME=/var/lib/cranbourne/.pm2 PATH=/var/www/cranbourne/runtime/node24/bin:/usr/bin:/bin /var/www/cranbourne/runtime/node24/bin/pm2 startup systemd -u cranbourne --hp /var/lib/cranbourne
systemctl enable pm2-cranbourne
if ! systemctl is-active --quiet pm2-cranbourne; then
    # Give the daemon its own systemd cgroup. A daemon first launched from a
    # transient deployment unit would otherwise be killed when that unit ends.
    as_app /var/www/cranbourne/runtime/node24/bin/pm2 kill
    systemctl start pm2-cranbourne
fi

wait_healthy() {
    local port=$1
    for attempt in {1..60}; do
        if curl --fail --silent --max-time 5 "http://127.0.0.1:$port/health" >/dev/null; then return; fi
        sleep 2
    done
    printf 'Health check failed on port %s.\n' "$port" >&2
    return 1
}
wait_healthy 5971
wait_healthy 5972
systemctl is-active --quiet cranbourne-automation
as_app /var/www/cranbourne/runtime/node24/bin/pm2 jlist | python3 -c 'import json,sys; apps=json.load(sys.stdin); sys.exit(0 if any(app.get("name")=="cranbourne-backend" and app.get("pm2_env",{}).get("status")=="online" for app in apps) else 1)'
BUILD_COMPLETE=1

log 'Configuring Nginx and site symlinks'
NGINX_BACKUP=$(mktemp -d /var/www/cranbourne/nginx-backup.XXXXXX)
for managed in "${NGINX_FILES[@]}"; do
    if [[ -e $managed || -L $managed ]]; then cp -a --parents -- "$managed" "$NGINX_BACKUP/"; fi
done
NGINX_CHANGED=1
install -d -m 0755 /var/www/letsencrypt /var/www/letsencrypt/.well-known \
    /var/www/letsencrypt/.well-known/acme-challenge /etc/nginx/snippets
install -m 0644 /var/www/cranbourne/deploy/nginx/cranbourne-proxy.conf /etc/nginx/snippets/cranbourne-proxy.conf
printf '%s\n' 'limit_req_zone $binary_remote_addr zone=cranbourne_login:10m rate=5r/m;' \
    > /etc/nginx/conf.d/cranbourne-limits.conf
for site in automation backend; do
    domain="cranbourne-$site.omnisuiteai.com"
    conf="/etc/nginx/sites-available/cranbourne-$site.conf"
    template="/var/www/cranbourne/deploy/nginx/cranbourne-$site.conf"
    if [[ -s /etc/letsencrypt/live/$domain/fullchain.pem ]]; then
        template="/var/www/cranbourne/deploy/nginx/cranbourne-$site.ssl.conf"
    fi
    install -m 0644 "$template" "$conf"
    ln -sfn "$conf" "/etc/nginx/sites-enabled/cranbourne-$site.conf"
done
nginx -t
systemctl enable --now nginx
systemctl reload nginx
# Respect the server's existing firewall policy; never enable/reset UFW here.
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
    ufw allow 80/tcp
    ufw allow 443/tcp
fi

if [[ ${DEFER_TLS:-0} == 1 ]]; then
    NGINX_CHANGED=0
    log 'Application deployment complete; HTTPS intentionally deferred until DNS is ready'
    printf '%s\n' 'Both applications are running on localhost ports 5971/5972.' \
        'Nginx is installed with ACME challenge routes; authenticated traffic requires HTTPS.' \
        'Once DNS is ready, rerun deploy.sh without DEFER_TLS=1 to issue certificates.'
    exit 0
fi

log 'Requesting certificates for all four DNS hostnames'
for site in automation backend; do
    domain="cranbourne-$site.omnisuiteai.com"
    certbot certonly --webroot --webroot-path /var/www/letsencrypt \
        --non-interactive --agree-tos "${CERTBOT_CONTACT[@]}" --keep-until-expiring \
        --cert-name "$domain" -d "$domain" -d "www.$domain"
    install -m 0644 "/var/www/cranbourne/deploy/nginx/cranbourne-$site.ssl.conf" \
        "/etc/nginx/sites-available/cranbourne-$site.conf"
done
nginx -t
systemctl reload nginx
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/cranbourne-reload-nginx.sh <<'HOOK'
#!/bin/sh
set -eu
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/cranbourne-reload-nginx.sh
systemctl enable --now certbot.timer
for domain in cranbourne-automation.omnisuiteai.com www.cranbourne-automation.omnisuiteai.com \
    cranbourne-backend.omnisuiteai.com www.cranbourne-backend.omnisuiteai.com; do
    curl --fail --silent --show-error --max-time 15 --resolve "$domain:443:127.0.0.1" "https://$domain/health" >/dev/null
done
NGINX_CHANGED=0
log 'Deployment complete'
printf '%s\n' \
    'Automation: https://cranbourne-automation.omnisuiteai.com (localhost:5971)' \
    'Backend:    https://cranbourne-backend.omnisuiteai.com (localhost:5972)' \
    'Both www variants have HTTPS certificates and serve the same applications.' \
    'Production settings and bootstrap login: /etc/cranbourne/backend.env' \
    'DealerSocket credentials/settings: /etc/cranbourne/automation.env' \
    'DealerSocket login must still be configured and verified before lead automation is operational.' \
    'Before declaring certificate renewal verified, run: sudo certbot renew --dry-run'
