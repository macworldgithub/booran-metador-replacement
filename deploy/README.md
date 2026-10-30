# Cranbourne VPS deployment (no Docker)

Target: **Ubuntu 24.04 or 26.04 LTS, amd64, systemd**, with root/sudo access. Use a VPS with at least 2 vCPUs, 4 GB RAM and enough disk for MongoDB, Chrome and retained releases. On Ubuntu 26.04, supply an existing MongoDB URI; the optional MongoDB 8 provisioning targets Ubuntu 24.04. The Python connector runs under systemd; NestJS runs as one PM2 process because it owns scheduled jobs. Node 24 and PM2 are installed privately under `/var/www/cranbourne/runtime/node24`, preserving the server's system Node and other PM2 applications.

| Project | Public HTTPS hostnames | Private upstream |
| --- | --- | --- |
| `metaphor-replacement-api` (automation) | `cranbourne-automation.omnisuiteai.com`, `www.cranbourne-automation.omnisuiteai.com` | `127.0.0.1:5971` |
| `booran-metador-replacement` (backend) | `cranbourne-backend.omnisuiteai.com`, `www.cranbourne-backend.omnisuiteai.com` | `127.0.0.1:5972` |

## 1. DNS and upload

Create A records for all four hostnames pointing at the VPS public IPv4 address. A CNAME for each `www` hostname pointing at its matching non-www hostname also works. Publish AAAA records only if IPv6 reaches this VPS. Allow inbound TCP 80 and 443 in your VPS provider firewall; retain SSH access. Keep 5971, 5972 and 27019 private.

Upload this folder structure to the VPS, for example `/var/www/cranbourne`:

```text
/var/www/cranbourne/
  deploy/
  booran-metador-replacement/
  metaphor-replacement-api/
```

Upload the updated source files along with `deploy/`. The script builds production releases from them. Existing development `.env`, browser profiles, `.git`, virtual environments and `node_modules` are excluded. Do not upload those files as part of a deployment archive.

The supplied `cranbourne-vps.zip` contains that layout with source and deployment configuration. Extract it into `/var/www/cranbourne`. To rebuild the bundle after source edits, run `python deploy/build_bundle.py` on your development machine.

## 2. Deploy

You can supply a certificate contact email with `CERTBOT_EMAIL`. Without one, Certbot reuses the existing account or registers without email. The bootstrap administrator defaults to `admin@booran.com.au` when no email is supplied. Read the generated password privately in `/etc/cranbourne/backend.env`.

```bash
cd /var/www/cranbourne
sudo env CERTBOT_EMAIL='you@yourcompany.com' bash deploy/deploy.sh
```

This installs Node.js 24, PM2, Python, Google Chrome, Xvfb, Nginx, Certbot and a private authenticated MongoDB instance on port 27019. It generates strong JWT, admin and shared connector secrets; builds NestJS; installs pinned Python runtime requirements; checks both headed and headless Chrome under systemd restrictions; switches the release; sets boot startup; installs Nginx sites and symlinks; obtains both certificates covering all four names; enables renewal; and checks HTTPS health on every name. It does not reset or enable UFW. If UFW is already active, it allows 80/443. Configure your provider firewall separately.

To use Atlas or another existing MongoDB instead, supply its URI on the first run. Your MongoDB user needs `readWrite` on **matador-replacement**, which the backend explicitly selects. Restrict external database access to the VPS and configure TLS according to your database provider.

```bash
read -rsp 'MongoDB URI: ' MONGODB_URI; echo
sudo env CERTBOT_EMAIL='you@yourcompany.com' MONGODB_URI="$MONGODB_URI" bash deploy/deploy.sh
unset MONGODB_URI
```

The isolated Node runtime leaves other applications on their current Node version. A failed build leaves the current application release serving. Failed app startup restores the previous source release when one exists. Nginx changes are backed up and restored if its configuration or certificate phase fails. This is a restart deployment with a brief interruption, not zero-downtime deployment.

