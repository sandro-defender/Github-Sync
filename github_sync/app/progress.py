"""In-memory progress for long Check / Upload / Download jobs."""

from __future__ import annotations

from typing import Any


class ProgressHub:
    """Track one job per mapping id."""

    def __init__(self) -> None:
        self._jobs: dict[str, dict[str, Any]] = {}

    def start(self, mapping_id: str, message: str, total: int = 0) -> None:
        self._jobs[mapping_id] = {
            "mapping_id": mapping_id,
            "message": message,
            "current": 0,
            "total": total,
            "done": False,
            "error": None,
        }

    def update(
        self,
        mapping_id: str,
        *,
        message: str | None = None,
        current: int | None = None,
        total: int | None = None,
    ) -> None:
        job = self._jobs.get(mapping_id)
        if not job:
            self.start(mapping_id, message or "Working…", total or 0)
            job = self._jobs[mapping_id]
        if message is not None:
            job["message"] = message
        if current is not None:
            job["current"] = current
        if total is not None:
            job["total"] = total

    def finish(self, mapping_id: str, error: str | None = None) -> None:
        job = self._jobs.get(mapping_id)
        if not job:
            return
        job["done"] = True
        job["error"] = error
        if error:
            job["message"] = error
        elif not job.get("message"):
            job["message"] = "Done"

    def snapshot(self, mapping_id: str | None = None) -> dict[str, Any]:
        if mapping_id:
            return {"job": self._jobs.get(mapping_id)}
        active = [job for job in self._jobs.values() if not job.get("done")]
        latest = active[-1] if active else None
        return {"jobs": list(self._jobs.values()), "latest": latest}
