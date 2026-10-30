import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).parents[1] / 'track_branch.py'
spec = importlib.util.spec_from_file_location('preview_track_branch', SCRIPT)
track = importlib.util.module_from_spec(spec)
spec.loader.exec_module(track)


class BranchGuards(unittest.TestCase):
    def test_accepts_plain_branch_names(self):
        for value in ['beta', 'develop', 'release/1.2']:
            self.assertEqual(track.require_branch(value), value)

    def test_rejects_refspec_injection(self):
        for value in ['', '-beta', 'beta:refs/heads/main', '+beta', 'a..b', 'beta id', 'refs/*']:
            with self.assertRaises(ValueError):
                track.require_branch(value)


if __name__ == '__main__':
    unittest.main()
