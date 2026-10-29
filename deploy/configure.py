"""Root-only VPS configuration; never imports or copies development .env files."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

CONFIG = Path('/etc/cranbourne')


def read_env(path):
    result = {}
    if path.exists():
        for line in path.read_text(encoding='utf-8').splitlines():
            if line.strip() and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                value = value.strip()
                result[key.strip()] = json.loads(value) if value.startswith('"') else value
    return result


def write_env(path, values):
    for value in values.values():
        if any(ord(char) < 32 for char in str(value)):
            raise ValueError('Environment settings must be single-line values.')
    temporary = path.with_suffix('.tmp')
    temporary.write_text(''.join(f'{key}={json.dumps(str(value), ensure_ascii=False)}\n' for key, value in values.items()), encoding='utf-8', newline='\n')
    temporary.chmod(0o640)
    temporary.replace(path)


def secret():
    return secrets.token_hex(32)


def configure():
    backend = read_env(CONFIG / 'backend.env')
    automation = read_env(CONFIG / 'automation.env')
    supplied_uri = os.environ.get('MONGODB_URI', '')
    uri = supplied_uri or backend.get('MONGODB_URI', '')
    local = not uri or (not supplied_uri and backend.get('CRANBOURNE_MANAGED_MONGODB') == 'true')
    if local:
        credentials_file = CONFIG / 'mongodb-admin.json'
        if credentials_file.exists():
            credentials = json.loads(credentials_file.read_text())
        else:
            credentials = {'admin': secret(), 'app': secret()}
            credentials_file.write_text(json.dumps(credentials))
            credentials_file.chmod(0o600)
        uri = f"mongodb://cranbourne:{credentials['app']}@127.0.0.1:27019/matador-replacement?authSource=matador-replacement"
    if not uri.startswith(('mongodb://', 'mongodb+srv://')):
        raise ValueError('MONGODB_URI must be a MongoDB connection URI.')
    connector_key = backend.get('DEALERSOCKET_CONNECTOR_KEY') or secret()
    forward_key = backend.get('LEAD_FORWARD_SECRET') or secret()
    backend.update({
        'NODE_ENV': 'production', 'HOST': '127.0.0.1', 'PORT': '5972',
        'MONGODB_URI': uri, 'CRANBOURNE_MANAGED_MONGODB': str(local).lower(),
        'JWT_SECRET': backend.get('JWT_SECRET') or secret(), 'JWT_EXPIRES_IN': backend.get('JWT_EXPIRES_IN', '8h'),
        'BOOTSTRAP_ADMIN_EMAIL': backend.get('BOOTSTRAP_ADMIN_EMAIL') or os.environ.get('CERTBOT_EMAIL') or 'admin@booran.com.au',
        'BOOTSTRAP_ADMIN_PASSWORD': backend.get('BOOTSTRAP_ADMIN_PASSWORD') or secret(),
        'DEALERSOCKET_CONNECTOR_URL': 'http://127.0.0.1:5971',
        'DEALERSOCKET_CONNECTOR_KEY': connector_key, 'LEAD_FORWARD_SECRET': forward_key,
        'CORS_ORIGINS': backend.get('CORS_ORIGINS', ''),
        'DOCS_ENABLED': backend.get('DOCS_ENABLED', 'false'),
        'MOBILEMESSAGE_ENABLED': backend.get('MOBILEMESSAGE_ENABLED', 'false'),
        'DEALERSOCKET_WRITEBACK_ENABLED': backend.get('DEALERSOCKET_WRITEBACK_ENABLED', 'false'),
    })
    # Explicit input overrides; retain all provider settings edited in backend.env.
    for key in ('BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD', 'CORS_ORIGINS'):
        if key in os.environ:
            backend[key] = os.environ[key]
    if len(backend['JWT_SECRET']) < 32 or len(connector_key) < 32 or len(forward_key) < 32:
        raise ValueError('Production shared secrets must contain at least 32 characters.')
    if len(backend['BOOTSTRAP_ADMIN_PASSWORD']) < 12 or '@' not in backend['BOOTSTRAP_ADMIN_EMAIL']:
        raise ValueError('A valid bootstrap email and password of at least 12 characters are required.')
    if '*' in backend['CORS_ORIGINS']:
        raise ValueError('Set CORS_ORIGINS to comma-separated HTTPS frontend origins; wildcard is not allowed.')
    automation.update({
        'PROJECT_NAME': 'Cranbourne Automation', 'ENVIRONMENT': 'production',
        'DEBUG': 'false', 'HOST': '127.0.0.1', 'PORT': '5971',
        'DOCS_ENABLED': automation.get('DOCS_ENABLED', 'false'),
        'CORS_ORIGINS': '', 'DEALERSOCKET_CONNECTOR_KEY': connector_key,
        'LEAD_FORWARD_SECRET': forward_key,
        'DEALERSOCKET_SYNC_API_URL': 'http://127.0.0.1:5972/api/leads/ingest',
        'DEALERSOCKET_PROFILE_DIR': '/var/lib/cranbourne/dealersocket-chrome',
        'DEALERSOCKET_LEAD_SNAPSHOT_PATH': '/var/lib/cranbourne/dealersocket-leads/latest.json',
        'DEALERSOCKET_INTERACTIVE_LOGIN_ENABLED': automation.get('DEALERSOCKET_INTERACTIVE_LOGIN_ENABLED', 'false'),
        'DEALERSOCKET_AUTO_LOGIN_ENABLED': automation.get('DEALERSOCKET_AUTO_LOGIN_ENABLED', 'false'),
        'DEALERSOCKET_LEAD_SYNC_ENABLED': automation.get('DEALERSOCKET_LEAD_SYNC_ENABLED', 'true'),
        'DEALERSOCKET_LEAD_SYNC_INTERVAL_SECONDS': automation.get('DEALERSOCKET_LEAD_SYNC_INTERVAL_SECONDS', '1800'),
    })
    for key in ('MOBILEMESSAGE_API_USERNAME', 'MOBILEMESSAGE_API_PASSWORD', 'MOBILEMESSAGE_WEBHOOK_SECRET',
                'SMS_KIA_NUMBER', 'SMS_MG_NUMBER', 'SMS_GEELY_NUMBER', 'DS_CLIENT_ID', 'DS_CLIENT_SECRET'):
        backend.setdefault(key, '')
    backend.setdefault('DS_API_BASE_URL', 'https://api.dealersocket.com')
    for key in ('DEALERSOCKET_USERNAME', 'DEALERSOCKET_PASSWORD', 'DEALERSOCKET_TOTP_SECRET'):
        automation.setdefault(key, '')
    write_env(CONFIG / 'backend.env', backend)
    write_env(CONFIG / 'automation.env', automation)


def initialize_mongo():
    credentials = json.loads((CONFIG / 'mongodb-admin.json').read_text())
    script = CONFIG / 'mongo-init.js'
    script.write_text('''
const admin = db.getSiblingDB('admin');
try {
  if (admin.auth('cranbourneAdmin', process.env.CRANBOURNE_MONGO_ADMIN).ok !== 1) throw Error('auth');
} catch (e) {
  // MongoDB's localhost exception permits only creation of the first administrator.
  admin.createUser({user: 'cranbourneAdmin', pwd: process.env.CRANBOURNE_MONGO_ADMIN, roles: ['root']});
  admin.auth('cranbourneAdmin', process.env.CRANBOURNE_MONGO_ADMIN);
}
const app = db.getSiblingDB('matador-replacement');
if (!app.getUser('cranbourne')) {
  app.createUser({user: 'cranbourne', pwd: process.env.CRANBOURNE_MONGO_APP,
    roles: [{role: 'readWrite', db: 'matador-replacement'}]});
}
if (app.auth('cranbourne', process.env.CRANBOURNE_MONGO_APP).ok !== 1) throw Error('app auth failed');
app.runCommand({ping: 1});
''')
    script.chmod(0o600)
    try:
        result = subprocess.run(
            ['mongosh', 'mongodb://127.0.0.1:27019/admin', '--quiet', '--norc', '--file', str(script)],
            env={**os.environ, 'CRANBOURNE_MONGO_ADMIN': credentials['admin'], 'CRANBOURNE_MONGO_APP': credentials['app']},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
        )
        if result.returncode:
            raise RuntimeError('MongoDB user initialization failed. Check journalctl -u cranbourne-mongodb.')
    finally:
        script.unlink(missing_ok=True)


if __name__ == '__main__':
    if sys.argv[1:] == ['mode']:
        print('local' if read_env(CONFIG / 'backend.env').get('CRANBOURNE_MANAGED_MONGODB') == 'true' else 'external')
    elif sys.argv[1:] == ['mongo-init']:
        initialize_mongo()
    else:
        configure()
