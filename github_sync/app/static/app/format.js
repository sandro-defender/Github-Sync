/** Display formatting helpers (pure functions, safe outside the browser). */

/** Human readable byte size, e.g. `1.4 MB`. */
export function bytes(value) {
  const num = Number(value) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1048576) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / 1048576).toFixed(1)} MB`;
}

/** Compact relative time, e.g. `5 min ago`, falling back to a locale string. */
export function relTime(iso) {
  if (!iso) return "Never synced";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return String(iso);
  const delta = Date.now() - then;
  const min = Math.round(delta / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} h ago`;
  return new Date(iso).toLocaleString();
}

/** Absolute timestamp for tooltips. */
export function absoluteTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : date.toLocaleString();
}

/** `1 file` / `3 files`. */
export function count(value, singular, plural) {
  const num = Number(value) || 0;
  return `${num} ${num === 1 ? singular : plural || `${singular}s`}`;
}

/** Progress ratio (0–100) from a progress job snapshot. */
export function percent(current, total) {
  const done = Number(current) || 0;
  const all = Number(total) || 0;
  if (all <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / all) * 100)));
}

/** First 7 characters of a commit sha (or an em dash). */
export function shortSha(sha) {
  return sha ? String(sha).slice(0, 7) : "—";
}

/** Auto-sync interval label for a minutes value. */
export function intervalLabel(minutes) {
  const value = Number(minutes) || 60;
  if (value === 1440) return "Daily";
  if (value === 360) return "Every 6 hours";
  if (value === 60) return "Hourly";
  if (value === 15) return "Every 15 minutes";
  return `Every ${value} min`;
}

/** Auto-sync action label. */
export function directionLabel(direction) {
  if (direction === "download") return "Download";
  if (direction === "check") return "Check only";
  return "Upload";
}

/**
 * Last-sync summary for a mapping, e.g. `Uploaded 12 files · 5 min ago`.
 */
export function lastSyncLabel(last) {
  if (!last) return "Never synced";
  const when = relTime(last.at);
  const verb = last.direction === "download" ? "Downloaded" : last.direction === "upload" ? "Uploaded" : "Checked";
  const amount = last.uploaded ?? last.downloaded ?? null;
  return amount === null || amount === undefined ? `${verb} · ${when}` : `${verb} ${count(amount, "file")} · ${when}`;
}

/** Narrow a free-form repository filter box into a predicate. */
export function matchesQuery(query, ...values) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(needle));
}
