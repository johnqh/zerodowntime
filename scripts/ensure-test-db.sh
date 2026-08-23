#!/usr/bin/env bash
# Makes sure a Postgres the tests can reach exists.
#
# GitHub's ubuntu runners ship PostgreSQL preinstalled but stopped, so CI can
# start it in-place. That keeps this repo's database needs entirely inside this
# repo, rather than adding a service container to the shared workflow that ~118
# other repos also call.
#
# Locally it does nothing: you already have Postgres running.
set -euo pipefail

DB_NAME="${TEST_DB_NAME:-craigsnotice_test}"

if [ -z "${CI:-}" ]; then
  echo "not CI — assuming a local Postgres is already running"
  exit 0
fi

echo "CI detected — starting the runner's PostgreSQL"
sudo systemctl start postgresql || sudo service postgresql start

# Wait for it, rather than racing the first query.
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then break; fi
  sleep 1
done

sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
sudo -u postgres psql -c "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}';" \
  | grep -q 1 || sudo -u postgres createdb "${DB_NAME}"

echo "ready: ${DB_NAME}"
