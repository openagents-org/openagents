"""Exercise the real shell installer with an isolated HOME and offline packages."""

import io
import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

INSTALLER = Path(__file__).resolve().parents[1] / "install.sh"
NODE = shutil.which("node")


@unittest.skipUnless(NODE, "Node.js required")
class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.prefix = self.root / ".openagents/nodejs"
        (self.prefix / "bin").mkdir(parents=True)
        # Node itself works; npm is a dangling link, as on the reported host.
        (self.prefix / "bin/node").symlink_to(NODE)
        (self.prefix / "bin/npm").symlink_to("../lib/node_modules/npm/bin/npm-cli.js")
        (self.bin / "node").symlink_to(NODE)
        self.script(
            self.bin / "uname",
            """
case "$1" in
  -s) echo Linux;;
  -m) echo "${TEST_ARCH:-x86_64}";;
esac
""",
        )
        self.npm = '#!/bin/sh\ncase "$1" in\n--version) echo 10.9.0;;\nview) case "$*" in *npmmirror*) [ "${FAIL_MIRROR:-}" = 1 ] && exit 1;; *) [ "${FAIL_REGISTRY:-}" = 1 ] && exit 1;; esac; echo 1.2.3;;\nesac\n'
        self.archive(
            "runtime.tar.xz",
            {
                "runtime/bin/node": '#!/bin/sh\nexec "' + NODE + '" "$@"\n',
                "runtime/bin/npm": self.npm,
                "runtime/lib/node_modules/npm/bin/npm-cli.js": self.npm,
            },
            "w:xz",
        )
        self.archive(
            "core.tgz",
            {
                "package/package.json": '{"version":"1.2.3"}',
                "package/bin/agent-connector.js": 'console.log("1.2.3")',
            },
        )
        self.archive("blessed.tgz", {"package/package.json": '{"version":"1.2.3"}'})
        self.script(
            self.bin / "curl",
            """
for url do :; done
case "$url" in
  *nodejs.org*) echo runtime >> "$HOME/downloads"; echo "$url" >> "$HOME/runtime-urls"; cat "$HOME/runtime.tar.xz";;
  *agent-launcher*) echo "$url" >> "$HOME/core-urls"; cat "$HOME/core.tgz";;
  *blessed*) cat "$HOME/blessed.tgz";;
  *) exit 2;;
esac
""",
        )
        self.env = {
            **os.environ,
            "HOME": str(self.root),
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "OPENAGENTS_SKIP_PAIRING": "1",
        }

    def script(self, path, body):
        path.write_text("#!/bin/sh\n" + body)
        path.chmod(0o755)

    def archive(self, name, entries, mode="w:gz"):
        with tarfile.open(self.root / name, mode) as archive:
            for name, body in entries.items():
                data = body.encode()
                entry = tarfile.TarInfo(name)
                entry.size, entry.mode = len(data), 0o755
                archive.addfile(entry, io.BytesIO(data))

    def run_installer(self):
        return subprocess.run(["bash", str(INSTALLER)], env=self.env, capture_output=True, text=True, timeout=30)

    def test_repairs_dangling_npm_and_reruns_without_repair(self):
        sentinel = self.prefix / "node_modules/existing-agent/data"
        sentinel.parent.mkdir(parents=True)
        sentinel.write_text("keep me")
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Installation complete!", result.stderr)
        self.assertEqual(sentinel.read_text(), "keep me")
        cli = self.prefix / "node_modules/.bin/openagents"
        self.assertEqual(subprocess.check_output([str(cli)], text=True).strip(), "1.2.3")
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "downloads").read_text(), "runtime\n")

    def test_registry_failure_has_actionable_error(self):
        self.env["FAIL_REGISTRY"] = "1"
        self.env["FAIL_MIRROR"] = "1"
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Could not fetch the OpenAgents CLI version from npm", result.stderr)
        self.assertNotIn("Installation complete!", result.stderr)

    def test_registry_failure_keeps_a_working_install(self):
        # A rerun (e.g. to pair a new workspace) must not fail just because the
        # registry is unreachable when the CLI is already installed.
        self.assertEqual(self.run_installer().returncode, 0)
        self.env["FAIL_REGISTRY"] = "1"
        self.env["FAIL_MIRROR"] = "1"
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("keeping installed v1.2.3", result.stderr)
        self.assertIn("Installation complete!", result.stderr)

    def test_falls_back_to_the_npmmirror_registry(self):
        self.env["FAIL_REGISTRY"] = "1"
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("registry.npmmirror.com", (self.root / "core-urls").read_text())

    def test_unsuccessful_npm_repair_has_actionable_error(self):
        self.archive("runtime.tar.xz", {"runtime/README": "incomplete runtime"}, "w:xz")
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("npm is still unavailable after repairing", result.stderr)

    def test_portable_runtime_download_matches_linux_architecture(self):
        """Repair uses the host architecture even when system Node works."""
        for machine, node_arch in [("aarch64", "arm64"), ("arm64", "arm64"), ("x86_64", "x64")]:
            with self.subTest(machine=machine):
                self.env["TEST_ARCH"] = machine
                # Keep system Node available, but require a portable repair.
                shutil.rmtree(self.prefix)
                result = self.run_installer()
                self.assertEqual(result.returncode, 0, result.stderr)
                url = (self.root / "runtime-urls").read_text().splitlines()[-1]
                self.assertTrue(url.endswith(f"-linux-{node_arch}.tar.xz"), url)

    def test_bootstrap_download_matches_linux_architecture(self):
        """Without Node or a package manager, bootstrap selects the right tarball."""
        # Hide host package managers and Node, including /usr/bin/node on Linux.
        for command in ["bash", "cat", "chmod", "dirname", "grep", "head", "mkdir", "rm", "tar", "xz"]:
            (self.bin / command).symlink_to(shutil.which(command))
        (self.bin / "node").unlink()
        self.env["PATH"] = str(self.bin)
        for machine, node_arch in [("aarch64", "arm64"), ("arm64", "arm64"), ("x86_64", "x64")]:
            with self.subTest(machine=machine):
                self.env["TEST_ARCH"] = machine
                shutil.rmtree(self.prefix)
                result = self.run_installer()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("Downloading Node.js portable...", result.stderr)
                url = (self.root / "runtime-urls").read_text().splitlines()[-1]
                self.assertTrue(url.endswith(f"-linux-{node_arch}.tar.xz"), url)

    def test_unsupported_linux_architecture_fails_before_download(self):
        """Unknown architectures must not silently receive an x64 runtime."""
        self.env["TEST_ARCH"] = "riscv64"
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unsupported Linux architecture: riscv64", result.stderr)
        self.assertFalse((self.root / "downloads").exists())

    def test_unrunnable_portable_node_does_not_report_success(self):
        """Executable permission alone does not prove a runtime can execute."""
        self.archive(
            "runtime.tar.xz",
            {
                "runtime/bin/node": "#!/bin/sh\nexit 126\n",
                "runtime/bin/npm": self.npm,
            },
            "w:xz",
        )
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Portable Node.js could not run", result.stderr)
        self.assertNotIn("Portable Node.js v22.22.3 installed", result.stderr)
        self.assertFalse((self.root / "core-urls").exists())


if __name__ == "__main__":
    unittest.main()
