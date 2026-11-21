#!/bin/sh
# STEP 8: run the automated tests against a SEPARATE database and Redis db,
# so tests never touch the demo data. Run with:  docker compose exec api npm test
set -e
export DATABASE_URL="${TEST_DATABASE_URL:-postgresql://certiflow:certiflow@localhost:5432/certiflow_test}"
export REDIS_URL="${TEST_REDIS_URL:-redis://localhost:6379/1}"
export FILES_DIR="/tmp/certiflow-test-files"
export LOG_LEVEL="silent"
export JWT_SECRET="test-secret"
npx prisma migrate deploy
npx vitest run
