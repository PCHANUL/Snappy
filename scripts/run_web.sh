#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"

cd "$ROOT_DIR"

if ! command -v flutter >/dev/null 2>&1; then
  echo "flutter command not found. Install Flutter or add it to PATH." >&2
  exit 1
fi

echo "Starting Snappy web server at http://${HOST}:${PORT}"
exec flutter run -d web-server --web-hostname "$HOST" --web-port "$PORT"
