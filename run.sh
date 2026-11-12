#!/usr/bin/env bash
# Run the app's Node commands in Docker (Node is not installed on this machine).
#   ./run.sh admin init | load-questions data/questions.json | add-admin NAME | add NAME [EMAIL] [--test] | list | ...
#   ./run.sh test                      unit tests (no database)
#   ./run.sh dev                       local server on http://localhost:3000 (needs DATABASE_URL)
#   ./run.sh vercel [args]             the Vercel CLI, e.g. ./run.sh vercel deploy --prod (first time: vercel login)
# DATABASE_URL, APP_URL and, for the local server, CONTACT_EMAIL and CONTACT_NAME are passed through from your shell.
# Vercel login is kept in ./.vercel-home (git-ignored). "./run.sh admin" alone lists every admin command.
set -euo pipefail
cd "$(dirname "$0")"
IMG=node:22-bookworm-slim
mkdir -p .vercel-home
TTY=(); [ -t 0 ] && [ -t 1 ] && TTY=(-it)
D=(docker run --rm "${TTY[@]}" --network host --user "$(id -u):$(id -g)" -e HOME=/app/.vercel-home
   -e DATABASE_URL="${DATABASE_URL:-}" -e APP_URL="${APP_URL:-}" -e PORT="${PORT:-3000}"
   -e CONTACT_EMAIL="${CONTACT_EMAIL:-}" -e CONTACT_NAME="${CONTACT_NAME:-}" -v "$PWD":/app -w /app "$IMG")
[ -d node_modules ] || "${D[@]}" npm install --no-audit --no-fund
case "${1:-}" in
  admin) shift; "${D[@]}" node scripts/admin.mjs "$@" ;;
  test) "${D[@]}" npm test ;;
  dev) "${D[@]}" node dev/server.mjs ;;
  vercel) shift; "${D[@]}" npx --yes vercel@63.1.2 "$@" ;;
  *) sed -n 2,8p "$0" ;;
esac
