const { test } = require("node:test");
const assert = require("node:assert/strict");
const { listPage, pageResult, containsText, validateListQuery } = require("../src/utils/list-query");

test("pagination bounds reject malformed or excessive requests before controllers run", () => {
  for (const query of [{ page: "0" }, { page: "-1" }, { page: "1.1" }, { page: ["1"] }, { pageSize: "201" }, { page: "100001" }, { search: {} }]) {
    let reached = false;
    const res = { status(code) { assert.equal(code, 400); return this; }, json(body) { assert.equal(body.code, "INVALID_QUERY"); } };
    validateListQuery({ query }, res, () => { reached = true; });
    assert.equal(reached, false);
  }
});
test("legacy clients retain complete responses and paginated callers get bounded results", () => {
  const rows = [1,2,3];
  assert.deepEqual(pageResult(rows, listPage({})), { data: rows });
  assert.deepEqual(pageResult(rows, listPage({ page: "1", pageSize: "2" })), { data: [1,2], pagination: { page: 1, pageSize: 2, hasMore: true } });
  assert.equal(pageResult([], listPage({ page: "2" })).pagination.hasMore, false);
  assert.equal(containsText("a_b%"), "%a\\_b\\%%");
});
