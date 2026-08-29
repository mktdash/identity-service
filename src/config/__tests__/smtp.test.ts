import { describe, expect, it } from "vitest";
import { SMTP_POOL } from "#config/constants";
import {
  composeRedactedSmtpUrl,
  formatMailAddress,
  inspectMailConfiguration,
  resolveMailTransport,
  toSmtpAuthOptions,
  toSmtpSecurityOptions,
  toSmtpTlsOptions,
  toSmtpTransportOptions,
  type MailIdentity,
  type SmtpConnectionParts,
} from "../smtp.ts";

function parts(
  overrides: Partial<SmtpConnectionParts> = {},
): SmtpConnectionParts {
  return {
    host: "smtp.relay.example",
    port: 587,
    username: "identity",
    password: "s3cr3t-relay-password",
    security: "starttls",
    ...overrides,
  };
}

describe("resolveMailTransport", () => {
  it("takes an explicit setting at face value", () => {
    expect(resolveMailTransport("smtp", "development")).toBe("smtp");
    expect(resolveMailTransport("noop", "production")).toBe("noop");
  });

  it("discards mail by default under test, so a suite needs no relay", () => {
    expect(resolveMailTransport("", "test")).toBe("noop");
  });

  it("prints to the console by default in development", () => {
    expect(resolveMailTransport("", "development")).toBe("console");
  });
});

describe("toSmtpSecurityOptions", () => {
  it("requires the STARTTLS upgrade rather than allowing a silent downgrade", () => {
    expect(toSmtpSecurityOptions("starttls")).toEqual({
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
    });
  });

  it("connects with TLS from the first byte for implicit TLS", () => {
    expect(toSmtpSecurityOptions("implicit-tls")).toEqual({
      secure: true,
      requireTLS: false,
      ignoreTLS: false,
    });
  });

  it("only skips TLS when explicitly disabled", () => {
    expect(toSmtpSecurityOptions("disable")).toEqual({
      secure: false,
      requireTLS: false,
      ignoreTLS: true,
    });
  });
});

