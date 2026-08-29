# 7. One env file per environment, loaded by Node, never by the application

Date: 2026-08-26

## Status

Accepted.

## Context

The repo had a single `.env`, loaded by `--env-file=.env` on every `node`
invocation. One file cannot describe two environments, so switching between a
development run and a production-mode run meant editing it in place — which is
how a laptop ends up talking to a real database, and how `SWAGGER_UI_ENABLED`
ends up true somewhere it should not be.

The obvious fix, and the one first proposed, is to build the filename at
runtime:

```ts
dotenv.config({ path: `.env.${process.env.NODE_ENV}` });
```

Three things are wrong with it here, and the third is the one that matters.

1. **It needs a dependency this repo does not have.** `dotenv` is not
   installed, and Node 22 has read `.env` files natively since 20.6 —
   `--env-file`, `--env-file-if-exists`, and `process.loadEnvFile()`.
2. **The interpolation is circular.** `NODE_ENV` has to already be set in the
   real environment for the template to resolve; when it is not, the expression
   silently yields `.env.undefined` and dotenv shrugs. The variable that selects
   the file cannot also come from the file.
3. **It runs too late.** `src/config/env.ts` reads `process.env` at module
   evaluation, and `server.ts` imports `observability/tracing.ts` first by
   design — OTel patches modules at load time. A `dotenv.config()` call would
   have to be the first import in the process, ahead of tracing, to be certain
   it beat every reader. That is a load-order rule that has to hold forever and
   breaks silently when it doesn't. `--env-file` populates `process.env` before
   any module evaluates at all, so there is no order to get wrong.

## Decision

**1. One file per environment, named by the script that loads it.** `pnpm dev`
loads `.env.development`; `pnpm start` loads `.env.production` if present. No
filename is ever built from a variable — the command you type is the selector.

```
dev    NODE_ENV=development node --watch --env-file=.env.development --conditions=source src/server.ts
start  NODE_ENV=production  node --env-file-if-exists=.env.production dist/server.js
```

**2. `dev` hard-fails on a missing file; `start` does not.** A developer with no
`.env.development` has made a mistake and should be told at once — `--env-file`
exits. A deployed container legitimately has no file: its configuration comes
from the secret store, so `start` uses `--env-file-if-exists` and continues.

**3. The real environment always wins over the file.** This is Node's
behaviour, not a convention we maintain, and it is what makes (2) safe: if a
`.env.production` were ever baked into an image, the orchestrator's injected
values would still take precedence over it. It is also the override mechanism —
pointing a script at another database is `DATABASE_HOST=… pnpm verify:rls`, not
an edit to a file.

**4. `NODE_ENV` is set by the script, not read from the file.** It is the one
variable that must not be configurable by the thing it configures. `env.ts`
gates real controls on it — Redis authentication, an SMTP transport, HTTPS in
mail links — and a file labelled `production` that quietly sets
`NODE_ENV=development` would disable all three.

**5. Production reads no file at all.** `.env.production` exists for one
purpose: running the built output locally in production mode
(`pnpm prod`) to check that the production-only guards in `env.ts` actually
pass before a deploy discovers they don't. The deployed service gets every
value from the secret store. The Dockerfile, when it is written, sets
`ENV NODE_ENV=production` and copies no env file.

**6. Tests load nothing.** `vitest.config.ts` declares the test environment
inline. A suite whose result depends on what is on the machine that ran it is
not a test.

**7. Two consumers cannot take `--env-file`, and they are handled differently.**
Neither is launched through `node`.

- `drizzle-kit` is its own binary and would otherwise load the `.env` this repo
  no longer has, so `drizzle.config.ts` calls `process.loadEnvFile()` on the
  same per-environment name (ENOENT tolerated, real-environment precedence
  unchanged). It needs no wrapper: any invocation, including a hand-typed
  `pnpm exec drizzle-kit studio`, gets the right file.
- **Docker Compose is split in two, and the split is what names the env file.**
  Compose interpolates from `.env` and nothing else, and a compose file cannot
  name its own interpolation source — neither a top-level nor a service-level
  `env_file` feeds interpolation (both were tested; `env_file` only injects into
  the container). The one mechanism that does is `include.env_file`, so:
  - `docker/compose/dependencies.yml` holds the services. It is
    environment-agnostic: it declares the variables it needs, validates them,
    and says nothing about where they come from.
  - `docker-compose.yml` is a five-line local entry point that includes it with
    `env_file: .env.development`.

  A bare `docker compose up -d` therefore works, and so does every other
  subcommand — which matters more than the extra file, because that is the
  command muscle memory reaches for. Precedence still matches Node's: the shell
  wins over the file, `docker compose --env-file <other>` overrides it for one
  run, and a missing `.env.development` is a hard error naming the path.

  `docker:up`, `docker:down`, `docker:logs` and `docker:ps` are plain aliases
  for the matching `docker compose` subcommands — no wrapper script, because
  once the include names the env file there is nothing for one to do.

**8. Neither compose file hardcodes a credential, and the services file names no
environment.** Its `${VAR:?…}` messages are generic (`DATABASE_USER is
required`) and mention no file and no npm script, so
`docker compose -f docker/compose/dependencies.yml up` is correct wherever the
variables are already in the environment — CI, or a platform secret manager.
Only the root file, which exists to wire up local development, knows the name
`.env.development`.

**9. Compose variables stay `${VAR:?message}` — never `${VAR:-default}`.** A
default would make the bare command "work" while the container came up with
credentials that no longer match `.env.development`, turning a mismatch into a
connection failure at the first query instead of a named error at `up`. The same
reasoning rules out committing a `.env` for Compose to find, or duplicating the
local credentials into the compose file: one source of truth, and it is the
env file.

## Consequences

- `.env` is gone. `.gitignore` keeps ignoring `.env*` and committing only
  `.env.example`, which is now the template for both real files.
- **`docker compose <anything>` works as typed**, and `pnpm docker:up` /
  `docker:down` / `docker:logs` / `docker:ps` are aliases for the common four.
- **In a deployed environment the root file is not used.**
  The platform's secret manager injects the variables and
  `docker compose -f docker/compose/dependencies.yml …` runs against them, with
  no `.env.development` anywhere. That file validates what it needs and fails by
  name if something is missing.
- The cost is one extra file, and one path gotcha: relative paths inside an
  included file resolve from **its own** directory, which is why the init-script
  mount reads `../../docker/postgres/init`. Moving either file breaks that.
- The compose file still describes local _dependencies_ (Postgres, Redis), not
  this service — there is no Dockerfile yet, and a deployed environment would
  more likely point at managed instances. "Reusable across environments" means
  the file makes no development-only assumptions, not that production is
  expected to run these containers.
- Operational scripts (`seed:system`, `verify:rls`, `key:*`, `openapi:generate`)
  use `--env-file-if-exists=.env.development`: the local file on a laptop, the
  ambient environment in CI or a container.
- Adding an environment variable is unchanged and still four steps in order:
  secret store → `.env.example` → the `env.ts` schema → the typed field. It now
  also means adding it to each local `.env.<environment>` you actually run.
- The scripts use `VAR=value command` prefixes, which are POSIX shell syntax.
  Development on Windows would need `cross-env` or WSL. No one develops this
  service on Windows today; if that changes, that is the fix, not a runtime
  loader.
