# 6. Identity email is delivered over SMTP, behind a transport seam

Date: 2026-08-24

## Status

Accepted. Resolves the "transactional email delivery" open decision and the
first blocking item in ADR 0005.

## Context

`POST /v1/auth/register`, `/verify-email` and `/verify-email/resend` were all
implemented, but nothing sent mail. `lib/mail/verification-code-mail.ts` printed
the code to the console in development and, in production, logged an error and
returned — so sign-up issued a credential that never reached the user and the
flow could not complete outside a developer's terminal.

The service definition says this service owns _triggering_ identity email and
that delivery "goes out through the platform mail path, not a provider SDK wired
in here." There is no platform mail path. There is no `mktdash-mail-service`, no
queue this service is allowed to publish to, and phase 2 is blocked behind a
sign-up that cannot finish.

The audit outbox is not a substitute. Outbox rows are retained for months to
years under an organization's data-retention policy, and a verification code is
a live credential — ADR 0005 already forbids putting it there.

## Decision

**1. SMTP, spoken directly, via `nodemailer`.** SMTP is a protocol, not a
vendor. SES, Postmark, Mailgun, Resend and a corporate Exchange connector all
expose an SMTP endpoint, so choosing SMTP does not choose a provider and does
not have to be unpicked when one is chosen. A provider SDK would have — it would
put an account, a region and a REST contract into this repository.

`nodemailer` is the dependency. It is the standard-track Node SMTP client: MIME
composition, ESMTP negotiation, STARTTLS, AUTH, dot-stuffing and connection
pooling are all things with exactly one correct implementation and no upside to
writing again. Rejected: hand-rolling SMTP over `node:tls`.

**2. `MailTransport` is the seam, not `nodemailer`.** `lib/mail/transport.ts`
exposes `send` / `verify` / `close` and has three implementations — `smtp`,
`console` (development), `noop` (test). Callers reach `lib/mail/mailer.ts`, and
nothing above it names a protocol. A platform mail service later is a fourth
implementation of that interface, not a change to any caller.

**3. Configuration is validated at boot; reachability is not.** `env.ts` refuses
to start when the configuration is _wrong_ — `MAIL_TRANSPORT` not `smtp` in
production, no `SMTP_HOST`, no `MAIL_FROM_ADDRESS`, `SMTP_SECURITY=disable` in
production, a half-set login. `server.ts` then runs one `verify()` against the
relay and **logs** the result. A relay that is down must not stop this service
from starting and is deliberately absent from `/ready`: login, refresh and JWKS
send no mail, and every other service on the platform depends on them.

**4. Delivery is best-effort and never fails the request.** By the time
`deliverVerificationCode` runs, the organization, workspace, user, credential
and membership have committed. Throwing would return `500` on a registration
that in fact succeeded — and the client cannot retry it, because the address is
now taken. Failure logs `verification_email_delivery_failed` at `error` and the
response stays `202`. `verify-email/resend` is the recovery path.

**5. Every send is bounded.** Three attempts, a 10s per-attempt timeout, and
jittered exponential backoff capped at 3s. `EAUTH`, `EENVELOPE`, `EMESSAGE` and
any 5xx SMTP reply are classified permanent and not retried — the next two
attempts would fail identically and only add latency to a request that is
already holding a socket open.

**6. TLS is required unless someone disables it on purpose.** `starttls` sets
nodemailer's `requireTLS`, so the client aborts rather than continuing in the
clear when the server will not upgrade. Certificates are verified
(`rejectUnauthorized: true`, `minVersion: TLSv1.2`) and there is deliberately
**no environment variable that turns verification off** — a relay with a
self-signed certificate needs its CA in the host trust store, not a flag. `disable`
is refused when a username and password are set, because SMTP AUTH is base64,
not encryption, and refused again in production regardless.

**7. The code stays out of the places mail systems retain.** Not in the subject
line, not in the preheader, and not in the URL. The link in the email points at
mktdash-web's `/verify-email?email=…`, which _presents_ the form; consumption is
still `POST /v1/auth/verify-email`, so a link scanner cannot burn the code
(ADR 0005).

**8. The provider is configuration, never code.** Five variables — `SMTP_HOST`,
`SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD` — describe any
SMTP submission endpoint, and **nothing under `src/` names a provider**. Gmail,
SES, Postmark, Mailgun and a private Postfix smarthost differ only in what those
five hold, so an environment can use one provider and another environment a
different one with no branch anywhere. `.env.example` carries worked examples
per provider; that is documentation, not dispatch.

Two provider-independent invariants are enforced rather than documented:
credentials may not be sent over an unencrypted connection, and the sender
address is checked against the authenticated account — differing is legal (a
verified alias) but warned about at boot, because sender-identity enforcement is
near-universal and silently rewritten `From` headers are hard to diagnose from
the sending side.

No local mail container is run. An earlier revision of this ADR used Mailpit for
development; it was removed in favour of pointing development at a real provider
account, which exercises authentication, TLS negotiation and sender-identity
enforcement — the three things a local sink accepts unconditionally and which
are therefore exactly what breaks on first deploy. `MAIL_TRANSPORT=console`
remains for working offline.

## Consequences

**What this costs**

- Sign-up latency now includes an SMTP handshake — bounded at 10s per attempt,
  and paid after the transaction has committed, so it never holds a lock.
- **At-most-once is not guaranteed.** A send that times out may still be
  delivered by the relay, and the retry then delivers a second copy. Both carry
  the same code, so a duplicate is a cosmetic annoyance, not a security event.
- **There is no bounce or complaint handling**, and no per-recipient suppression
  list. A hard-bouncing address will be retried on every resend until the
  per-IP rate limit stops the caller.
- **A consumer mailbox is not a transactional relay.** Development currently
  points at Gmail, which caps SMTP submission near 500 messages/day (2,000 on
  Workspace), throttles below that, and rewrites `From` to the authenticated
  account. That is fine for development and demos and will not survive
  production sign-up volume — moving to a transactional provider is an `.env`
  change, which is the point of decision 8.
- **There is no queue.** A relay outage during a sign-up costs that user their
  first code; they recover with a resend. This is the trade for not inventing a
  durable job runner in an identity service.

**What to watch**

`mail_transport_unavailable` at boot means a bad deploy — alert on it.
`verification_email_delivery_failed` should be ~0; a rising rate is either a
relay problem or an expired credential, and it silently blocks every new
sign-up. `mail_delivery_retrying` is the early warning for both.

**Still open**

- **A platform mail service.** When one exists, it lands as a fourth
  `MailTransport` and this ADR gets superseded, not rewritten.
- **DKIM, SPF and DMARC** are the relay's and the DNS zone's responsibility, not
  this service's. Nobody owns them yet, and without them these messages will be
  spam-filed.
- **Invitation and password-reset email** will reuse `lib/mail/` when those
  flows are built. The template directory is structured for it; nothing else in
  the mail path is specific to verification.
