// Turnstile server-side verification (ADR-0005). Mandatory on create.
//
// Cloudflare publishes deterministic *testing* secret keys. When one is
// configured we honour its documented result without a network call, which
// keeps local dev and tests offline and deterministic. In production the
// secret is a real secret, so the live siteverify path runs.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const TEST_SECRETS: Record<string, boolean> = {
  "1x0000000000000000000000000000000AA": true, // always passes
  "2x0000000000000000000000000000000AA": false, // always fails
  "3x0000000000000000000000000000000AA": false, // token already spent
};

export async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string | null,
): Promise<boolean> {
  if (Object.prototype.hasOwnProperty.call(TEST_SECRETS, secret)) {
    return TEST_SECRETS[secret];
  }
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}
