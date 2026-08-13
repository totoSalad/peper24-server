#!/usr/bin/env bash
set -Eeuo pipefail

archive=${1:-}
release_id=${2:-}

if [[ ! -f "$archive" || ! "$release_id" =~ ^[0-9a-f]{7,64}$ ]]; then
  echo "usage: $0 <archive.tar.gz> <git-sha>" >&2
  exit 2
fi

base=/opt/peper24
releases="$base/releases/server"
current="$base/current/server"
shared="$base/shared/server"
release="$releases/$release_id"
previous=$(readlink -f "$current" 2>/dev/null || true)

mkdir -p "$releases" "$shared"
if [[ -e "$release" ]]; then
  echo "release already exists: $release" >&2
  exit 1
fi

while IFS= read -r entry; do
  if [[ "$entry" = /* || "$entry" = ../* || "$entry" = *'/../'* ]]; then
    echo "unsafe archive entry: $entry" >&2
    exit 1
  fi
done < <(tar -tzf "$archive")

mkdir -p "$release"
tar --warning=no-unknown-keyword -xzf "$archive" -C "$release"
test -f "$release/package.json"
test -f "$shared/.env.production"
chown -R deploy:deploy "$release"

runuser -u deploy -- /bin/bash -c "
  set -Eeuo pipefail
  export HOME=/home/deploy
  export XDG_CONFIG_HOME=/home/deploy/.config
  export XDG_CACHE_HOME=/home/deploy/.cache
  cd '$release'
  pnpm config set registry https://registry.npmmirror.com
  pnpm install --frozen-lockfile
  pnpm build
  pnpm exec tsc --noEmit false --sourceMap false

  argon_dir=\$(find node_modules/.pnpm -type d -path '*/argon2@*/node_modules/argon2' -print -quit)
  if [[ -n \"\$argon_dir\" ]]; then
    cd \"\$argon_dir\"
    rm -rf build
    npm_config_python=/usr/bin/python3.11 npm_config_build_from_source=true ./node_modules/.bin/node-gyp-build
    cd '$release'
  fi

  set -a
  . '$shared/.env.production'
  set +a
  export NODE_ENV=production MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 REDIS_HOST=127.0.0.1 REDIS_PORT=6379
  pnpm migrate
  pnpm prune --prod
"

ln -sfn "$release" "$current.next"
mv -Tf "$current.next" "$current"
systemctl restart peper24-api

healthy=false
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:7001/api/health >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "$healthy" != true ]]; then
  echo "health check failed; restoring previous release" >&2
  if [[ -n "$previous" && -d "$previous" ]]; then
    ln -sfn "$previous" "$current.next"
    mv -Tf "$current.next" "$current"
    systemctl restart peper24-api
  fi
  exit 1
fi

rm -f "$archive"
find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr \
  | awk 'NR > 5 { sub(/^[^ ]+ /, ""); print }' \
  | while IFS= read -r old_release; do
      [[ "$old_release" == "$previous" ]] || rm -rf -- "$old_release"
    done

echo "server deployed: $release_id"
