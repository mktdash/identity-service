import { describe, expect, it } from "vitest";
import {
  buildVerifyUrl,
  escapeHtml,
  renderVerificationCodeEmail,
} from "../templates/verification-code.template.ts";

function render(
  overrides: Partial<Parameters<typeof renderVerificationCodeEmail>[0]> = {},
) {
  return renderVerificationCodeEmail({
    code: "428913",
    expiresInMinutes: 15,
    verifyUrl: "https://app.mktdash.io/verify-email?email=ada%40example.com",
    productName: "Marketing Dashboard",
    ...overrides,
  });
}

describe("escapeHtml", () => {
  it("neutralises every character that can open a tag or close an attribute", () => {
    expect(escapeHtml(`<script>alert("x") & 'y'</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;",
    );
  });
});

describe("buildVerifyUrl", () => {
  it("points at the page that presents the form, never at a consuming endpoint", () => {
    expect(buildVerifyUrl("https://app.mktdash.io", "ada@example.com")).toBe(
      "https://app.mktdash.io/verify-email?email=ada%40example.com",
    );
  });

  it("percent-encodes an address that would otherwise break the query string", () => {
    expect(
      buildVerifyUrl("https://app.mktdash.io", "ada+signup&x=1@example.com"),
    ).toContain("email=ada%2Bsignup%26x%3D1%40example.com");
  });

  it("carries no code, so a link scanner cannot burn the credential", () => {
    const url = buildVerifyUrl("https://app.mktdash.io", "ada@example.com");

    expect(url).not.toContain("code");
    expect(url).not.toContain("token");
  });

  it("ignores a path on the base URL rather than nesting under it", () => {
    expect(buildVerifyUrl("https://app.mktdash.io/app/", "a@b.com")).toBe(
      "https://app.mktdash.io/verify-email?email=a%40b.com",
    );
  });
});

describe("renderVerificationCodeEmail", () => {
  it("keeps the code out of the subject line, which relays retain and lock screens show", () => {
    const { subject } = render();

    expect(subject).toBe("Verify your email address for Marketing Dashboard");
    expect(subject).not.toContain("428913");
  });

  it("ships a plain-text alternative, not an HTML-only message", () => {
    const { text, html } = render();

    expect(text).toContain("428913");
    expect(text).toContain("https://app.mktdash.io/verify-email");
    expect(text).not.toContain("<");
    expect(html).toContain("428913");
  });

  it("states the validity window and the single-use rule in both parts", () => {
    const { text, html } = render();

    expect(text).toContain("valid for 15 minutes");
    expect(html).toContain("valid for 15 minutes");
    expect(text).toContain("only be used once");
    expect(html).toContain("only be used once");
  });

  it("says one minute rather than 1 minutes", () => {
    expect(render({ expiresInMinutes: 1 }).text).toContain(
      "valid for 1 minute ",
    );
  });

  it("tells a recipient who did not sign up that ignoring it is safe", () => {
    const { text, html } = render();

    expect(text).toContain("If you did not create");
    expect(html).toContain("If you did not create");
  });

  it("loads nothing from a remote host — no tracking pixel, no hosted stylesheet", () => {
    const { html } = render();

    expect(html).not.toMatch(/<img/iu);
    expect(html).not.toMatch(/<link[^>]+stylesheet/iu);
    expect(html).not.toMatch(/src\s*=/iu);
  });

  it("escapes a hostile product name instead of rendering it as markup", () => {
    const { html } = render({ productName: '<img src=x onerror="alert(1)">' });

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes the verify URL where it is interpolated into an href", () => {
    const { html } = render({
      verifyUrl: 'https://app.mktdash.io/verify-email?email=a"><script>',
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("declares a preheader that does not itself leak the code", () => {
    const preheader = /<div style="display:none[^"]*">([\s\S]*?)<\/div>/u.exec(
      render().html,
    );

    expect(preheader?.[1]).toBeDefined();
    expect(preheader?.[1]).not.toContain("428913");
  });
});
