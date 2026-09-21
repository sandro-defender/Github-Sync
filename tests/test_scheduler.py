"""Auto-sync due-date helper tests."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "github_sync" / "app"))

from scheduler import Scheduler  # noqa: E402


class SchedulerDueTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sched = Scheduler(MagicMock(), MagicMock(), MagicMock(), MagicMock())

    def test_disabled(self) -> None:
        self.assertFalse(self.sched.due({"auto_sync": False, "auto_interval_minutes": 15}, 1_000_000))

    def test_never_ran(self) -> None:
        mapping = {"auto_sync": True, "auto_interval_minutes": 15}
        self.assertTrue(self.sched.due(mapping, 1_000_000))

    def test_not_yet_due(self) -> None:
        mapping = {
            "auto_sync": True,
            "auto_interval_minutes": 60,
            "last_auto_at": "2026-09-22T10:00:00Z",
        }
        now = 1_748_000_000  # far, but we compare delta from parsed ISO
        # 2026-09-22T10:00:00Z is about 1.75e9; use parsed + 10s
        from scheduler import _parse_iso

        stamp = _parse_iso(mapping["last_auto_at"])
        assert stamp is not None
        self.assertFalse(self.sched.due(mapping, stamp + 10))
        self.assertTrue(self.sched.due(mapping, stamp + 60 * 60 + 1))


if __name__ == "__main__":
    unittest.main()
