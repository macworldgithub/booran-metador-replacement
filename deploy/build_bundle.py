"""Build an upload bundle containing source/configuration, never local runtime data."""
import os
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEPLOY = Path(__file__).resolve().parent
if not (ROOT / 'booran-metador-replacement').is_dir() and ROOT.name == 'booran-metador-replacement':
    ROOT = ROOT.parent
EXCLUDED = {'.git', 'node_modules', 'dist', '.venv', 'venv', '__pycache__', '.pytest_cache',
            '.private', 'outputs', 'downloads', 'dealersocket_browser_profile', 'dealersocket_profile',
            'test', 'tests', '.test-cache'}
SOURCE_SUFFIXES = {'.py', '.ts', '.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.toml',
                   '.sh', '.service', '.conf', '.xml', '.html', '.css', '.yaml', '.yml'}
DOTFILES = {'.gitignore', '.gitattributes', '.prettierrc', '.env.example'}


def files():
    for folder in ('deploy', 'booran-metador-replacement', 'metaphor-replacement-api'):
        source = DEPLOY if folder == 'deploy' else ROOT / folder
        for current, directories, names in os.walk(source, followlinks=False):
            directories[:] = [name for name in directories if name not in EXCLUDED
                              and not name.startswith('.qa-') and not (Path(current) / name).is_symlink()]
            for name in names:
                path = Path(current) / name
                if path.is_symlink() or name == 'dealersocket_state.json':
                    continue
                if name.startswith('.env') and name != '.env.example':
                    continue
                if name.startswith('.') and name not in DOTFILES:
                    continue
                if path.suffix not in SOURCE_SUFFIXES and name not in DOTFILES:
                    continue
                yield path, (Path(folder) / path.relative_to(source)).as_posix()
    # This source module is imported by the API at startup. The rest of outputs/
    # contains runtime exports and must never be bundled.
    relative = 'metaphor-replacement-api/outputs/dealersocket_csv_sync/download_dealersocket_chrome.py'
    yield ROOT / relative, relative


if __name__ == '__main__':
    target = ROOT / 'cranbourne-vps.zip'
    count = 0
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path, relative in sorted(files()):
            entry = zipfile.ZipInfo(relative)
            entry.create_system = 3
            entry.external_attr = (0o100755 if path.suffix == '.sh' else 0o100644) << 16
            content = path.read_bytes()
            if path.suffix in {'.sh', '.service', '.conf'}:
                content = content.replace(b'\r\n', b'\n')
            archive.writestr(entry, content, compress_type=zipfile.ZIP_DEFLATED)
            count += 1
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        names = archive.namelist()
        assert 'deploy/deploy.sh' in names
        assert 'metaphor-replacement-api/requirements-production.txt' in names
        assert 'booran-metador-replacement/package-lock.json' in names
        assert not any(Path(name).name.startswith('.env') and Path(name).name != '.env.example' for name in names)
    print(f'{target}: {count} source/configuration files, {target.stat().st_size:,} bytes')
