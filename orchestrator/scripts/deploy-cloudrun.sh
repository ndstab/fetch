#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="locus-fetch-494106"
REGION="us-central1"
SERVICE_NAME="fetch-orchestrator"

CREATE_SQL_INSTANCE="false"
SQL_INSTANCE_NAME="fetch-pg"
SQL_DB_NAME="fetch"
SQL_DB_USER="postgres"
SQL_DB_PASSWORD="P455w0rd"

LOCUS_API_KEY="${LOCUS_API_KEY:-claw_dev_cWy_C2WJrJq6K61Ov6LYYZWb74Lsncz8}"
LOCUS_MODE="real"
LOCUS_API_BASE="https://beta-api.paywithlocus.com/api"
LOCUS_BUILD_API_BASE="https://beta-api.buildwithlocus.com/v1"
LOCUS_ALLOW_UNSIGNED_WEBHOOK="true"
SERVICE_FEE_BPS="1000"
QUEST_IMAGE_URI="nginxinc/nginx-unprivileged:stable-alpine"
QUEST_HEALTH_PATH="/"

FRONTEND_URL="https://fetch-woad-five.vercel.app"
PUBLIC_URL_OVERRIDE="https://fetch-orchestrator-7zuypm3gzq-uc.a.run.app"

ENABLE_SERVICES=(
  "run.googleapis.com"
  "cloudbuild.googleapis.com"
  "secretmanager.googleapis.com"
  "sqladmin.googleapis.com"
)

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud not found."
  exit 1
fi

if [[ "$PROJECT_ID" == "REPLACE_GCP_PROJECT_ID" ]]; then
  echo "Set PROJECT_ID in this script first."
  exit 1
fi

if [[ "$LOCUS_API_KEY" == "REPLACE_LOCUS_API_KEY" ]]; then
  echo "Set LOCUS_API_KEY in this script or export LOCUS_API_KEY before running."
  exit 1
fi

if [[ "$FRONTEND_URL" == "https://REPLACE_FRONTEND_DOMAIN" ]]; then
  echo "Set FRONTEND_URL in this script first."
  exit 1
fi

echo "Project: $PROJECT_ID"
echo "Region:  $REGION"
echo "Service: $SERVICE_NAME"
echo "Create SQL instance: $CREATE_SQL_INSTANCE"
read -r -p "Continue? (y/N): " confirm
if [[ "${confirm:-}" != "y" && "${confirm:-}" != "Y" ]]; then
  echo "Cancelled."
  exit 1
fi

gcloud config set project "$PROJECT_ID"

DB_URL=""
if [[ "$CREATE_SQL_INSTANCE" == "true" ]]; then
  if [[ "$SQL_DB_PASSWORD" == "REPLACE_DB_PASSWORD" ]]; then
    echo "Set SQL_DB_PASSWORD before CREATE_SQL_INSTANCE=true."
    exit 1
  fi

  gcloud sql databases create "$SQL_DB_NAME" \
    --instance="$SQL_INSTANCE_NAME" || true

  gcloud sql users set-password "$SQL_DB_USER" \
    --instance="$SQL_INSTANCE_NAME" \
    --password="$SQL_DB_PASSWORD"

  SQL_CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE_NAME" --format='value(connectionName)')"
  DB_URL="postgres://${SQL_DB_USER}:${SQL_DB_PASSWORD}@/${SQL_DB_NAME}?host=/cloudsql/${SQL_CONNECTION_NAME}"
else
  read -r -p "Enter DATABASE_URL for Cloud Run: " DB_URL
  read -r -p "Enter Cloud SQL connection name (or leave blank): " SQL_CONNECTION_NAME
fi

if [[ -z "${DB_URL}" ]]; then
  echo "DATABASE_URL is required."
  exit 1
fi

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "LOCUS_MODE=${LOCUS_MODE},LOCUS_API_KEY=${LOCUS_API_KEY},LOCUS_API_BASE=${LOCUS_API_BASE},LOCUS_BUILD_API_BASE=${LOCUS_BUILD_API_BASE},LOCUS_ALLOW_UNSIGNED_WEBHOOK=${LOCUS_ALLOW_UNSIGNED_WEBHOOK},SERVICE_FEE_BPS=${SERVICE_FEE_BPS},QUEST_IMAGE_URI=${QUEST_IMAGE_URI},QUEST_HEALTH_PATH=${QUEST_HEALTH_PATH},FRONTEND_URL=${FRONTEND_URL},DATABASE_URL=${DB_URL}" \
  $( [[ -n "${SQL_CONNECTION_NAME:-}" ]] && echo "--add-cloudsql-instances ${SQL_CONNECTION_NAME}" )

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"
FINAL_PUBLIC_URL="${PUBLIC_URL_OVERRIDE:-$SERVICE_URL}"

gcloud run services update "$SERVICE_NAME" \
  --region "$REGION" \
  --update-env-vars "PUBLIC_URL=${FINAL_PUBLIC_URL}"

echo "Done."
echo "Cloud Run URL: $SERVICE_URL"
echo "PUBLIC_URL set to: $FINAL_PUBLIC_URL"
echo "Set frontend VITE_API_BASE to: $SERVICE_URL"
