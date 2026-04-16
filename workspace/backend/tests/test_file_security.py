# -*- coding: utf-8 -*-
"""
Security tests for file storage: path traversal prevention (CVE-6).

These tests verify that LocalFileStore.save never writes outside its base_dir,
regardless of what filename an agent supplies.
"""

import pytest

from app.storage import LocalFileStore


@pytest.fixture
def store(tmp_path):
    """A LocalFileStore rooted at a temporary directory."""
    return LocalFileStore(base_dir=str(tmp_path))


# ---------------------------------------------------------------------------
# Happy path — must still work after the fix
# ---------------------------------------------------------------------------

class TestLocalFileStoreNormalUsage:

    def test_normal_filename_is_saved(self, store, tmp_path):
        """Plain filenames work as before."""
        key = store.save("ws1", "file-1", "report.pdf", b"data")
        assert key == "ws1/file-1/report.pdf"
        assert (tmp_path / key).exists()
        assert (tmp_path / key).read_bytes() == b"data"

    def test_filename_with_extension_is_saved(self, store, tmp_path):
        key = store.save("ws1", "file-2", "image.png", b"\x89PNG")
        assert (tmp_path / key).exists()

    def test_filename_with_spaces_is_saved(self, store, tmp_path):
        key = store.save("ws1", "file-3", "my report.docx", b"doc")
        assert (tmp_path / key).exists()

    def test_storage_key_uses_safe_filename(self, store):
        """The returned key always uses the sanitized filename."""
        key = store.save("ws-abc", "file-xyz", "notes.txt", b"hello")
        assert key == "ws-abc/file-xyz/notes.txt"

    def test_read_roundtrip(self, store):
        """Data written by save can be read back via read."""
        payload = b"agent output data"
        key = store.save("ws1", "f1", "output.txt", payload)
        assert store.read(key) == payload

    def test_exists_returns_true_after_save(self, store):
        key = store.save("ws1", "f1", "file.bin", b"x")
        assert store.exists(key) is True

    def test_exists_returns_false_for_unknown_key(self, store):
        assert store.exists("ws1/f1/nonexistent.txt") is False


# ---------------------------------------------------------------------------
# Path traversal — all must raise ValueError (CVE-6)
# ---------------------------------------------------------------------------

class TestLocalFileStorePathTraversal:

    def test_dotdot_slash_is_blocked(self, store):
        """../../etc/passwd style traversal is rejected."""
        with pytest.raises(ValueError):
            store.save("ws1", "f1", "../../etc/passwd", b"evil")

    def test_single_dotdot_is_blocked(self, store):
        """../escape.txt is rejected."""
        with pytest.raises(ValueError):
            store.save("ws1", "f1", "../escape.txt", b"evil")

    def test_absolute_unix_path_is_blocked(self, store):
        """/etc/passwd as filename is rejected."""
        with pytest.raises(ValueError):
            store.save("ws1", "f1", "/etc/passwd", b"evil")

    def test_windows_absolute_path_is_blocked(self, store):
        """C:\\Windows\\System32\\evil.dll is rejected."""
        with pytest.raises(ValueError):
            store.save("ws1", "f1", "C:\\Windows\\System32\\evil.dll", b"evil")

    def test_deeply_nested_traversal_is_blocked(self, store):
        """a/b/c/../../../../etc/shadow is rejected."""
        with pytest.raises(ValueError):
            store.save("ws1", "f1", "a/b/c/../../../../etc/shadow", b"evil")

    def test_dot_only_filename_is_blocked(self, store):
        """'.' as filename is rejected."""
        with pytest.raises(ValueError):
            store.save("ws1", "f1", ".", b"data")

    def test_dotdot_only_filename_is_blocked(self, store):
        """'..' as filename is rejected."""
        with pytest.raises(ValueError):
            store.save("ws1", "f1", "..", b"data")

    def test_empty_filename_is_blocked(self, store):
        """Empty string filename is rejected."""
        with pytest.raises(ValueError):
            store.save("ws1", "f1", "", b"data")

    def test_slash_only_filename_is_blocked(self, store):
        """'/' reduces to an empty name and is rejected."""
        with pytest.raises(ValueError):
            store.save("ws1", "f1", "/", b"data")

    def test_embedded_slash_is_blocked(self, store):
        """'subdir/file.txt' contains a directory component and is rejected."""
        with pytest.raises(ValueError):
            store.save("ws1", "f1", "subdir/file.txt", b"data")

    def test_null_byte_in_filename_is_blocked(self, store):
        """Null byte in filename is rejected."""
        with pytest.raises((ValueError, OSError)):
            store.save("ws1", "f1", "file\x00.txt", b"data")


# ---------------------------------------------------------------------------
# Canary test — traversal attempt must never write outside base_dir
# ---------------------------------------------------------------------------

class TestNoEscapeFromBaseDir:
    """After any traversal attempt, nothing must be written outside base_dir."""

    def test_dotdot_does_not_create_file_in_parent(self, store, tmp_path):
        canary = tmp_path.parent / "_canary_cve6_test.txt"
        canary.unlink(missing_ok=True)
        try:
            store.save("ws1", "f1", "../_canary_cve6_test.txt", b"evil")
        except (ValueError, OSError):
            pass
        assert not canary.exists(), "Traversal wrote a file outside base_dir"

    def test_absolute_path_does_not_overwrite_existing_file(self, store, tmp_path):
        # Create a sentinel file outside base_dir
        sentinel = tmp_path.parent / "_sentinel_cve6.txt"
        sentinel.write_text("original")
        try:
            store.save("ws1", "f1", str(sentinel), b"overwritten")
        except (ValueError, OSError):
            pass
        assert sentinel.read_text() == "original", "Traversal overwrote a file outside base_dir"
        sentinel.unlink(missing_ok=True)

    def test_no_file_written_on_invalid_filename(self, store, tmp_path):
        """A rejected filename must leave the store directory unchanged."""
        before = set(tmp_path.rglob("*"))
        with pytest.raises((ValueError, OSError)):
            store.save("ws1", "f1", "../../injected.txt", b"evil")
        after = set(tmp_path.rglob("*"))
        assert before == after, "Files were created despite traversal rejection"