## 3. Production credentials and provider configuration

```bash
sudoedit /etc/cranbourne/backend.env
sudoedit /etc/cranbourne/automation.env
```

The initial backend login is `BOOTSTRAP_ADMIN_EMAIL` and the generated `BOOTSTRAP_ADMIN_PASSWORD` in `backend.env`. Read it privately; do not paste the file into logs or tickets. The bootstrap variables create an account only on an empty database. Changing them later does not reset an existing account password; use the authenticated user management API.

`backend.env` and `automation.env` are literal `KEY="value"` files read by the services, **not shell scripts**. Do not `source` them. Keep double quotes and escape embedded quotes/backslashes. The generated files survive deployments. The generator maintains matching connector/forwarding keys, ports and loopback URLs. Rotate the shared keys in `backend.env` and rerun deployment to synchronize them.

The active backend's `.env` links to `/etc/cranbourne/backend.env`, keeping production settings outside release folders. For password-reset email, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` and `MESSAGE_TRANSPORT="smtp"` there. Set `FRONTEND_URL` to the public frontend origin so reset links point to the correct portal. Keep SMTP passwords out of Git.

For a browser frontend on another origin, set `CORS_ORIGINS` in `backend.env` to a comma-separated list of its exact HTTPS origins, without trailing slashes. API documentation is disabled by default. Set `DOCS_ENABLED="true"` in the relevant environment file if you want `/api/docs` (NestJS) or `/docs` (Python) exposed.

Fresh configurations start with SMS and CRM write-back disabled. Existing approved production settings are preserved. Configure the provider credentials, dedicated reply numbers and signing secret before setting `MOBILEMESSAGE_ENABLED="true"`; follow the backend's `docs/mobile-message.md`. Public callbacks are:

```text
https://cranbourne-backend.omnisuiteai.com/api/sms/inbound
https://cranbourne-backend.omnisuiteai.com/api/sms/delivery-receipt
```

The Python API runs on Linux, but DealerSocket access still requires valid account authentication. Configure `DEALERSOCKET_USERNAME`, `DEALERSOCKET_PASSWORD` and, if applicable, `DEALERSOCKET_TOTP_SECRET` in `automation.env`, then set `DEALERSOCKET_AUTO_LOGIN_ENABLED="true"`. Keep `DEALERSOCKET_INTERACTIVE_LOGIN_ENABLED="false"` for an unattended VPS unless you intentionally provide secure access to its virtual display. Automatic background checks can authenticate with those credentials. CAPTCHA or other manual verification requires an operator with secure GUI access; Xvfb alone does not provide a remote desktop. Do not copy a Windows Chrome profile onto Linux. Authenticate a fresh Linux profile. The deployment does not bypass authentication challenges or certify live CRM access.

`/health` on automation confirms API availability; it does not assert DealerSocket authentication. Verify connector state using its authenticated `/dealersocket/status` endpoint or the backend's DealerSocket status API. Scheduled reads start after a valid session is established. The connector's existing snapshot worker is read-only; setting an ingest URL does not by itself create a new lead-forwarding process.

Apply edited configuration:

```bash
sudo systemctl restart cranbourne-automation
sudo -u cranbourne env HOME=/var/lib/cranbourne PM2_HOME=/var/lib/cranbourne/.pm2 PATH=/var/www/cranbourne/runtime/node24/bin:/usr/bin:/bin \
  pm2 startOrRestart /var/www/cranbourne/deploy/ecosystem.config.cjs --update-env
sudo -u cranbourne env HOME=/var/lib/cranbourne PM2_HOME=/var/lib/cranbourne/.pm2 PATH=/var/www/cranbourne/runtime/node24/bin:/usr/bin:/bin pm2 save
```

## Nginx files, symlinks and Certbot commands

