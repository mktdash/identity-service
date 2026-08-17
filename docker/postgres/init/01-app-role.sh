set -eo pipefail

require_env() {
  local name="$1"
  if [ -z "${!name}" ]; then
    printf '01-app-role: %s is unset or empty. It is supplied by the postgres service in docker-compose.yml.\n' "$name" >&2
    exit 1
  fi
}

require_env POSTGRES_USER
require_env POSTGRES_DB
require_env APP_ROLE_NAME
require_env APP_ROLE_PASSWORD

run_psql() {
  if command -v docker_process_sql > /dev/null 2>&1; then
    docker_process_sql "$@"
  else
    PGHOST= PGHOSTADDR= psql \
      -v ON_ERROR_STOP=1 \
      --username "$POSTGRES_USER" \
      --no-password \
      --no-psqlrc \
      --dbname "$POSTGRES_DB" \
      "$@"
  fi
}

printf '01-app-role: creating application role %s in database %s (owner: %s)\n' \
  "$APP_ROLE_NAME" "$POSTGRES_DB" "$POSTGRES_USER"

run_psql \
  --set=app_role="$APP_ROLE_NAME" \
  --set=app_password="$APP_ROLE_PASSWORD" \
  --set=owner_role="$POSTGRES_USER" \
  --set=db_name="$POSTGRES_DB" \
  <<'SQL'
CREATE ROLE :"app_role"
  LOGIN
  PASSWORD :'app_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOBYPASSRLS;

GRANT CONNECT ON DATABASE :"db_name" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM :"app_role";

ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";

ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO :"app_role";
SQL
