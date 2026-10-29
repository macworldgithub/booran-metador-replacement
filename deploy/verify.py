"""Read-only deployment checks. Never prints environment values or lead records."""
import json
import os
from pathlib import Path
import subprocess
from urllib.request import Request, urlopen

from configure import CONFIG, read_env


def command(*arguments, environment=None):
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=20,
                            env=environment or os.environ)
    return result.returncode, result.stdout.strip()


def request(port, path, headers=None):
    try:
        with urlopen(Request(f'http://127.0.0.1:{port}{path}', headers=headers or {}), timeout=8) as response:
            return {'http': response.status, 'body': json.load(response)}
    except Exception as error:
        return {'error': type(error).__name__}


report = {'release': str(Path('/var/www/cranbourne/current').resolve()), 'services': {}}
for service in ('cranbourne-automation', 'pm2-cranbourne', 'nginx'):
    report['services'][service] = {
        'state': command('systemctl', 'is-active', service)[1],
        'boot': command('systemctl', 'is-enabled', service)[1],
    }
report['health'] = {name: request(port, '/health') for name, port in (('automation', 5971), ('backend', 5972))}
settings = read_env(CONFIG / 'automation.env')
connector = request(5971, '/dealersocket/status', {'X-Connector-Key': settings.get('DEALERSOCKET_CONNECTOR_KEY', '')})
report['connector'] = {key: connector.get('body', {}).get(key) for key in ('state', 'errorCode', 'operation')}
report['connector']['http'] = connector.get('http')
environment = {**os.environ, 'HOME': '/var/lib/cranbourne', 'PM2_HOME': '/var/lib/cranbourne/.pm2',
               'PATH': '/var/www/cranbourne/runtime/node24/bin:/usr/bin:/bin'}
code, output = command('/usr/sbin/runuser', '-u', 'cranbourne', '--', '/var/www/cranbourne/runtime/node24/bin/pm2', 'jlist', environment=environment)
try:
    apps = json.loads(output)
    report['pm2'] = [{'name': app.get('name'), 'status': app.get('pm2_env', {}).get('status'),
                      'restarts': app.get('pm2_env', {}).get('restart_time')} for app in apps]
except (ValueError, TypeError):
    report['pm2'] = {'error': 'status_unavailable'}
report['system_node'] = command('/usr/bin/node', '--version')[1]
report['cranbourne_node'] = command('/var/www/cranbourne/runtime/node24/bin/node', '--version')[1]
report['nginx_valid'] = command('/usr/sbin/nginx', '-t')[0] == 0
print(json.dumps(report, indent=2))
