/**
 * Thin fetch wrapper for the Ingress API.
 *
 * Every path is relative (`api/status`) because Home Assistant Ingress mounts
 * this app under an unpredictable prefix. Errors are normalised into
 * `ApiError` with the server `detail` message and the HTTP status so callers
 * can distinguish a rejected request (4xx) from a connection drop while the
 * container restarts (network error).
 */

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** `true` when the failure is a real HTTP response in the 4xx range. */
export function isRejected(error) {
  return Boolean(error && error.status >= 400 && error.status < 500);
}

export async function api(path, options = {}) {
  const { method = "GET", body, headers, ...rest } = options;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", ...(headers || {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      ...rest,
    });
  } catch (err) {
    throw new ApiError(err?.message || "Network request failed", 0);
  }

  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_err) {
      data = { detail: text };
    }
  }
  if (!res.ok) {
    throw new ApiError(data.detail || res.statusText || "Request failed", res.status);
  }
  return data;
}

/** Progress snapshot for long jobs (polled by the busy overlay). */
export function progressSnapshot() {
  return api("api/progress");
}
