"""Background auto-sync for folder mappings."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import TYPE_CHECKING, Any, Callable, Awaitable

if TYPE_CHECKING:
    from aiohttp import ClientSession
    from progress import ProgressHub
    from store import Store

_LOGGER = logging.getLogger(__name__)

MIN_INTERVAL = 5


def _parse_iso(value: str | None) -> float | None:
    if not value:
        return None
    try:
        text = value.replace("Z", "+00:00")
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return None


class Scheduler:
    """Every 30s, run due auto-sync mappings."""

    def __init__(
        self,
        store: Store,
        session: ClientSession,
        progress: ProgressHub,
        run_mapping: Callable[[dict[str, Any], str], Awaitable[Any]],
    ) -> None:
        self.store = store
        self.session = session
        self.progress = progress
        self.run_mapping = run_mapping
        self._busy: set[str] = set()

    def due(self, mapping: dict[str, Any], now: float) -> bool:
        if not mapping.get("auto_sync"):
            return False
        try:
            interval = int(mapping.get("auto_interval_minutes") or 0)
        except (TypeError, ValueError):
            return False
        if interval < MIN_INTERVAL:
            return False
        last = mapping.get("last_auto_at") or (mapping.get("last_sync") or {}).get("at")
        stamp = _parse_iso(last)
        if stamp is None:
            return True
        return (now - stamp) >= interval * 60

    async def tick(self, now: float | None = None) -> list[str]:
        """Run every mapping that is due. Returns mapping ids that ran."""
        import time

        now = time.time() if now is None else now
        if not (self.store.data.get("access_token") or ""):
            return []
        ran: list[str] = []
        for mapping in list(self.store.data.get("mappings") or []):
            mapping_id = mapping.get("id") or ""
            if not mapping_id or mapping_id in self._busy:
                continue
            if not self.due(mapping, now):
                continue
            direction = mapping.get("auto_direction") or "upload"
            if direction not in ("upload", "download", "check"):
                direction = "upload"
            self._busy.add(mapping_id)
            try:
                _LOGGER.info("Auto-sync %s (%s)", mapping.get("name"), direction)
                await self.run_mapping(mapping, direction)
                mapping["last_auto_at"] = _iso_now()
                await self.store.save()
                ran.append(mapping_id)
            except Exception as err:  # noqa: BLE001
                _LOGGER.exception("Auto-sync failed for %s", mapping_id)
                mapping["last_auto_at"] = _iso_now()
                mapping["last_error"] = str(err)
                await self.store.save()
            finally:
                self._busy.discard(mapping_id)
        return ran

    async def loop(self) -> None:
        while True:
            await asyncio.sleep(30)
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                _LOGGER.exception("Scheduler tick failed")


def _iso_now() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
