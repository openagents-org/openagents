import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollout import rollout, RolloutError


class Node:
    def __init__(self, name, calls):
        self.name, self.calls, self.image = name, calls, 'old'
        self.ok = True
        self.fail_activate = False
        self.fail_verify = False
        self.fail_rollback = False
    def status(self): return {'image': self.image, 'ready': self.ok}
    def validate(self, image): self.calls.append((self.name, 'validate', image))
    def route(self, mode): self.calls.append((self.name, 'route', mode))
    def activate(self, image):
        self.calls.append((self.name, 'activate', image)); self.image = image
        if (image == 'new' and self.fail_activate) or (image == 'old' and self.fail_rollback):
            self.ok = False; raise RuntimeError('bad candidate')
        self.ok = True
    def verify(self):
        if self.image == 'new' and self.fail_verify: raise RuntimeError('smoke failed')


class Balancer:
    def __init__(self, nodes, calls): self.members = set(n.name for n in nodes); self.calls = calls
    def contains_all(self, nodes): return self.members == {n.name for n in nodes}
    def remove(self, n):
        self.calls.append((n.name, 'remove')); self.members.discard(n.name)
        assert self.members, 'last backend removed'
    def add(self, n): self.calls.append((n.name, 'add')); self.members.add(n.name)


class RolloutTests(unittest.TestCase):
    def setUp(self):
        self.calls, self.records = [], []
        self.nodes = [Node('secondary', self.calls), Node('primary', self.calls)]
        self.lb = Balancer(self.nodes, self.calls)
        self.migrations = 0
    def migrate(self): self.migrations += 1; self.calls.append(('migrate',))
    def run_rollout(self, migrate=None, verify=None):
        return rollout(self.nodes, self.lb, 'new', migrate or self.migrate,
                       verify or (lambda: None), self.records.append, lambda phase: None)
    def test_secondary_first_and_migration_once(self):
        self.run_rollout()
        self.assertEqual(self.migrations, 1)
        self.assertEqual([x[0] for x in self.calls if len(x)>1 and x[1]=='activate'], ['secondary','primary'])
        self.assertLess(self.calls.index(('migrate',)), self.calls.index(('secondary','remove')))
        self.assertEqual(self.records[-1]['status'], 'deployed')
    def test_unhealthy_peer_blocks_any_change(self):
        self.nodes[1].ok = False
        with self.assertRaises(RolloutError): self.run_rollout()
        self.assertEqual(self.migrations, 0)
        self.assertFalse(any('remove' in x for x in self.calls))
    def test_migration_failure_keeps_both_nodes_untouched(self):
        def fail(): raise RuntimeError('migration failed')
        with self.assertRaises(RuntimeError): self.run_rollout(migrate=fail)
        self.assertEqual([n.image for n in self.nodes], ['old','old'])
        self.assertFalse(any('remove' in x for x in self.calls))
    def test_failed_secondary_restores_it_and_never_replaces_primary(self):
        self.nodes[0].fail_activate=True
        with self.assertRaises(RolloutError): self.run_rollout()
        self.assertEqual([n.image for n in self.nodes], ['old','old'])
        self.assertNotIn(('primary','activate','new'), self.calls)
        self.assertEqual(self.records[-1]['status'], 'rolled_back')
    def test_failed_primary_restores_broken_node_before_secondary(self):
        self.nodes[1].fail_activate=True
        with self.assertRaises(RolloutError): self.run_rollout()
        self.assertEqual([n.image for n in self.nodes], ['old','old'])
        self.assertEqual(self.records[-1]['status'], 'rolled_back')
    def test_smoke_failure_rolls_back(self):
        self.nodes[0].fail_verify=True
        with self.assertRaises(RolloutError): self.run_rollout()
        self.assertEqual([n.image for n in self.nodes], ['old','old'])
    def test_public_failure_rolls_back_both(self):
        def fail(): raise RuntimeError('public failed')
        with self.assertRaises(RolloutError): self.run_rollout(verify=fail)
        self.assertEqual([n.image for n in self.nodes], ['old','old'])
    def test_failed_rollback_stays_out_of_pool(self):
        self.nodes[0].fail_activate=True;self.nodes[0].fail_rollback=True
        with self.assertRaises(RolloutError): self.run_rollout()
        self.assertEqual(self.lb.members, {'primary'})
        self.assertEqual(self.records[-1]['status'], 'rollback_failed')
    def test_unexpected_pool_membership_blocks_deployment(self):
        self.lb.members.add('unexpected')
        with self.assertRaises(RolloutError): self.run_rollout()
        self.assertEqual(self.migrations, 0)


if __name__ == '__main__': unittest.main()
