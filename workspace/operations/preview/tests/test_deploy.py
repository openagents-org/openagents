import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).parents[1] / 'deploy.py'
spec = importlib.util.spec_from_file_location('preview_deploy', SCRIPT)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeployGuards(unittest.TestCase):
    def test_only_full_commit_ids(self):
        deploy.require_sha('a' * 40)
        for value in ['develop', 'a' * 7, '../secret', 'a' * 40 + ';id', '']:
            with self.assertRaises(ValueError):
                deploy.require_sha(value)

    def test_only_the_local_preview_database_can_be_migrated(self):
        deploy.require_isolated({'PREVIEW_DATABASE_URL': 'postgresql://openagents_preview:pw@postgres:5432/openagents_preview'})
        for value in ['postgresql://user:pw@production.example/db',
                      'postgresql://openagents_preview:pw@postgres/openagents_workspace',
                      'postgresql://postgres:pw@postgres/openagents_preview',
                      'postgresql://openagents_preview:pw@127.0.0.1/openagents_preview', '']:
            with self.assertRaises(ValueError):
                deploy.require_isolated({'PREVIEW_DATABASE_URL': value})

    def test_deployment_rejects_production_before_loading_images(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / '.env').write_text('PREVIEW_DATABASE_URL=postgresql://user:secret@production/db\n')
            with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'run') as run:
                with self.assertRaises(ValueError):
                    deploy.deploy('a' * 40)
                run.assert_not_called()

    def test_image_revision_must_match_the_build(self):
        import subprocess
        from unittest.mock import patch
        response = subprocess.CompletedProcess([], 0, '[{"Config":{"Labels":{"org.opencontainers.image.revision":"wrong"}}}]')
        with patch.object(deploy, 'run', return_value=response):
            with self.assertRaises(ValueError):
                deploy.image_ok('candidate', 'a' * 40)

    def test_failed_migration_restores_local_dump_and_previous_revision(self):
        import tempfile
        from unittest.mock import patch
        old, new = 'a' * 40, 'b' * 40
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            incoming = root / 'incoming'
            incoming.mkdir()
            (incoming / f'{new}.tar.gz').write_bytes(b'fake image archive')
            old_env = f'PREVIEW_SHA={old}\nPREVIEW_DATABASE_URL=postgresql://openagents_preview:secret@postgres/openagents_preview\n'
            (root / '.env').write_text(old_env)
            (root / 'compose.yml').write_text('services: {}\n')
            calls = []
            def compose(*args, **kwargs):
                calls.append(args)
                if args[:2] == ('run', '--rm'):
                    raise RuntimeError('candidate migration failed')
            with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'INCOMING', incoming), \
                    patch.object(deploy, 'image_ok'), patch.object(deploy, 'run') as run, \
                    patch.object(deploy, 'compose', side_effect=compose), patch.object(deploy, 'verify') as verify:
                with self.assertRaisesRegex(RuntimeError, 'migration failed'):
                    deploy.deploy(new)
                self.assertEqual((root / '.env').read_text(), old_env)
                self.assertFalse((root / 'deployed.json').exists())
                self.assertEqual(calls.count(('stop', 'backend', 'frontend')), 2)
                self.assertTrue(any('DROP SCHEMA public CASCADE; CREATE SCHEMA public;' in call for call in calls))
                self.assertTrue(any('pg_restore' in call.args[0] for call in run.call_args_list))
                verify.assert_called_once()
