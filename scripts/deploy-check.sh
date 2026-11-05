#!/usr/bin/env bash
# Bring the image up in each of the documented setups (deploy/) from nothing, as an operator would, and check that each is up and keeps what it is
# given (task 1.10):
#
#   eval "docker build $(pnpm exec sovereign-manifest docker-args) -t tusk:ci ."
#   TUSK_IMAGE=tusk:ci scripts/deploy-check.sh        # all of them, or name some: sqld file postgres run
#
# For each compose setup it starts the files, waits for them to report healthy, asks /api/health which database it is on, takes the whole thing
# down *without* its volumes and up again (so the migrations have run twice against the same database and nothing broke), and stops the container
# with SIGTERM: it must stop within seconds and exit 143, the signal's own code. A container that had to be killed after the grace period would
# say 137. It never touches deploy/.env if there is one: it stops instead.
#
# `run` is not compose: it is the one `docker run` of DESIGN.md §23, as written, on a volume.
#
# A setting that is wrong must stop the image with a message that names it, and no value.
#
# Written for bash 3.2.
# $files is a list of `-f` arguments and is split on purpose.
# shellcheck disable=SC2086
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root/deploy"

image="${TUSK_IMAGE:-tusk}"
port="${TUSK_CHECK_PORT:-3987}"
setups="${*:-sqld file postgres run}"

if [ -e .env ]; then
  echo "deploy/.env exists; this check writes its own and will not overwrite yours. Move it aside and run again." >&2
  exit 2
fi

secret="$(openssl rand -base64 48)"
key="$(openssl rand -base64 32)"
password="$(openssl rand -hex 16)"

cat >.env <<ENV
TUSK_URL=http://localhost:$port
TUSK_AUTH_LOCAL=1
TUSK_AUTH_SECRET=$secret
TUSK_ENCRYPTION_KEY=$key
POSTGRES_PASSWORD=$password
ENV

project=""
files=""
cleanup() {
  if [ -n "$project" ]; then docker compose -p "$project" $files down -v --remove-orphans >/dev/null 2>&1 || true; fi
  rm -f .env
  docker rm -f tusk-check-run >/dev/null 2>&1 || true
  docker volume rm tusk-check-run >/dev/null 2>&1 || true
}
trap cleanup EXIT

export TUSK_IMAGE="$image" TUSK_PORT="$port"
fail() {
  echo "FAIL: $*" >&2
  if [ -n "$project" ]; then docker compose -p "$project" $files logs --no-color --tail 40 >&2 || true; fi
  exit 1
}

up() { docker compose -p "$project" $files up -d --no-build --wait --wait-timeout 240 >/dev/null 2>&1 || fail "$1: did not become healthy"; }

# What /api/health says its database is: `sqlite` for both of SQLite's forms, `postgres`.
database() { curl -sS --max-time 10 "http://localhost:$port/api/health" | sed -n 's/.*"database":"\([a-z]*\)".*/\1/p'; }

# The container's exit code after a stop, and how long the stop took, in seconds.
stop_and_check() {
  local name="$1" started elapsed code
  started="$(date +%s)"
  docker stop --time 10 "$name" >/dev/null
  elapsed=$(($(date +%s) - started))
  code="$(docker inspect -f '{{.State.ExitCode}}' "$name")"
  [ "$code" = 143 ] || fail "$2: stopped with exit code $code, not 143 (SIGTERM)"
  [ "$elapsed" -le 5 ] || fail "$2: took $elapsed s to stop, which is too long"
}

# $1 the setup's name, $2 the compose files, $3 the database it must be on.
check_compose() {
  echo "== $1"
  project="tusk-check-$1"
  files="$2"

  up "$1"
  [ "$(database)" = "$3" ] || fail "$1: the database is '$(database)', not '$3'"

  # Down without the volumes and up again: the database is the same, and the migrations run a second time against it.
  docker compose -p "$project" $files down >/dev/null 2>&1 || fail "$1: could not stop"
  up "$1 (again)"
  [ "$(database)" = "$3" ] || fail "$1: after a restart the database is '$(database)', not '$3'"
  docker compose -p "$project" $files logs web 2>&1 | grep -q 'migrations applied' || fail "$1: the migrations were not reported as applied"

  stop_and_check "$(docker compose -p "$project" $files ps -q web)" "$1"
  docker compose -p "$project" $files down -v --remove-orphans >/dev/null 2>&1 || true
  project=""
  files=""
  echo "   ok"
}

# The one docker run of DESIGN.md §23, as written: a file, on a named volume, with the settings it names.
check_run() {
  echo "== run"
  docker volume rm tusk-check-run >/dev/null 2>&1 || true
  docker run -d --name tusk-check-run -p "127.0.0.1:$port:3000" -v tusk-check-run:/data \
    -e TUSK_DB_DIALECT=sqlite -e TUSK_SQLITE_URL=file:/data/tusk.db \
    -e TUSK_URL="https://tusk.example.com" -e TUSK_AUTH_LOCAL=1 -e TUSK_AUTH_SECRET="$secret" -e TUSK_ENCRYPTION_KEY="$key" \
    "$image" >/dev/null
  for attempt in $(seq 1 60); do
    if [ "$(database)" = sqlite ]; then break; fi
    if [ "$attempt" = 60 ]; then
      docker logs --tail 40 tusk-check-run >&2
      fail "run: did not come up"
    fi
    sleep 1
  done
  [ "$(docker exec tusk-check-run id -un)" = node ] || fail "run: the process is root"
  docker exec tusk-check-run test -f /data/tusk.db || fail "run: the database file is not on the volume"
  stop_and_check tusk-check-run run
  docker rm tusk-check-run >/dev/null
  docker volume rm tusk-check-run >/dev/null
  echo "   ok"
}

# A wrong setting stops the image, with a message that names it and no value. Needs no database: the settings are checked first.
check_refusal() {
  echo "== a wrong setting"
  local out status
  set +e
  out="$(docker run --rm -e TUSK_URL=http://tusk.example.com "$image" 2>&1)"
  status=$?
  set -e
  [ "$status" -ne 0 ] || fail "a plain-http TUSK_URL did not stop the image"
  echo "$out" | grep -q 'TUSK_URL' || fail "the refusal does not name TUSK_URL: $out"
  if echo "$out" | grep -q 'tusk.example.com'; then fail "the refusal repeats the value"; fi
  echo "   ok"
}

for setup in $setups; do
  case "$setup" in
    sqld) check_compose sqld "-f compose.yaml" sqlite ;;
    file) check_compose file "-f compose.file.yaml" sqlite ;;
    postgres) check_compose postgres "-f compose.yaml -f compose.postgres.yaml" postgres ;;
    run) check_run ;;
    *) echo "unknown setup: $setup (sqld file postgres run)" >&2; exit 2 ;;
  esac
done
check_refusal
echo "all setups ok"
