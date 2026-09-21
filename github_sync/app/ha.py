"""Home Assistant Supervisor helpers (persistent notifications)."""

from __future__ import annotations

import logging
import os
from typing import Any

from aiohttp import ClientError, ClientSession, ClientTimeout

_LOGGER = logging.getLogger(__name__)

SUPERVISOR_CORE = "http://supervisor/core/api"


def supervisor_token() -> str | None:
    return os.environ.get("SUPERVISOR_TOKEN") or os.environ.get("HASSIO_TOKEN")


async def notify_ha(
    session: ClientSession,
    *,
    title: str,
    message: str,
    notification_id: str,
) -> None:
    """Create a persistent notification in Home Assistant. No-op outside Supervisor."""
    token = supervisor_token()
    if not token:
        _LOGGER.debug("Skipping HA notification (no SUPERVISOR_TOKEN)")
        return
    payload: dict[str, Any] = {
        "title": title,
        "message": message,
        "notification_id": notification_id,
    }
    try:
        async with session.post(
            f"{SUPERVISOR_CORE}/services/persistent_notification/create",
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            timeout=ClientTimeout(total=10),
        ) as resp:
            if resp.status >= 400:
                text = await resp.text()
                _LOGGER.warning("HA notification failed (%s): %s", resp.status, text[:200])
    except (TimeoutError, ClientError) as err:
        _LOGGER.warning("Cannot reach Home Assistant for notification: %s", err)
