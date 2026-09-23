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
    collect_tree,
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


class TreeScanTests(unittest.TestCase):
    """`collect_tree` — the file explorer's one-level-at-a-time scan."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "homeassistant"
        self.root.mkdir()
        (self.root / "esphome" / "living").mkdir(parents=True)
        (self.root / ".storage").mkdir()
        (self.root / "esphome" / ".git").mkdir()
        (self.root / "esphome" / ".git" / "HEAD").write_text("no\n", encoding="utf-8")
        files = {
            "esphome/kitchen.yaml": "aaa\n",
            "esphome/living/lights.yaml": "bb\n",
            "esphome/living/debug.log": "c\n",
            ".storage/core.config": "dddd\n",
            "a.log": "e\n",
            "secrets.yaml": "f\n",
        }
        for rel, text in files.items():
            (self.root / rel).write_text(text, encoding="utf-8")
        (self.root / "link").symlink_to(self.root / "esphome")
        self.roots = {"homeassistant": self.root.resolve()}

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _tree(self, rules: str, **kwargs):
        matcher = IgnoreMatcher(rules)
        return collect_tree(self.roots, "homeassistant", matcher, **kwargs)

    def test_root_level_lists_folders_then_files(self) -> None:
        result = self._tree("*.log\n")
        names = [entry["name"] for entry in result["levels"][""]["entries"]]
        self.assertEqual(names[:4], [".storage", "esphome", "link", "a.log"])
        self.assertIn("secrets.yaml", names)

    def test_folder_rollups_are_recursive_and_accurate(self) -> None:
        entries = {item["path"]: item for item in self._tree("*.log\n")["levels"][""]["entries"]}
        esphome = entries["esphome"]
        self.assertTrue(esphome["is_dir"])
        self.assertEqual(esphome["files"], 3)
        self.assertEqual(esphome["included"], 2)  # kitchen + lights, debug.log is a *.log
        self.assertEqual(esphome["excluded"], 1)
        self.assertEqual(esphome["dirs"], 1)  # living
        self.assertEqual(esphome["included_size"], 7)  # 4 bytes of kitchen.yaml + 3 of lights.yaml
        self.assertTrue(esphome["complete"])
        self.assertFalse(esphome["ignored"])

    def test_always_ignored_git_is_neither_listed_nor_counted(self) -> None:
        result = self._tree("")
        paths = [entry["path"] for entry in result["levels"][""]["entries"]]
        self.assertNotIn("esphome/.git", paths)
        # The rollup of `esphome` counts its two real files, not `.git/HEAD`.
        esphome = next(i for i in result["levels"][""]["entries"] if i["path"] == "esphome")
        self.assertEqual(esphome["files"], 3)

    def test_symlinked_folder_can_not_be_opened(self) -> None:
        link = next(i for i in self._tree("")["levels"][""]["entries"] if i["path"] == "link")
        self.assertTrue(link["is_dir"])
        self.assertTrue(link["symlink"])
        self.assertFalse(link["can_open"])
        self.assertTrue(link["unknown"])

    def test_ignored_folder_stays_collapsed_until_it_is_opened(self) -> None:
        result = self._tree(".storage/\n")
        storage = next(i for i in result["levels"][""]["entries"] if i["path"] == ".storage")
        self.assertTrue(storage["ignored"])
        self.assertEqual(storage["pattern"], ".storage/")
        self.assertTrue(storage["unknown"], "its files were not walked")
        self.assertEqual(result["levels"].keys(), {""}, "nothing was listed inside it")

        opened = self._tree(".storage/\n", levels=[{"path": ".storage"}])
        inner = opened["levels"][".storage"]["entries"]
        self.assertEqual([item["path"] for item in inner], [".storage/core.config"])
        self.assertTrue(inner[0]["ignored"], "its files are still ignored, so they can be picked one by one")
        self.assertEqual(inner[0]["pattern"], ".storage/")

    def test_catchall_rule_keeps_folder_files_counted(self) -> None:
        # `*` (the UI's "Uncheck all") must not hide the tree from the counts.
        result = self._tree("*\n")
        root = result["root"]
        self.assertEqual(root["included"], 0)
        self.assertEqual(root["files"], 6)
        self.assertEqual(root["excluded"], 6)
        esphome = next(i for i in result["levels"][""]["entries"] if i["path"] == "esphome")
        self.assertTrue(esphome["ignored"])
        self.assertFalse(esphome["unknown"])

    def test_levels_are_paged_not_truncated(self) -> None:
        first = self._tree("", levels=[{"path": "", "offset": 0, "size": 2}])["levels"][""]
        self.assertEqual([i["name"] for i in first["entries"]], [".storage", "esphome"])
        self.assertEqual(first["total"], 5)  # two folders, one link, two files
        self.assertTrue(first["has_more"])

        second = self._tree("", levels=[{"path": "", "offset": 2, "size": 2}])["levels"][""]
        self.assertEqual([i["name"] for i in second["entries"]], ["link", "a.log"])
        self.assertEqual(second["offset"], 2)

        rest = self._tree("", levels=[{"path": "", "offset": 4, "size": 2}])["levels"][""]
        self.assertEqual([i["name"] for i in rest["entries"]], ["secrets.yaml"])
        self.assertFalse(rest["has_more"])

    def test_depth_expands_every_level_like_expand_all(self) -> None:
        result = self._tree("*.log\n", depth=3)
        self.assertIn("esphome/living", result["levels"])
        nested = [i["path"] for i in result["levels"]["esphome/living"]["entries"]]
        self.assertEqual(nested, ["esphome/living/debug.log", "esphome/living/lights.yaml"])

    def test_search_walks_ignored_folders_too(self) -> None:
        result = self._tree(".storage/\n", query="core")
        hits = result["search"]["entries"]
        self.assertEqual([hit["path"] for hit in hits], [".storage/core.config"])
        self.assertTrue(hits[0]["ignored"])
        self.assertEqual(result["search"]["query"], "core")

    def test_search_matches_folders_and_paths_case_insensitively(self) -> None:
        hits = self._tree("", query="KITCHEN")["search"]["entries"]
        self.assertEqual([hit["path"] for hit in hits], ["esphome/kitchen.yaml"])

    def test_capped_level_keeps_counting(self) -> None:
        for index in range(8):
            (self.root / "esphome" / f"extra-{index}.yaml").write_text("x\n", encoding="utf-8")
        result = collect_tree(
            self.roots, "homeassistant", IgnoreMatcher(""), levels=[{"path": "esphome"}], list_limit=3
        )
        level = result["levels"]["esphome"]
        self.assertTrue(level["capped"], "the listing stopped, not the walk")
        self.assertEqual(len(level["entries"]), 3)
        # The folder's rollup still counted every file inside it (kitchen,
        # the two under living/, plus the eight new ones).
        esphome = next(i for i in result["levels"][""]["entries"] if i["path"] == "esphome")
        self.assertEqual(esphome["files"], 11)
        self.assertTrue(esphome["complete"])
        self.assertFalse(result["truncated"], "a capped listing is not a cut-short scan")

    def test_unsafe_level_is_rejected(self) -> None:
        with self.assertRaises(PathError):
            self._tree("", levels=[{"path": "../etc"}])

    def test_walk_limit_marks_the_scan_incomplete(self) -> None:
        result = self._tree("", walk_limit=2)
        self.assertTrue(result["truncated"])
        self.assertFalse(result["root"]["complete"])
        self.assertEqual(result["scanned"], 2)

    def test_outside_the_mounts_is_rejected(self) -> None:
        from paths import resolve_under_roots

        with self.assertRaises(PathError):
            resolve_under_roots(self.roots, "homeassistant/../../etc")


if __name__ == "__main__":
    unittest.main()
