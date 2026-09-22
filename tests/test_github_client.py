"""GitHub Data API client progress tests."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "github_sync" / "app"))

from github_client import GithubClient  # noqa: E402


class BlobProgressTests(unittest.IsolatedAsyncioTestCase):
    async def test_create_blobs_reports_each_completed_blob(self) -> None:
        client = GithubClient.__new__(GithubClient)
        calls: list[bytes] = []

        async def fake_create_blob(_owner: str, _repo: str, content: bytes) -> str:
            calls.append(content)
            return f"sha-{len(calls)}"

        client.create_blob = fake_create_blob  # type: ignore[method-assign]
        progress: list[tuple[int, int, str]] = []
        files = [("first.txt", b"one"), ("nested/second.txt", b"two")]

        result = await client.create_blobs(
            "octocat", "Hello-World", files, on_progress=lambda *event: progress.append(event)
        )

        self.assertEqual(set(result), {"first.txt", "nested/second.txt"})
        self.assertEqual(len(progress), len(files))
        self.assertEqual({event[0] for event in progress}, {1, 2})
        self.assertTrue(all(event[1] == 2 for event in progress))
        self.assertEqual({event[2] for event in progress}, set(result))


if __name__ == "__main__":
    unittest.main()
