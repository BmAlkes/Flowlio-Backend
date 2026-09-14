const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { memoryAdapter } = require("better-auth/adapters/memory");
const { betterAuth } = require("better-auth");
const storage = {
  users: [],
  session: [],
  account: [],
  verification: [],
  twoFactor: [],
};
let lastOTP;
const database = {
  query: {
    users: { findFirst: async () => storage.users[0] },
    twoFactor: { findFirst: async () => storage.twoFactor[0] },
  },
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => storage.users,
        orderBy: () => ({ limit: async () => [] }),
      }),
      innerJoin: () => ({
        where: () => ({ orderBy: () => ({ limit: async () => [] }) }),
      }),
    }),
  }),
  insert: () => ({
    values: (value) => ({
      onConflictDoNothing: async () => {
        storage.twoFactor.push(value);
      },
    }),
  }),
};
const original = Module._load;
Module._load = function (id, ...args) {
  if (
    id === "@/configs/connection.config" ||
    id === "../configs/connection.config"
  )
    return { database };
  if (id === "better-auth")
    return {
      betterAuth: (options) =>
        betterAuth({
          ...options,
          database: memoryAdapter(storage),
          rateLimit: { enabled: false },
          advanced: { useSecureCookies: false },
        }),
    };
  if (id === "@/configs/brevo.config")
    return {
      brevoTransactionApi: {
        sendTransacEmail: async (payload) => {
          lastOTP = payload.htmlContent.match(/>(\d{6})</)?.[1];
        },
      },
    };
  if (id === "@/utils/brevo.util") return {};
  if (id === "@/utils/env.util")
    return {
      env: {
        BACKEND_DOMAIN: "http://localhost:3000",
        FRONTEND_DOMAIN: "http://localhost:4000",
        COOKIE_SECRET: "test-only-secret-that-is-at-least-32-characters",
        BREVO_SENDER: "test@example.com",
      },
    };
  if (id === "@/utils/logger.util")
    return { logger: { info() {}, warn() {}, error() {} } };
  return original.call(this, id, ...args);
};
const { auth } = require("../src/lib/auth");
Module._load = original;
let cookies = new Map();
async function call(path, body) {
  const response = await auth.handler(
    new Request("http://localhost:3000/api/auth/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        origin: "http://localhost:4000",
        cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
  for (const cookie of response.headers.getSetCookie()) {
    const [name, value] = cookie.split(";")[0].split("=");
    if (value) cookies.set(name, value);
    else cookies.delete(name);
  }
  return { status: response.status, body: await response.json() };
}
test("production auth config: password, legacy email 2FA, invalid/replayed code and logout", async () => {
  const email = "alice@example.com",
    password = "Test-password-123";
  const signup = await call("sign-up/email", {
    email,
    password,
    name: "Alice",
    isSuperAdmin: true,
    isOrganizationOwner: true,
  });
  assert.equal(signup.status, 200, JSON.stringify(signup.body));
  assert.notEqual(signup.body.user.isSuperAdmin, true);
  assert.notEqual(signup.body.user.isOrganizationOwner, true);
  assert.notEqual(storage.users[0].is_super_admin, true);
  assert.notEqual(storage.users[0].is_organization_owner, true);
  assert.ok((await call("get-session")).body?.session);
  await call("sign-out", {});
  assert.equal((await call("get-session")).body, null);
  const verification = await call("email-otp/send-verification-otp", {
    email,
    type: "email-verification",
  });
  assert.equal(verification.status, 200, JSON.stringify(verification.body));
  assert.ok(lastOTP);
  assert.equal(
    (await call("email-otp/verify-email", { email, otp: lastOTP })).status,
    200,
  );
  assert.equal(
    (await call("get-session")).body,
    null,
    "Email verification must not create a login session",
  );
  await call("email-otp/send-verification-otp", { email, type: "sign-in" });
  const passwordless = await call("sign-in/email-otp", { email, otp: lastOTP });
  assert.equal(passwordless.status, 200, JSON.stringify(passwordless.body));
  assert.ok((await call("get-session")).body?.session);
  await call("sign-out", {});
  storage.users[0].twoFactorEnabled = true;
  const login = await call("sign-in/email", { email, password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.twoFactorRedirect, true);
  assert.equal((await call("get-session")).body, null);
  const bypass = await call("sign-in/email-otp", { email, otp: "123456" });
  assert.equal(bypass.status, 403);
  const sent = await call("two-factor/send-otp", {});
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.ok(lastOTP);
  const wrong = lastOTP === "000000" ? "111111" : "000000";
  assert.equal(
    (await call("two-factor/verify-otp", { code: wrong })).status,
    401,
  );
  assert.equal((await call("get-session")).body, null);
  const verified = await call("two-factor/verify-otp", { code: lastOTP });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.ok((await call("get-session")).body?.session);
  assert.notEqual(
    (await call("two-factor/verify-otp", { code: lastOTP })).status,
    200,
  );
  const oldCookies = new Map(cookies);
  await call("sign-out", {});
  cookies = oldCookies;
  assert.equal((await call("get-session")).body, null);
});