The script performs these operations automatically. The bootstrap `.conf` files serve ACME challenges and redirect other traffic to HTTPS. The `.ssl.conf` files add the application proxies after certificates exist. Both domain variants serve the application; neither redirects to the other.

```bash
sudo ln -sfn /etc/nginx/sites-available/cranbourne-automation.conf /etc/nginx/sites-enabled/cranbourne-automation.conf
sudo ln -sfn /etc/nginx/sites-available/cranbourne-backend.conf /etc/nginx/sites-enabled/cranbourne-backend.conf
sudo nginx -t
sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/letsencrypt \
  --non-interactive --agree-tos --email you@yourcompany.com --keep-until-expiring \
  --cert-name cranbourne-automation.omnisuiteai.com \
  -d cranbourne-automation.omnisuiteai.com -d www.cranbourne-automation.omnisuiteai.com

sudo certbot certonly --webroot -w /var/www/letsencrypt \
  --non-interactive --agree-tos --email you@yourcompany.com --keep-until-expiring \
  --cert-name cranbourne-backend.omnisuiteai.com \
  -d cranbourne-backend.omnisuiteai.com -d www.cranbourne-backend.omnisuiteai.com

sudo certbot renew --dry-run
sudo systemctl list-timers certbot.timer
```

The webroot approach keeps certificate issuance separate from the reviewed Nginx templates. Renewal runs through `certbot.timer`; a deploy hook validates and reloads Nginx after certificate replacement. Run the dry run after deployment to verify renewal against the actual DNS/firewall configuration.

The API imports `outputs/dealersocket_csv_sync/download_dealersocket_chrome.py` as a normalization source module. The deployment bundle includes that specific Python source file. Generated exports, browser profiles and other contents of `outputs/` remain excluded.

## Updates, logs and state

The canonical deployment scripts are versioned in the **backend repository's `deploy/` folder**. The backend deploys from `master`; automation deploys from `main`. The original source folders on this VPS came from an archive and are not Git checkouts, so do not run `git pull` in those folders.

After making changes locally, commit and push each project that changed:

```powershell
git -C D:\cranbourne\booran-metador-replacement status
git -C D:\cranbourne\booran-metador-replacement add <changed-files>
git -C D:\cranbourne\booran-metador-replacement commit -m "Describe your change"
git -C D:\cranbourne\booran-metador-replacement push origin master

git -C D:\cranbourne\metaphor-replacement-api status
git -C D:\cranbourne\metaphor-replacement-api add <changed-files>
git -C D:\cranbourne\metaphor-replacement-api commit -m "Describe your change"
git -C D:\cranbourne\metaphor-replacement-api push origin main
```

Then connect to the VPS and run the update script. **While DNS/HTTPS is still pending:**

```bash
ssh root@72.62.249.186
sudo env DEFER_TLS=1 bash /var/www/cranbourne/deploy/update-from-git.sh
```

The first run clones both repositories into `/var/www/cranbourne/repos/`. Later runs pull with `--ff-only`, refusing uncommitted changes or unexpected branches. Both source updates must succeed before deployment starts. It builds a new release, restarts the two applications, checks health, and records Git revisions in `current/source-revisions.txt`. It preserves `/etc/cranbourne`, the database, saved browser state and lead snapshots. A restart briefly interrupts requests. Editing live files under `current/` is temporary; make persistent source changes in Git.

**Once all four DNS names point to this VPS**, enable HTTPS once:

```bash
sudo bash /var/www/cranbourne/deploy/enable-https.sh
```

After HTTPS is working, normal updates use:

```bash
sudo bash /var/www/cranbourne/deploy/update-from-git.sh
```

To redeploy **only the backend**, preserving the running Python automation process, use:

```bash
sudo bash /var/www/cranbourne/deploy/redeploy-backend.sh
```