describe("toSmtpTlsOptions", () => {
  it("verifies the certificate chain and floors the protocol at TLS 1.2", () => {
    expect(toSmtpTlsOptions("starttls")).toEqual({
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
    expect(toSmtpTlsOptions("implicit-tls")).toEqual({
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
  });

  it("has no opinion when TLS is off entirely", () => {
    expect(toSmtpTlsOptions("disable")).toBeUndefined();
  });
});

describe("toSmtpAuthOptions", () => {
  it("omits auth entirely when no username is configured", () => {
    expect(
      toSmtpAuthOptions(parts({ username: "", password: "" })),
    ).toBeUndefined();
  });

  it("passes the configured login through", () => {
    expect(toSmtpAuthOptions(parts())).toEqual({
      user: "identity",
      pass: "s3cr3t-relay-password",
    });
  });
});

describe("toSmtpTransportOptions", () => {
  it("pools connections and bounds every phase of the conversation", () => {
    const options = toSmtpTransportOptions(parts(), SMTP_POOL);

    expect(options.pool).toBe(true);
    expect(options.maxConnections).toBe(SMTP_POOL.maxConnections);
    expect(options.maxMessages).toBe(SMTP_POOL.maxMessages);
    expect(options.connectionTimeout).toBe(SMTP_POOL.connectionTimeoutMs);
    expect(options.greetingTimeout).toBe(SMTP_POOL.greetingTimeoutMs);
    expect(options.socketTimeout).toBe(SMTP_POOL.socketTimeoutMs);
  });

  it("never lets a message body reach the filesystem or a remote URL", () => {
    const options = toSmtpTransportOptions(parts(), SMTP_POOL);

    expect(options.disableFileAccess).toBe(true);
    expect(options.disableUrlAccess).toBe(true);
  });

  it("leaves auth off the options object rather than sending an empty login", () => {
    const options = toSmtpTransportOptions(
      parts({ username: "", password: "" }),
      SMTP_POOL,
    );

    expect(options.auth).toBeUndefined();
    expect(Object.hasOwn(options, "auth")).toBe(false);
  });
});

describe("composeRedactedSmtpUrl", () => {
  it("never renders the relay password", () => {
    const target = composeRedactedSmtpUrl(parts());

    expect(target).toBe("smtp://identity:[redacted]@smtp.relay.example:587");
    expect(target).not.toContain("s3cr3t-relay-password");
  });

  it("uses the smtps scheme for implicit TLS", () => {
    expect(
      composeRedactedSmtpUrl(parts({ security: "implicit-tls", port: 465 })),
    ).toBe("smtps://identity:[redacted]@smtp.relay.example:465");
  });

  it("brackets an IPv6 literal so the port stays parseable", () => {
    expect(
      composeRedactedSmtpUrl(
        parts({ host: "::1", username: "", password: "" }),
      ),
    ).toBe("smtp://[::1]:587");
  });

  it("says so plainly when nothing is configured", () => {
    expect(composeRedactedSmtpUrl(parts({ host: "" }))).toBe(
      "(not configured)",
    );
  });
});

describe("inspectMailConfiguration", () => {
  function identity(overrides: Partial<MailIdentity> = {}): MailIdentity {
    return {
      fromAddress: "no-reply@mktdash.io",
      fromName: "Marketing Dashboard",
      replyToAddress: "",
      ...overrides,
    };
  }

  function codes(
    smtp: Partial<SmtpConnectionParts>,
    mail: Partial<MailIdentity> = {},
  ): string[] {
    return inspectMailConfiguration({
      transport: "smtp",
      smtp: parts(smtp),
      identity: identity(mail),
    }).map((warning) => warning.code);
  }

  it("is silent when the sender is the authenticated no-reply account", () => {
    expect(
      codes(
        { username: "no-reply@mktdash.io" },
        { fromAddress: "no-reply@mktdash.io" },
      ),
    ).toEqual([]);
  });

  it("warns when the sender differs from the account, whoever the provider is", () => {
    expect(
      codes(
        { host: "smtp.postmarkapp.com", username: "token@postmark" },
        { fromAddress: "no-reply@mktdash.io" },
      ),
    ).toContain("sender_differs_from_smtp_account");

    expect(
      codes(
        { host: "mail.private.example", username: "identity@private.example" },
        { fromAddress: "no-reply@mktdash.io" },
      ),
    ).toContain("sender_differs_from_smtp_account");
  });

  it("compares the sender and the account case-insensitively", () => {
    expect(
      codes(
        { username: "No-Reply@Mktdash.IO" },
        { fromAddress: "no-reply@mktdash.io" },
      ),
    ).toEqual([]);
  });

  it("warns when replies would land in an unattended mailbox", () => {
    expect(
      codes(
        { username: "hello@mktdash.io" },
        { fromAddress: "hello@mktdash.io" },
      ),
    ).toContain("sender_mailbox_is_unattended");
  });

  it("accepts a monitored mailbox once a reply-to is set", () => {
    expect(
      codes(
        { username: "hello@mktdash.io" },
        {
          fromAddress: "hello@mktdash.io",
          replyToAddress: "support@mktdash.io",
        },
      ),
    ).not.toContain("sender_mailbox_is_unattended");
  });

  it("says nothing at all when no mail is actually being sent", () => {
    expect(
      inspectMailConfiguration({
        transport: "console",
        smtp: parts({ username: "someone@example.com" }),
        identity: identity({ fromAddress: "other@example.com" }),
      }),
    ).toEqual([]);
  });

  it("names no provider in any message — the config is provider-independent", () => {
    const messages = inspectMailConfiguration({
      transport: "smtp",
      smtp: parts({ host: "smtp.gmail.com", username: "someone@gmail.com" }),
      identity: identity({ fromAddress: "hello@mktdash.io" }),
    }).map((warning) => warning.message.toLowerCase());

    for (const message of messages) {
      for (const provider of [
        "gmail",
        "google",
        "ses",
        "postmark",
        "mailgun",
      ]) {
        expect(message).not.toContain(provider);
      }
    }
  });
});

describe("formatMailAddress", () => {
  it("quotes the display name so a comma or dot cannot split the header", () => {
    expect(
      formatMailAddress({
        fromAddress: "no-reply@mktdash.io",
        fromName: "Marketing Dashboard",
        replyToAddress: "",
      }),
    ).toBe('"Marketing Dashboard" <no-reply@mktdash.io>');
  });

  it("escapes a quote in the display name rather than letting it close the string", () => {
    expect(
      formatMailAddress({
        fromAddress: "no-reply@mktdash.io",
        fromName: 'Acme " <attacker@evil.example>',
        replyToAddress: "",
      }),
    ).toBe('"Acme \\" <attacker@evil.example>" <no-reply@mktdash.io>');
  });

  it("falls back to a bare address when no display name is set", () => {
    expect(
      formatMailAddress({
        fromAddress: "no-reply@mktdash.io",
        fromName: "",
        replyToAddress: "",
      }),
    ).toBe("no-reply@mktdash.io");
  });

  it("never renders a name with an empty angle-bracket address", () => {
    expect(
      formatMailAddress({
        fromAddress: "",
        fromName: "Marketing Dashboard",
        replyToAddress: "",
      }),
    ).toBe("(not configured)");
  });
});
