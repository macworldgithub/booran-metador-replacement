"""Configuration lifecycle tests with a temporary directory and no server access."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deployment_config', Path(__file__).with_name('configure.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.config = Path(self.folder.name)
        self.patches = [patch.object(module, 'CONFIG', self.config),
                        patch.dict(os.environ, {'CERTBOT_EMAIL': 'ops@example.com'}, clear=True)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def test_fresh_configuration_has_matching_secrets_and_private_endpoints(self):
        module.configure()
        backend = module.read_env(self.config / 'backend.env')
        automation = module.read_env(self.config / 'automation.env')
        self.assertEqual(backend['PORT'], '5972')
        self.assertEqual(automation['PORT'], '5971')
        self.assertEqual(backend['DEALERSOCKET_CONNECTOR_URL'], 'http://127.0.0.1:5971')
        for key in ('DEALERSOCKET_CONNECTOR_KEY', 'LEAD_FORWARD_SECRET'):
            self.assertEqual(backend[key], automation[key])
            self.assertGreaterEqual(len(backend[key]), 32)
        self.assertEqual(backend['CRANBOURNE_MANAGED_MONGODB'], 'true')
        self.assertIn('@127.0.0.1:27019/', backend['MONGODB_URI'])

    def test_redeployment_preserves_credentials_and_provider_settings(self):
        module.configure()
        backend = module.read_env(self.config / 'backend.env')
        backend['MOBILEMESSAGE_API_PASSWORD'] = 'quote " dollar $ and apostrophe \' # value café \\ path'
        module.write_env(self.config / 'backend.env', backend)
        mongo = (self.config / 'mongodb-admin.json').read_text()
        module.configure()
        self.assertEqual(backend, module.read_env(self.config / 'backend.env'))
        self.assertEqual(mongo, (self.config / 'mongodb-admin.json').read_text())

    def test_external_database_skips_local_database_credentials(self):
        with patch.dict(os.environ, {'MONGODB_URI': 'mongodb+srv://user:password@db.example.com/matador-replacement'}):
            module.configure()
        self.assertEqual(module.read_env(self.config / 'backend.env')['CRANBOURNE_MANAGED_MONGODB'], 'false')
        self.assertFalse((self.config / 'mongodb-admin.json').exists())
        module.configure()
        self.assertEqual(module.read_env(self.config / 'backend.env')['CRANBOURNE_MANAGED_MONGODB'], 'false')

    def test_wildcard_cors_and_short_admin_password_are_rejected(self):
        for values in ({'CORS_ORIGINS': '*'}, {'BOOTSTRAP_ADMIN_PASSWORD': 'short'}):
            with self.subTest(values=values), patch.dict(os.environ, values):
                with self.assertRaises(ValueError):
                    module.configure()


if __name__ == '__main__':
    unittest.main()
