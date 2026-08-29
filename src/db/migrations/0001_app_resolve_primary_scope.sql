CREATE FUNCTION app_resolve_primary_scope(p_user_id uuid)
RETURNS TABLE (
  membership_id      uuid,
  organization_id    uuid,
  workspace_id       uuid,
  role_id            uuid,
  role_slug          text,
  data_scope         text,
  permission_version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    m.id,
    m.organization_id,
    m.workspace_id,
    m.role_id,
    r.slug,
    m.data_scope,
    m.permission_version
  FROM memberships m
  JOIN roles r         ON r.id = m.role_id
  JOIN organizations o ON o.id = m.organization_id
  JOIN workspaces w    ON w.id = m.workspace_id
  WHERE m.user_id = p_user_id
    AND m.status  = 'active'
    AND o.status  = 'active'
    AND o.deleted_at IS NULL
    AND w.status  = 'active'
    AND w.deleted_at IS NULL
  ORDER BY m.created_at, m.id
  LIMIT 1;
$$;
--> statement-breakpoint
COMMENT ON FUNCTION app_resolve_primary_scope(uuid) IS
  'Tenancy bootstrap (ADR 0005). Returns the caller''s oldest active membership — the founding workspace — as the primary scope to open a session against. Read-only, one row maximum, one user only.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_resolve_primary_scope(uuid) FROM PUBLIC;
--> statement-breakpoint
-- The application role's EXECUTE grant comes from the ALTER DEFAULT PRIVILEGES set up
-- in docker/postgres/init/01-app-role.sh, so this migration never has to name it. If
-- that wiring is absent in an environment, the function would deploy silently
-- unusable and every sign-up would 500 on verification — fail the migration instead.
DO $$
DECLARE
  grantees text;
BEGIN
  SELECT string_agg(grantee, ', ')
    INTO grantees
    FROM information_schema.routine_privileges
   WHERE specific_schema = 'public'
     AND routine_name    = 'app_resolve_primary_scope'
     AND privilege_type  = 'EXECUTE'
     AND grantee NOT IN ('PUBLIC', current_user);

  IF grantees IS NULL THEN
    RAISE EXCEPTION
      'No application role holds EXECUTE on app_resolve_primary_scope(uuid). Expected ALTER DEFAULT PRIVILEGES FOR ROLE % IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO <app role>; grant it explicitly before re-running.',
      current_user;
  END IF;

  RAISE NOTICE 'app_resolve_primary_scope(uuid) executable by: %', grantees;
END
$$;
