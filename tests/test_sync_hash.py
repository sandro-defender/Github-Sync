"""Git blob SHA and repo-name helpers."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "github_sync" / "app"))

from paths import PathError  # noqa: E402
from sync import MAX_FILE_SHAS, cap_file_shas, git_blob_sha, split_repo  # noqa: E402


class HashTests(unittest.TestCase):
    def test_empty_blob(self) -> None:
        self.assertEqual(
            git_blob_sha(b""),
            "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
        )

    def test_hello_blob(self) -> None:
        self.assertEqual(
            git_blob_sha(b"hello\n"),
            "ce013625030ba8dba906f756967f9e9ca394464a",
        )

    def test_split_repo(self) -> None:
        self.assertEqual(split_repo("octocat/Hello-World"), ("octocat", "Hello-World"))
        with self.assertRaises(PathError):
            split_repo("not-a-repo")
        with self.assertRaises(PathError):
            split_repo("")

    def test_cap_file_shas_passthrough(self) -> None:
        self.assertEqual(cap_file_shas(None), (None, False, 0))
        small = {"a.txt": "1", "b.txt": "2"}
        self.assertEqual(cap_file_shas(small), (small, False, 2))

    def test_cap_file_shas_truncates_large_snapshots(self) -> None:
        big = {f"file-{i:05d}.txt": f"sha{i}" for i in range(MAX_FILE_SHAS + 100)}
        capped, truncated, total = cap_file_shas(big)
        assert capped is not None
        self.assertTrue(truncated)
        self.assertEqual(total, MAX_FILE_SHAS + 100)
        self.assertEqual(len(capped), MAX_FILE_SHAS)
        self.assertIn("file-00000.txt", capped)


if __name__ == "__main__":
    unittest.main()
