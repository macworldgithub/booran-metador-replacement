#!/usr/bin/env bash
# Finish HTTPS after DNS is ready, without rebuilding or restarting applications.
set -Eeuo pipefail
umask 027
[[ $EUID -eq 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
ROOT=/var/www/cranbourne
CONTACT=(--register-unsafely-without-email)
if [[ -n ${CERTBOT_EMAIL:-} ]]; then CONTACT=(--email "$CERTBOT_EMAIL"); fi
exec 9>/run/lock/cranbourne-deploy.lock
flock -n 9 || { echo 'Another Cranbourne deployment is running.' >&2; exit 1; }
nginx -t
for site in automation backend; do
    domain="cranbourne-$site.omnisuiteai.com"
    certbot certonly --webroot -w /var/www/letsencrypt --non-interactive --agree-tos \
        "${CONTACT[@]}" --keep-until-expiring --cert-name "$domain" -d "$domain" -d "www.$domain"
done
BACKUP=$(mktemp -d "$ROOT/https-backup.XXXXXX")
restore_on_error() {
    local result=$?
    trap - ERR
    for site in automation backend; do
        cp -a "$BACKUP/cranbourne-$site.conf" "/etc/nginx/sites-available/cranbourne-$site.conf"
    done
    if nginx -t; then systemctl reload nginx || true; fi
    exit "$result"
}
for site in automation backend; do
    cp -a "/etc/nginx/sites-available/cranbourne-$site.conf" "$BACKUP/cranbourne-$site.conf"
done
trap restore_on_error ERR
for site in automation backend; do
    install -m 0644 "$ROOT/deploy/nginx/cranbourne-$site.ssl.conf" "/etc/nginx/sites-available/cranbourne-$site.conf"
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
for site in automation backend; do
    for prefix in '' 'www.'; do
        domain="${prefix}cranbourne-$site.omnisuiteai.com"
        curl -fsS --max-time 15 --resolve "$domain:443:127.0.0.1" "https://$domain/health" >/dev/null
        echo "HTTPS verified: https://$domain/health"
    done
done
echo 'HTTPS enabled. Check renewal with certbot renew --dry-run --cert-name DOMAIN for each Cranbourne certificate.'
