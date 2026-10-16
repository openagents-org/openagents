import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from migration_plan import plan
import deploy


class MigrationTests(unittest.TestCase):
    def script(self, safe):
        return SimpleNamespace(get_heads=lambda: ['084'],
            iterate_revisions=lambda head,current: [SimpleNamespace(revision='084',
              module=SimpleNamespace(deployment_backward_compatible=safe))])
    def test_unmarked_migration_blocks(self):
        with self.assertRaises(RuntimeError): plan(self.script(False), ['083'])
    def test_safe_migration_is_identified(self):
        self.assertEqual(plan(self.script(True), ['083'])['pending'], ['084'])
    def test_multiple_current_revisions_block(self):
        with self.assertRaises(RuntimeError): plan(self.script(True), ['082','083'])
    def test_current_schema_needs_no_backup(self):
        s=SimpleNamespace(get_heads=lambda:['083'],iterate_revisions=lambda *_:[])
        self.assertEqual(plan(s,['083'])['pending'], [])
    def test_current_schema_does_not_run_upgrade(self):
        import json
        current = {'current': ['083'], 'target': ['083'], 'pending': []}
        with patch.object(deploy, 'command', return_value=json.dumps(current)) as cmd, \
             patch.object(deploy, 'migration_command', return_value=['read-plan']), \
             patch.object(deploy, 'write_private'):
            deploy.migrate('image')
            cmd.assert_called_once_with(['read-plan'], capture=True)
    def test_empty_plan_with_wrong_revision_blocks(self):
        import json
        current = {'current': ['082'], 'target': ['083'], 'pending': []}
        with patch.object(deploy, 'command', return_value=json.dumps(current)), \
             patch.object(deploy, 'migration_command', return_value=['read-plan']), \
             patch.object(deploy, 'write_private') as write:
            with self.assertRaises(RuntimeError): deploy.migrate('image')
            write.assert_not_called()


class CommandGuards(unittest.TestCase):
    def test_ci_cannot_activate_or_change_routing(self):
        for args in [['activate','openagents-backend:release-'+'a'*40], ['route','peer'], ['sh','-c','id'], ['run','a'*40]]:
            with self.assertRaises(ValueError): deploy.dispatch('ci',args)
    def test_peer_cannot_start_deployment_or_stage_image(self):
        for verb in ['deploy','stage','result']:
            with self.assertRaises(ValueError): deploy.dispatch('peer',[verb,'a'*40])
    def test_commit_injection_and_path_traversal_rejected(self):
        for sha in ['../secret','a'*40+';id','$(id)','a'*39,'A'*40]:
            with self.assertRaises(ValueError): deploy.stage(sha)
    def test_image_injection_rejected_before_docker(self):
        with patch.object(deploy,'command') as cmd:
            for image in ['ubuntu:latest','openagents-backend:release-'+ 'a'*40+';id','../secret']:
                with self.assertRaises(ValueError): deploy.validate(image)
            cmd.assert_not_called()
    def test_image_revision_must_match(self):
        with patch.object(deploy,'command',return_value='b'*40):
            with self.assertRaises(ValueError): deploy.validate('openagents-backend:release-'+'a'*40)


if __name__ == '__main__': unittest.main()
