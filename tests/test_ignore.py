"""Ignore matcher tests (no Home Assistant required)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "github_sync" / "app"))

from ignore import IgnoreMatcher  # noqa: E402


class IgnoreTests(unittest.TestCase):
    def test_directory_prefix(self) -> None:
        matcher = IgnoreMatcher(".storage/\n")
        self.assertTrue(matcher.is_ignored(".storage/core.config_entries", False))
        self.assertTrue(matcher.is_ignored(".storage", True))
        self.assertFalse(matcher.is_ignored("configuration.yaml", False))

    def test_glob_and_negation(self) -> None:
        matcher = IgnoreMatcher("*.log\n!keep.log\n")
        self.assertTrue(matcher.is_ignored("home-assistant.log", False))
        self.assertFalse(matcher.is_ignored("keep.log", False))
        self.assertFalse(matcher.is_ignored("notes.txt", False))

    def test_anchored_root_only(self) -> None:
        matcher = IgnoreMatcher("/root_only.txt\n")
        self.assertTrue(matcher.is_ignored("root_only.txt", False))
        self.assertFalse(matcher.is_ignored("sub/root_only.txt", False))

    def test_nested_unanchored(self) -> None:
        matcher = IgnoreMatcher("secrets.yaml\n")
        self.assertTrue(matcher.is_ignored("secrets.yaml", False))
        self.assertTrue(matcher.is_ignored("packages/secrets.yaml", False))

    def test_comments_and_blanks(self) -> None:
        matcher = IgnoreMatcher("# hello\n\n*.pyc\n")
        self.assertTrue(matcher.is_ignored("foo.pyc", False))
        self.assertEqual(len(matcher.rules), 1)


if __name__ == "__main__":
    unittest.main()
