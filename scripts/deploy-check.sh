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
# `sovereign` is how an instance hosts it (task 2.10): what `sv apply` gives an app, which is the settings under Tusk's own names, secrets as `_FILE`s, a PostgreSQL
# it made, and a PORT that is not the image's own. It must come up, offer Sovereign and no password, answer its notices' addresses, serve its icon to a visitor with
# no session, and stop on SIGTERM. (A published board is not asked for: it needs an account, which needs a core to sign in through.)
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
setups="${*:-sqld file postgres run sovereign}"

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
secrets_dir=""
cleanup() {
  if [ -n "$project" ]; then docker compose -p "$project" $files down -v --remove-orphans >/dev/null 2>&1 || true; fi
  rm -f .env
  docker rm -f tusk-check-run tusk-check-sov tusk-check-sov-pg >/dev/null 2>&1 || true
  docker volume rm tusk-check-run >/dev/null 2>&1 || true
  docker network rm tusk-check-sov >/dev/null 2>&1 || true
  if [ -n "${secrets_dir:-}" ]; then rm -rf "$secrets_dir"; fi
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
  docker run -d --name tusk-check-run -p "127.0.0.1:$port:3002" -v tusk-check-run:/data \
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

# An instance hosting the app: PostgreSQL it made, secrets as files, a port of its own, and a core that is not there (the app starts without one).
check_sovereign() {
  echo "== sovereign"
  local sov_port=3555 base pw label file
  # The image says what it needs by carrying its manifest as a label, equal to the file (the instance reads the label, not the source).
  label="$(docker inspect -f '{{index .Config.Labels "io.github.sovereignfs.app-manifest"}}' "$image")"
  file="$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync("../sovereign.manifest.json", "utf8"))))')"
  [ "$label" = "$file" ] || fail "sovereign: the image's manifest label is not sovereign.manifest.json (build it with the arguments sovereign-manifest docker-args prints)"
  base="http://localhost:$port"
  pw="$(openssl rand -hex 16)"
  secrets_dir="$(mktemp -d)"
  printf '%s' "$secret" >"$secrets_dir/auth_secret"
  printf '%s' "$key" >"$secrets_dir/encryption_key"
  printf '%s' "$(openssl rand -hex 16)" >"$secrets_dir/core_secret"
  printf '%s' "postgres://tusk:$pw@tusk-check-sov-pg:5432/tusk" >"$secrets_dir/postgres_url"
  chmod 644 "$secrets_dir"/*
  chmod 755 "$secrets_dir"

  docker network create tusk-check-sov >/dev/null
  docker run -d --name tusk-check-sov-pg --network tusk-check-sov \
    -e POSTGRES_USER=tusk -e POSTGRES_DB=tusk -e POSTGRES_PASSWORD="$pw" postgres:16-alpine >/dev/null
  for attempt in $(seq 1 60); do
    if docker exec tusk-check-sov-pg pg_isready -U tusk -d tusk >/dev/null 2>&1; then break; fi
    if [ "$attempt" = 60 ]; then fail "sovereign: PostgreSQL did not come up"; fi
    sleep 1
  done

  docker run -d --name tusk-check-sov --network tusk-check-sov -p "127.0.0.1:$port:$sov_port" -v "$secrets_dir:/run/secrets:ro" \
    -e PORT="$sov_port" -e TUSK_URL="$base" -e TUSK_AUTH_SIGNUP=open \
    -e TUSK_DB_DIALECT=postgres -e TUSK_POSTGRES_URL_FILE=/run/secrets/postgres_url \
    -e TUSK_AUTH_SECRET_FILE=/run/secrets/auth_secret -e TUSK_ENCRYPTION_KEY_FILE=/run/secrets/encryption_key \
    -e TUSK_CORE_URL=https://core.sovereign.invalid -e TUSK_CORE_CLIENT_ID=tusk -e TUSK_CORE_CLIENT_SECRET_FILE=/run/secrets/core_secret \
    "$image" >/dev/null
  for attempt in $(seq 1 90); do
    if [ "$(database)" = postgres ]; then break; fi
    if [ "$attempt" = 90 ]; then
      docker logs --tail 40 tusk-check-sov >&2
      fail "sovereign: did not come up on port $sov_port"
    fi
    sleep 1
  done

  # Offers Sovereign and no password; sign-up and reset are not there.
  local page
  page="$(curl -sS --max-time 10 "$base/sign-in")"
  echo "$page" | grep -q 'Sign in with Sovereign' || fail "sovereign: the sign-in page does not offer Sovereign"
  if echo "$page" | grep -qi 'type="password"'; then fail "sovereign: the sign-in page asks for a password"; fi
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$base/sign-up")" = 404 ] || fail "sovereign: /sign-up is not a 404"
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$base/forgot-password")" = 404 ] || fail "sovereign: /forgot-password is not a 404"

  # Its icon, to a visitor with no session; and the addresses of its notices, which are there (a 400 for a request with no token, and not a 404).
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$base/icons/icon.svg")" = 200 ] || fail "sovereign: the icon is not served"
  # (A body with no token is refused before core is asked anything; a token that only looks like one would be answered 503 here, where the core is not.)
  for address in backchannel-logout account-deleted; do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST -d 'unrelated=1' "$base/api/sovereign/$address")" = 400 ] ||
      fail "sovereign: /api/sovereign/$address does not refuse a request with no token"
  done

  [ "$(docker exec tusk-check-sov id -un)" = node ] || fail "sovereign: the process is root"
  stop_and_check tusk-check-sov sovereign
  # Only the app was stopped, and the PostgreSQL it was given is still running: a plain `docker rm` of it is refused.
  docker rm tusk-check-sov >/dev/null
  docker rm -f tusk-check-sov-pg >/dev/null
  docker network rm tusk-check-sov >/dev/null
  rm -rf "$secrets_dir"
  secrets_dir=""
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
    sovereign) check_sovereign ;;
    *) echo "unknown setup: $setup (sqld file postgres run sovereign)" >&2; exit 2 ;;
  esac
done
check_refusal
echo "all setups ok"
