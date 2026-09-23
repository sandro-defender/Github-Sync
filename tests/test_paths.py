"""Path sandbox tests (no Home Assistant required)."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "github_sync" / "app"))

from ignore import IgnoreMatcher  # noqa: E402
from paths import (  # noqa: E402
    PathError,
    browse_directory,
    collect_files,
    discover_roots,
    resolve_under_roots,
)


class PathTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "homeassistant"
        self.root.mkdir()
        (self.root / "esphome").mkdir()
        (self.root / "esphome" / "living.yaml").write_text("x\n", encoding="utf-8")
        self.roots = {"homeassistant": self.root.resolve()}

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_resolve_inside(self) -> None:
        path = resolve_under_roots(self.roots, "homeassistant/esphome")
        self.assertTrue(path.is_dir())
        self.assertEqual(path.name, "esphome")

    def test_blocks_escape(self) -> None:
        with self.assertRaises(PathError):
            resolve_under_roots(self.roots, "homeassistant/../../etc")

    def test_unknown_mount(self) -> None:
        with self.assertRaises(PathError):
            resolve_under_roots(self.roots, "not_a_mount/foo")

    def test_browse_root_and_child(self) -> None:
        listing = browse_directory(self.roots, "")
        names = [item["name"] for item in listing["entries"]]
        self.assertIn("homeassistant", names)
        child = browse_directory(self.roots, "homeassistant")
        child_names = [item["name"] for item in child["entries"]]
        self.assertIn("esphome", child_names)

    def test_discover_from_env(self) -> None:
        os.environ["GITHUB_SYNC_ROOTS"] = f"workspace:{self.root}"
        try:
            found = discover_roots()
            self.assertIn("workspace", found)
        finally:
            os.environ.pop("GITHUB_SYNC_ROOTS", None)

    def _collect(self, rules: str):
        matcher = IgnoreMatcher(rules)
        included, excluded, _truncated = collect_files(self.roots, "homeassistant", matcher)
        return (
            sorted(item["path"] for item in included),
            sorted(item["path"] for item in excluded),
        )

    def test_hand_folder_rule_prunes_children(self) -> None:
        # A hand-written folder rule keeps the pruning fast-path: children are
        # not walked or listed individually.
        included, excluded = self._collect("esphome/\n")
        self.assertEqual(included, [])
        self.assertEqual(excluded, ["esphome"])

    def test_catchall_expands_folders_so_files_stay_selectable(self) -> None:
        # The UI's "Uncheck all" adds `*`: files inside folders must stay
        # visible (not pruned with the folder) so each can be re-included.
        included, excluded = self._collect("*\n")
        self.assertEqual(included, [])
        self.assertEqual(excluded, ["esphome", "esphome/living.yaml"])

        # A negation chain re-includes one file under the catch-all rule.
        included, excluded = self._collect("*\n!/esphome/\n!/esphome/living.yaml\n")
        self.assertEqual(included, ["esphome/living.yaml"])
        self.assertEqual(excluded, [])


if __name__ == "__main__":
    unittest.main()
