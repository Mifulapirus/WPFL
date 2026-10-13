#!/usr/bin/env sh
# Push the match tracker to Capek-Web and restart it (data/ and .env on the server are untouched).
#   sh deploy/deploy.sh            (from software/match-tracker, needs ssh access as angel@capek-web)
set -e
cd "$(dirname "$0")/.."
HOST=${DEPLOY_HOST:-angel@capek-web}
DIR=${DEPLOY_DIR:-/srv/apps/wpfl-match-tracker}
tar czf - package.json package-lock.json server.js src public deploy .env.example README.md |
  ssh "$HOST" "mkdir -p '$DIR' && tar xzf - -C '$DIR' && cd '$DIR' && npm ci --omit=dev --no-audit --no-fund &&
    (pm2 describe wpfl-match-tracker >/dev/null 2>&1 && pm2 reload wpfl-match-tracker || pm2 start deploy/ecosystem.config.cjs) &&
    pm2 save >/dev/null && sleep 1 && curl -fsS http://127.0.0.1:3110/healthz && echo"
