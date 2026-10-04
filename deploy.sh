#!/usr/bin/env sh
# Run on a Linux server from the repository checkout after local .env setup.
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  printf '%s\n' 'Missing .env. Configure it privately on the server first.' >&2
  exit 1
fi
docker compose version >/dev/null
docker compose config --quiet
docker compose up -d --build
printf '%s\n' 'Started. Check: docker compose logs --tail=50 bot'
printf '%s\n' 'After 30 seconds: docker compose exec bot python -m descobuddy health'
printf '%s\n' 'Keep the local PC bot stopped while the server runs this token.'
