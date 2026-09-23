"""`POST api/preview_tree` — the file explorer's scan endpoint.

The UI reads the mapping folder one level at a time so a tick can never be
based on a truncated list. These tests pin the wire contract (levels, paging,
search, sandboxing, junk input) without touching GitHub or a token.
"""

import tempfile
import unittest
from pathlib import Path

import httpx

import main


class PreviewTreeApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name) / "homeassistant"
        (root / "esphome" / "living").mkdir(parents=True)
        (root / ".storage").mkdir()
        (root / "esphome" / "kitchen.yaml").write_text("kitchen\n", encoding="utf-8")
        (root / "esphome" / "living" / "lights.yaml").write_text("lights\n", encoding="utf-8")
        (root / "esphome" / "living" / "debug.log").write_text("log\n", encoding="utf-8")
        (root / ".storage" / "core.config").write_text("secret\n", encoding="utf-8")
        (root / "a.log").write_text("log\n", encoding="utf-8")
        self.roots = {"homeassistant": root.resolve()}
        main.app.state.roots = self.roots
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()
        self.tmp.cleanup()

    async def post(self, **body):
        response = await self.client.post("/api/preview_tree", json=body)
        return response

    async def test_only_the_requested_levels_are_listed(self) -> None:
        result = (
            await self.post(local_path="homeassistant", ignore="*.log\n", direction="upload")
        ).json()
        self.assertEqual(result["direction"], "upload")
        self.assertEqual(set(result["levels"]), {""})
        paths = [entry["path"] for entry in result["levels"][""]["entries"]]
        self.assertEqual(paths, [".storage", "esphome", "a.log"])
        self.assertEqual(result["root"]["included"], 3)  # kitchen, lights, core.config
        self.assertEqual(result["root"]["excluded"], 2)  # debug.log + a.log
        self.assertFalse(result["truncated"])

        opened = await self.post(
            local_path="homeassistant",
            ignore="*.log\n",
            levels=[{"path": "esphome"}, {"path": "esphome/living"}],
        )
        data = opened.json()
        self.assertEqual(set(data["levels"]), {"", "esphome", "esphome/living"})
        self.assertEqual(
            [entry["path"] for entry in data["levels"]["esphome"]["entries"]],
            ["esphome/living", "esphome/kitchen.yaml"],
        )

    async def test_download_side_is_echoed(self) -> None:
        result = (await self.post(local_path="homeassistant", ignore="", direction="download")).json()
        self.assertEqual(result["direction"], "download")

    async def test_defaults_to_upload_when_no_direction_is_sent(self) -> None:
        result = (await self.post(local_path="homeassistant", ignore="")).json()
        self.assertEqual(result["direction"], "upload")

    async def test_paging_and_search_survive_the_http_layer(self) -> None:
        paged = (
            await self.post(local_path="homeassistant", ignore="", levels=[{"path": "", "offset": 1, "size": 1}])
        ).json()
        level = paged["levels"][""]
        self.assertEqual([entry["name"] for entry in level["entries"]], ["esphome"])
        self.assertTrue(level["has_more"])
        self.assertEqual(level["total"], 3)

        searched = (await self.post(local_path="homeassistant", ignore="*.log\n", query="DEBUG")).json()
        self.assertEqual([hit["path"] for hit in searched["search"]["entries"]], ["esphome/living/debug.log"])

    async def test_expand_all_depth_returns_nested_levels(self) -> None:
        result = (await self.post(local_path="homeassistant", ignore="", depth=3)).json()
        self.assertIn("esphome/living", result["levels"])

    async def test_paths_outside_the_mounts_are_rejected(self) -> None:
        response = await self.post(local_path="homeassistant/../../etc", ignore="")
        self.assertEqual(response.status_code, 400)
        self.assertIn("outside", response.json()["detail"].lower())

    async def test_unsafe_level_paths_are_rejected(self) -> None:
        response = await self.post(local_path="homeassistant", ignore="", levels=[{"path": "../.ssh"}])
        self.assertEqual(response.status_code, 400)
        self.assertIn("unsafe", response.json()["detail"].lower())

    async def test_junk_options_are_clamped_instead_of_crashing(self) -> None:
        response = await self.post(
            local_path="homeassistant",
            ignore="",
            page_size="wide",
            depth=None,
            levels=["nope", {"path": 5, "offset": -3, "size": "big"}],
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        # The mapping folder is always answered, and a level that does not
        # exist comes back empty rather than as an error.
        self.assertIn("", data["levels"])
        self.assertEqual(data["levels"]["5"]["entries"], [])
        self.assertGreaterEqual(data["levels"][""]["page_size"], 1)


if __name__ == "__main__":
    unittest.main()
