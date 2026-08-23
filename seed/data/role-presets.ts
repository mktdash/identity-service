import { ROLE_SLUGS, type DataScope, type RoleSlug } from "#config/constants";

export type RolePreset = {
  readonly slug: RoleSlug;
  readonly name: string;
  readonly description: string;
  readonly defaultDataScope: DataScope;
};

export const SUPER_ADMIN_PRESET: RolePreset = {
  slug: ROLE_SLUGS.superAdmin,
  name: "Super Admin",
  description:
    "Full control of the organization: billing, SSO, role definitions, data retention, workspaces, and support impersonation.",
  defaultDataScope: "organization",
};

export const ROLE_PRESETS: readonly RolePreset[] = [
  SUPER_ADMIN_PRESET,
  {
    slug: ROLE_SLUGS.admin,
    name: "Admin",
    description:
      "Full control of a workspace: members, role assignment, asset grants, and all channel operations.",
    defaultDataScope: "workspace",
  },
  {
    slug: ROLE_SLUGS.manager,
    name: "Manager",
    description:
      "Runs day-to-day sending: sequences, templates, and the team's conversations. Cannot change billing or role definitions.",
    defaultDataScope: "workspace",
  },
  {
    slug: ROLE_SLUGS.agent,
    name: "Agent",
    description:
      "Works the conversations assigned to them, and sends from the channel accounts explicitly granted to their membership.",
    defaultDataScope: "own",
  },
  {
    slug: ROLE_SLUGS.analyst,
    name: "Analyst",
    description:
      "Read-only access to reporting and aggregate performance. Cannot read individual message bodies unless explicitly granted.",
    defaultDataScope: "workspace",
  },
  {
    slug: ROLE_SLUGS.clientGuest,
    name: "Client Guest",
    description:
      "An external stakeholder with a narrow read-only view of the work done for them. Inside the workspace's tenancy, but permitted almost nothing within it.",
    defaultDataScope: "own",
  },
  {
    slug: ROLE_SLUGS.billingContact,
    name: "Billing Contact",
    description:
      "Sees invoices, plan and payment method for the organization, and nothing operational.",
    defaultDataScope: "organization",
  },
];
