"""Git blob SHA and repo-name helpers."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "github_sync" / "app"))

from paths import PathError  # noqa: E402
from sync import git_blob_sha, split_repo  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
