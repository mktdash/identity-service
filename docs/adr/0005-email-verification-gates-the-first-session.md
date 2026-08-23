# 5. Email verification gates the first session

Date: 2026-08-21

## Status

Accepted. Supersedes the sign-up response shape introduced alongside ADR 0004.

## Context

The first implementation of `POST /v1/auth/register` returned a full token pair
on `201` — sign-up signed you straight in.

Reading `mktdash-web` showed that is not the flow the product implements. Its
`SignUpOutcome` routes on `verification-required` and redirects to
`/verify-email?email=…`; there is a complete verification feature slice
(`features/verify-email/`) built around a **six-digit numeric code**, a
five-attempt ledger, and a sixty-second resend cooldown. The backend and the
frontend disagreed about what sign-up even produces.

The inputs disagreed too. The UI collects `fullName`, `email`, `password`,
`workspaceName` and `tenancy` (`company` | `agency`) across two steps. The
backend was asking for `organizationName` and knew nothing about tenancy.

## Decision

**1. Registration issues no session.** `POST /v1/auth/register` returns `202`
with `{ status: "verification-required", email, expiresInSeconds,
resendAvailableInSeconds }`. The organization, workspace, user, credential and
membership are all created, but no session and no refresh-token family exist
until the address is proven.

**2. Verification issues the token pair.** `POST /v1/auth/verify-email` consumes
the code, marks the address verified, opens the session, roots the
refresh-token family, and returns the tokens plus `redirectTo`
(`/w/<workspaceSlug>/home`). This service builds that path because it is the
only party that knows the slug it just created.

**3. `tenancy` is stored on the organization.** It describes the tenant, not the
workspace, and `agency` is what later justifies org-scoped roll-up reporting
across many client workspaces.

**4. One name creates both.** The UI collects a single `workspaceName`. The
organization takes that name with a globally-unique suffixed slug; the first
workspace takes it with a clean slug, because a workspace slug only has to be
unique inside its organization and it is the one that appears in the URL.

**5. Password policy is length-first at 12, with breach screening.** Composition
rules were removed. Screening runs against a local list first, then HIBP's
k-anonymity range API, which fails open.

## Consequences

**Why no session before verification**

Issuing a live session to an unverified address lets someone occupy a tenant
using a mailbox they do not control. It also makes an abandoned sign-up
indistinguishable from a real one, and turns every typo'd address into a live
account. The cost is that `register` alone is not a complete sign-up — clients
must handle the two-step flow, which mktdash-web already does.

**A six-digit code is weak on its own and safe only in combination**

10^6 is trivially brute-forceable. What makes it acceptable:

- **5 attempts per issued code**, counted in `credentials`, incremented under
  `SELECT … FOR UPDATE` so parallel requests cannot each read `attempts = 0`.
- **Exhausting the budget invalidates the code**, rather than merely blocking
  it. Leaving a guessable secret alive after five failures just means the
  attacker requests a resend and continues with a fresh budget.
- **15-minute TTL**, well under the 1h ceiling for one-time tokens.
- **Single use**, consumed in the same `UPDATE` that marks the address verified.
- **SHA-256 at rest**, compared in constant time.
- **60-second resend cooldown**, enforced under the same row lock.

Weaken any one of these and the code becomes brute-forceable. They are not
independent hardening measures; they are the reason the design is viable.

**Enumeration**

`verify-email` answers an unknown address, a wrong code and an already-consumed
code identically. `verify-email/resend` always answers `202 { status: "sent",
retryAfterSeconds: 60 }` — including for addresses that do not exist, and
including while cooling down. Returning the *true* cooldown remainder was a bug
found during testing: it confirmed both that an address had a pending sign-up
and roughly when it registered. mktdash-web's `unknown-address` failure code is
therefore one this service never returns.

`register` remains a deliberate exception: it returns `409` on a taken address
because it cannot pretend to have provisioned a tenant. The per-IP limit of 5
per 10 minutes is what carries that risk.

**The tenancy bootstrap (migration 0004)**

Verification must resolve which organization a user belongs to *before* a tenant
scope exists, but `memberships` is scoped by organization. Resolved with
`app_resolve_primary_scope(uuid)`, a `SECURITY DEFINER` function with a fixed
signature that can only return rows for the single user passed in, with
`search_path` pinned and `EXECUTE` revoked from `PUBLIC`. Rejected: granting the
application role `BYPASSRLS`, and loosening the membership policy to allow reads
when the GUC is unset — the latter is strictly worse than no policy, since any
query that merely forgot to open a scope would then read every tenant.

Login, refresh and impersonation will all need this same function.

**Open, and blocking a production deploy**

- **Transactional email delivery is still undecided.** `lib/mail/
  verification-code-mail.ts` is the seam. In development it prints the code to
  the console; in production it logs an error and sends nothing, so **sign-up
  cannot complete in production until a mail path is wired.** The code is never
  written to the outbox — those rows are retained for months to years and must
  never hold a live credential.
- **`mktdash-web`'s `MIN_PASSWORD_LENGTH` is 8; this service requires 12.** Until
  that constant is raised, the client will accept passwords the server rejects
  with a `400` on `password`.
- **HIBP fails open.** A bounded window exists in which a long-tail breached
  password can be set. The local list still blocks the passwords that actually
  get sprayed.
