export type VerificationCodeTemplateInput = {
  readonly code: string;
  readonly expiresInMinutes: number;
  readonly verifyUrl: string;
  readonly productName: string;
};

export type RenderedEmail = {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
};

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/gu, (character) => {
    return HTML_ESCAPES[character] ?? character;
  });
}

export function buildVerifyUrl(baseUrl: string, email: string): string {
  const url = new URL("/verify-email", baseUrl);
  url.searchParams.set("email", email);

  return url.toString();
}

function minutes(count: number): string {
  return `${String(count)} minute${count === 1 ? "" : "s"}`;
}

export function renderVerificationCodeEmail(
  input: VerificationCodeTemplateInput,
): RenderedEmail {
  const validFor = minutes(input.expiresInMinutes);

  const text = [
    input.productName,
    "",
    "Use this code to verify your email address:",
    "",
    `    ${input.code}`,
    "",
    `The code is valid for ${validFor} and can only be used once.`,
    "",
    "Enter it here:",
    input.verifyUrl,
    "",
    `If you did not create a ${input.productName} account, ignore this email —`,
    "nothing happens until the code is used, and it expires on its own.",
    "",
    "This is an automated message. Please do not reply.",
    "",
  ].join("\n");

  const product = escapeHtml(input.productName);
  const code = escapeHtml(input.code);
  const href = escapeHtml(input.verifyUrl);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${product} verification code</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Verify your email address to finish setting up your ${product} account.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f7;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;border:1px solid #e4e6eb;">
            <tr>
              <td style="padding:32px 32px 8px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:#6b7280;letter-spacing:0.04em;text-transform:uppercase;">
                ${product}
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 16px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;line-height:28px;font-weight:600;color:#111827;">
                Verify your email address
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#374151;">
                Enter this code to finish setting up your account.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px 24px 32px;">
                <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:32px;line-height:40px;font-weight:700;letter-spacing:0.32em;color:#111827;background-color:#f4f5f7;border-radius:8px;padding:16px 8px 16px 16px;">
                  ${code}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#6b7280;">
                The code is valid for ${escapeHtml(validFor)} and can only be used once.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px 32px 32px;">
                <a href="${href}" style="display:inline-block;background-color:#111827;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:20px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">
                  Enter the code
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px 32px;border-top:1px solid #e4e6eb;">
                <p style="margin:24px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#6b7280;">
                  If you did not create a ${product} account, ignore this email — nothing happens until the code is used, and it expires on its own.
                </p>
                <p style="margin:12px 0 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#9ca3af;">
                  This is an automated message. Please do not reply.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

  return {
    subject: `Verify your email address for ${input.productName}`,
    text,
    html,
  };
}