This pulls backend `master`, builds and tests it, and restarts only `cranbourne-backend` in PM2. The resulting release links to the existing automation directory. Keep that referenced release when cleaning older releases. It does not modify Nginx, TLS certificates or production environment values.

The repositories currently support public HTTPS reads. If access becomes private, configure server read access or pass `BACKEND_REPO_URL` / `AUTOMATION_REPO_URL` with authorized SSH URLs. Never commit `.env` files, passwords, private keys or browser profiles.

Each run keeps prior releases under `/var/www/cranbourne/releases/`; `current` points to the active release. Keep enough disk space and remove old releases only after confirming they are not active or needed for rollback. Source rollback does not roll back database changes, system package updates, environment changes or certificates. As an alternative to Git-based updates, upload an updated bundle and rerun `deploy.sh` from its extracted `deploy/` folder.

```bash
sudo systemctl status cranbourne-automation pm2-cranbourne nginx
sudo journalctl -u cranbourne-automation -n 100 --no-pager
sudo tail -n 100 /var/log/cranbourne/backend-error.log
sudo tail -n 100 /var/log/nginx/cranbourne-backend.error.log
sudo -u cranbourne env HOME=/var/lib/cranbourne PM2_HOME=/var/lib/cranbourne/.pm2 PATH=/var/www/cranbourne/runtime/node24/bin:/usr/bin:/bin pm2 status
curl -fsS https://cranbourne-automation.omnisuiteai.com/health
curl -fsS https://cranbourne-backend.omnisuiteai.com/health
# Only when using the managed local database:
sudo systemctl status cranbourne-mongodb
```

PM2 logs rotate daily or at 20 MB, retaining 14 rotated files. Python and managed MongoDB use the system journal. Nginx uses the distribution's log rotation policy. Browser state and lead snapshots live under `/var/lib/cranbourne/`; managed database data lives in `/var/lib/cranbourne-mongodb/`. The database is isolated from any other MongoDB instance and has authentication enabled. Administrator database credentials are stored root-only in `/etc/cranbourne/mongodb-admin.json`. PM2's private home contains saved environment secrets and must remain private.

Run `sudo python3 /var/www/cranbourne/deploy/verify.py` for a read-only service, port, database-health and connector-state report. It omits credentials and lead records. PM2 runs in its own `pm2-cranbourne.service` cgroup so it survives completion of a transient deployment job.

Configure encrypted off-server database backups and monitoring for your retention/recovery requirements before live customer use. Back up `/etc/cranbourne`, browser state and certificates securely too; a live file copy of MongoDB's data directory is not a consistent database backup. For Atlas, enable provider backups; for local MongoDB, use authenticated `mongodump` or coordinated filesystem snapshots and test restore. Neither an SSH deployment nor DNS, real certificate issuance, a reboot or live provider authentication can be verified on the local Windows development machine.

Implementation references: [PM2 startup](https://pm2.keymetrics.io/docs/usage/startup/), [PM2 ecosystem options](https://pm2.keymetrics.io/docs/usage/application-declaration/), [Playwright browsers](https://playwright.dev/python/docs/browsers), [MongoDB Ubuntu installation](https://www.mongodb.com/docs/v8.0/tutorial/install-mongodb-on-ubuntu/), [Certbot](https://certbot.eff.org/instructions?ws=nginx&os=ubuntufocal), [Nginx proxy headers](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).

The backend lockfile includes compatible production advisory fixes. Explicit overrides select patched [Multer 2.5.0](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) and [js-yaml 5.4.1](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm) where framework packages still request older versions. Recheck advisories during future dependency upgrades.

To prepare the services before DNS exists, run `sudo env DEFER_TLS=1 bash deploy/deploy.sh`. This starts both applications on their private ports and installs the Nginx ACME bootstrap configuration. Once all four DNS names point to the VPS, run `sudo bash /var/www/cranbourne/deploy/enable-https.sh` to issue certificates and enable HTTPS without rebuilding or restarting the applications.
