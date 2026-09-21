#!/usr/bin/with-contenv bashio
set -euo pipefail

LOG_LEVEL="$(bashio::config 'log_level' 'info')"
bashio::log.info "Starting GitHub Sync (log level: ${LOG_LEVEL})"

export GITHUB_SYNC_LOG_LEVEL="${LOG_LEVEL}"
export GITHUB_SYNC_DATA="/data/github_sync.json"

cd /app
exec python3 -m uvicorn main:app --host 0.0.0.0 --port 8099 --log-level "${LOG_LEVEL}"
