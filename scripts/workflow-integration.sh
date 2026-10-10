#!/usr/bin/env bash
set -euo pipefail

# Each invocation gets fresh test services and removes them on exit.
mysql_id=""
redis_id=""
cleanup() {
  if [[ -n "$mysql_id" ]]; then docker rm -f "$mysql_id" >/dev/null 2>&1 || true; fi
  if [[ -n "$redis_id" ]]; then docker rm -f "$redis_id" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM

mysql_id="$(docker run --rm -d -p 127.0.0.1::3306 \
  -e MYSQL_ROOT_PASSWORD=peper24_root_dev \
  -e MYSQL_DATABASE=peper24_test \
  -e MYSQL_USER=peper24 \
  -e MYSQL_PASSWORD=peper24_dev \
  --health-cmd='mysqladmin ping -h 127.0.0.1 -upeper24 -ppeper24_dev' \
  --health-interval=2s --health-retries=45 mysql:8.0)"
redis_id="$(docker run --rm -d -p 127.0.0.1::6379 \
  --health-cmd='redis-cli ping' --health-interval=2s --health-retries=15 redis:7-alpine)"

for _ in {1..60}; do
  mysql_health="$(docker inspect --format '{{.State.Health.Status}}' "$mysql_id")"
  redis_health="$(docker inspect --format '{{.State.Health.Status}}' "$redis_id")"
  if [[ "$mysql_health" == healthy && "$redis_health" == healthy ]]; then break; fi
  if [[ "$mysql_health" == unhealthy || "$redis_health" == unhealthy ]]; then
    echo "Test services became unhealthy" >&2
    exit 1
  fi
  sleep 1
done

if [[ "$mysql_health" != healthy || "$redis_health" != healthy ]]; then
  echo "Timed out waiting for test services" >&2
  exit 1
fi

mysql_port="$(docker port "$mysql_id" 3306/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
redis_port="$(docker port "$redis_id" 6379/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
MYSQL_HOST=127.0.0.1 MYSQL_PORT="$mysql_port" MYSQL_DATABASE=peper24_test \
  REDIS_HOST=127.0.0.1 REDIS_PORT="$redis_port" REDIS_KEY_PREFIX=peper24:workflow:test: \
  pnpm run test:integration
