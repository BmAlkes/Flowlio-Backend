const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
let user, memberships, client, subscription, session, failed;
const org = { id: "org-a", status: "active", subscriptionStatus: "active" };
const database = {
  query: {
    users: { findFirst: async () => user },
    userOrganizations: {
      findMany: async () => {
        if (failed) throw Error("database unavailable");
        return memberships;
      },
    },
    clients: { findFirst: async () => client },
    subadmin: { findFirst: async () => ({ permission: "Inactive" }) },
  },
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () => (subscription ? [subscription] : []),
        }),
      }),
    }),
  }),
};
const original = Module._load;
let requestedQuery;
Module._load = function (id, ...args) {
  if (id === "@/configs/connection.config") return { database };
  if (id === "@/utils/logger.util")
    return { logger: { error() {}, warn() {}, info() {} } };
  if (id === "@/lib/auth")
    return {
      auth: {
        api: {
          getSession: async (options) => {
            requestedQuery = options.query;
            return session;
          },
        },
      },
    };
  return original.call(this, id, ...args);
};
const { isAuthenticated } = require("../src/middlewares/auth.middleware");
const { connAuthBridge } = require("../src/middlewares/socket.middleware");
Module._load = original;
beforeEach(() => {
  user = {
    id: "alice",
    role: "user",
    status: "active",
    isSuperAdmin: false,
    isOrganizationOwner: false,
  };
  memberships = [
    {
      id: "membership",
      status: "active",
      organizationId: org.id,
      organization: { ...org },
    },
  ];
  client = null;
  subscription = null;
  failed = false;
  session = {
    user: { ...user, isOrganizationOwner: true },
    session: { id: "s1" },
  };
});
async function request() {
  const req = { headers: {} };
  let status = 200,
    body,
    called = false;
  await isAuthenticated(
    req,
    {
      status(value) {
        status = value;
        return this;
      },
      json(value) {
        body = value;
      },
    },
    () => {
      called = true;
    },
  );
  return { req, status, body, called };
}
test("reads current privileges instead of stale session flags", async () => {
  const result = await request();
  assert.equal(result.called, true);
  assert.equal(result.req.user.isOrganizationOwner, false);
  assert.deepEqual(requestedQuery, { disableCookieCache: true });
});
test("revoked session is denied before organization access", async () => {
  session = null;
  const result = await request();
  assert.equal(result.status, 401);
  assert.equal(result.called, false);
});
test("deleted account is denied", async () => {
  user = null;
  assert.equal((await request()).status, 401);
});
test("inactive membership never becomes a fallback", async () => {
  memberships[0].status = "inactive";
  assert.equal((await request()).body.code, "MEMBERSHIP_INACTIVE");
});
test("active membership is selected after an inactive one", async () => {
  memberships.unshift({
    status: "inactive",
    organization: { id: "old-org", status: "suspended" },
  });
  assert.equal((await request()).req.user.organizationId, "org-a");
});
test("removing the last membership revokes an active account", async () => {
  memberships = [];
  assert.equal((await request()).body.code, "MEMBERSHIP_INACTIVE");
});
test("pending registration without an organization remains available for checkout", async () => {
  memberships = [];
  user.status = "pending";
  const result = await request();
  assert.equal(result.called, true);
  assert.equal(result.req.user.organizationId, null);
});
test("missing organization relation fails closed", async () => {
  memberships[0].organization = null;
  assert.equal((await request()).status, 403);
});
test("database failure cannot reach a protected controller", async () => {
  failed = true;
  const result = await request();
  assert.equal(result.status, 500);
  assert.equal(result.called, false);
});
test("portal access is checked again on the next request", async () => {
  user.role = "client";
  memberships = [];
  client = {
    id: "client-a",
    portalAccessEnabled: true,
    organization: { ...org },
  };
  assert.equal((await request()).called, true);
  client.portalAccessEnabled = false;
  const result = await request();
  assert.equal(result.called, false);
  assert.equal(result.body.code, "PORTAL_ACCESS_DISABLED");
});
test("a client cannot use an unrelated staff membership to bypass a disabled portal", async () => {
  user.role = "client";
  client = { portalAccessEnabled: false, organization: { ...org } };
  assert.equal((await request()).body.code, "PORTAL_ACCESS_DISABLED");
});
for (const role of ["user", "client"]) {
  test(role + " organization suspension blocks access", async () => {
    user.role = role;
    memberships[0].organization.status = "suspended";
    client = {
      portalAccessEnabled: true,
      organization: { ...org, status: "suspended" },
    };
    assert.equal((await request()).body.code, "ORGANIZATION_DEACTIVATED");
  });
  test(role + " expired subscription blocks access", async () => {
    user.role = role;
    client = { portalAccessEnabled: true, organization: { ...org } };
    subscription = { currentPeriodEnd: new Date(0) };
    assert.equal((await request()).body.code, "SUBSCRIPTION_EXPIRED");
  });
}
test("subadmin revocation is honored", async () => {
  user.role = "subadmin";
  user.subadminId = "subadmin";
  assert.equal((await request()).body.code, "SUBADMIN_DEACTIVATED");
});
test("socket validates the real session and current portal access", async () => {
  let error,
    joined = false;
  const socket = {
    once() {},
    disconnect() {},
    request: { headers: {} },
    handshake: { auth: { sessionId: "wrong" } },
    join: async () => {
      joined = true;
    },
  };
  await connAuthBridge(socket, (e) => {
    error = e;
  });
  assert.ok(error);
  assert.equal(joined, false);
  socket.handshake.auth.sessionId = "s1";
  await connAuthBridge(socket, (e) => {
    error = e;
  });
  assert.equal(error, undefined);
  assert.equal(joined, true);
  user.role = "client";
  client = { portalAccessEnabled: false };
  joined = false;
  await connAuthBridge(socket, (e) => {
    error = e;
  });
  assert.ok(error);
  assert.equal(joined, false);
});

test("superadmin can administer without an active tenant membership", async () => {
  user.isSuperAdmin = true;
  memberships[0].status = "inactive";
  const result = await request();
  assert.equal(result.called, true);
  assert.equal(result.req.user.organizationId, null);
});

test("idle socket disconnects after session revocation", async () => {
  const originalInterval = global.setInterval;
  let check,
    disconnected = false;
  global.setInterval = (callback) => {
    check = callback;
    return { unref() {} };
  };
  try {
    const socket = {
      request: { headers: {} },
      handshake: { auth: { sessionId: "s1" } },
      join: async () => {},
      once() {},
      disconnect() {
        disconnected = true;
      },
    };
    await connAuthBridge(socket, (error) => assert.equal(error, undefined));
    session = null;
    await check();
    assert.equal(disconnected, true);
  } finally {
    global.setInterval = originalInterval;
  }
});
