#!/bin/sh
set -eu
: "${PORT:=8080}"
: "${CHROMA_UPSTREAM:=http://chromadb.railway.internal:8000}"
export PORT CHROMA_UPSTREAM
if [ -z "${CHROMA_ADMIN_TOKEN:-}" ] || [ -z "${CHROMA_READ_TOKEN:-}" ]; then
  echo "CHROMA_ADMIN_TOKEN and CHROMA_READ_TOKEN must be set" >&2
  exit 1
fi
if [ "$CHROMA_ADMIN_TOKEN" = "$CHROMA_READ_TOKEN" ]; then
  echo "CHROMA_ADMIN_TOKEN and CHROMA_READ_TOKEN must differ" >&2
  exit 1
fi
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
