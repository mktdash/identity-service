import postgres from "postgres";
import { toPostgresSslOption } from "#config/database-url";
import { databaseConnection } from "#config/env";

const TENANT_TABLES = [
  "organizations",
  "workspaces",
  "memberships",
  "roles",
  "outbox",
] as const;

const NON_TENANT_TABLES = [
  "users",
  "credentials",
  "sessions",
  "refresh_tokens",
] as const;

const sql = postgres({
  host: databaseConnection.host,
  port: databaseConnection.port,
  database: databaseConnection.database,
  user: databaseConnection.user,
  password: databaseConnection.password,
  ssl: toPostgresSslOption(databaseConnection.sslMode),
  max: 1,
  onnotice: () => undefined,
});

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) {
    failures.push(message);
  }
}

try {
  const [role] = await sql<
    { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
  >`
    select rolname, rolsuper, rolbypassrls
    from pg_roles where rolname = current_user
  `;

  if (role === undefined) {
    throw new Error("Could not resolve the connected role");
  }

  check(
    !role.rolsuper,
    `Application role "${role.rolname}" is SUPERUSER — every RLS policy is a no-op for it`,
  );
  check(
    !role.rolbypassrls,
    `Application role "${role.rolname}" holds BYPASSRLS — every RLS policy is a no-op for it`,
  );

  const tables = await sql<
    {
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      owner: string;
      policy_count: number;
    }[]
  >`
    select
      c.relname,
      c.relrowsecurity,
      c.relforcerowsecurity,
      pg_get_userbyid(c.relowner) as owner,
      (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policy_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  `;

  const byName = new Map(tables.map((table) => [table.relname, table]));

  for (const name of TENANT_TABLES) {
    const table = byName.get(name);

    if (table === undefined) {
      failures.push(`Tenant table "${name}" does not exist`);
      continue;
    }

    check(
      table.relrowsecurity,
      `"${name}" does not have ROW LEVEL SECURITY enabled`,
    );

    check(
      table.relforcerowsecurity,
      `"${name}" has RLS enabled but not FORCED — the table owner bypasses its own policies`,
    );
    check(
      table.policy_count > 0,
      `"${name}" has RLS forced but zero policies — it denies everything, which is a bug too`,
    );
    check(
      table.owner !== role.rolname,
      `"${name}" is owned by the application role "${role.rolname}" — an owner is exempt from its own policies unless forced, and this is one ALTER away from a leak`,
    );
  }

  for (const name of NON_TENANT_TABLES) {
    if (!byName.has(name)) {
      failures.push(`Expected table "${name}" does not exist`);
    }
  }

  const declared = new Set<string>([...TENANT_TABLES, ...NON_TENANT_TABLES]);
  for (const table of tables) {
    if (table.relname.startsWith("__drizzle")) {
      continue;
    }
    check(
      declared.has(table.relname),
      `Table "${table.relname}" is not classified in scripts/verify-rls.ts — declare it as tenant-scoped (with a policy) or explicitly non-tenant`,
    );
  }

  for (const name of TENANT_TABLES) {
    if (name === "roles") {
      continue;
    }

    const rows = await sql.unsafe<{ count: number }[]>(
      `select count(*)::int as count from "${name}"`,
    );
    check(
      (rows[0]?.count ?? -1) === 0,
      `Unscoped SELECT on "${name}" returned rows — the policy is not filtering on an unset tenant scope`,
    );
  }

  const [roleVisibility] = await sql<
    { tenant_owned: number; presets: number }[]
  >`
    select
      count(*) filter (where organization_id is not null)::int as tenant_owned,
      count(*) filter (where organization_id is null)::int     as presets
    from roles
  `;

  check(
    (roleVisibility?.tenant_owned ?? -1) === 0,
    `Unscoped SELECT on "roles" exposed ${roleVisibility?.tenant_owned ?? "?"} organization-owned role(s) — a tenant's custom roles must not be visible without a scope`,
  );

  check(
    (roleVisibility?.presets ?? 0) > 0,
    "No seeded role presets are visible — registration cannot bind an owner to Super Admin. Run `pnpm seed:system`.",
  );

  if (failures.length > 0) {
    process.stderr.write(
      `\nRLS verification FAILED (${failures.length}):\n` +
        failures.map((failure) => `  ✗ ${failure}`).join("\n") +
        "\n\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `\nRLS verification passed.\n` +
        `  role            : ${role.rolname} (nosuperuser, nobypassrls)\n` +
        `  tenant tables   : ${TENANT_TABLES.join(", ")}\n` +
        `  non-tenant      : ${NON_TENANT_TABLES.join(", ")}\n\n`,
    );
  }
} finally {
  await sql.end({ timeout: 5 });
}
