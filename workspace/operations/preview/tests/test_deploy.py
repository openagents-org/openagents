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
