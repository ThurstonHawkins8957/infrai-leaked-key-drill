import assert from "node:assert/strict";
import test from "node:test";
import { runLeakedKeyDrill } from "../src/leaked_key_drill.js";

test("the drill establishes blast radius before rotating and confirming", async () => {
  const calls: string[] = [];
  const client = {
    account: { keys: {
      create: async () => { calls.push("create"); return { key_id: "drill-key", key: "shown-once" }; },
      suspectedCompromise: async (_id: string, body: { confirmed_leak: boolean }) => {
        calls.push(body.confirmed_leak ? "confirm" : "report");
      },
      rotate: async () => { calls.push("rotate"); return { key: "replacement-shown-once" }; },
      revoke: async () => { calls.push("revoke"); },
    } },
    logs: {
      search: async () => { calls.push("search"); return { items: [{}, {}, {}] }; },
    },
  };

  const result = await runLeakedKeyDrill(client as never, {
    service: "developer-tools",
    since: "2026-09-27T00:00:00.000Z",
    grace_hours: 2,
  }, "fixed-operation");

  assert.deepEqual(calls, ["create", "report", "search", "rotate", "confirm", "revoke"]);
  assert.equal(result.state, "confirmed");
  assert.equal(result.diagnostics.matched_log_events, 3);
  assert.equal(result.diagnostics.replacement_secret_received, true);
});

test("an interrupted drill revokes its temporary key", async () => {
  const calls: string[] = [];
  const client = {
    account: { keys: {
      create: async () => ({ key_id: "drill-key" }),
      suspectedCompromise: async () => { calls.push("report"); },
      rotate: async () => ({ key: "replacement" }),
      revoke: async () => { calls.push("revoke"); },
    } },
    logs: { search: async () => { throw new Error("test interruption"); } },
  };

  await assert.rejects(() => runLeakedKeyDrill(client as never, {
    service: "developer-tools",
    since: "2026-09-27T00:00:00.000Z",
    grace_hours: 1,
  }, "fixed-operation"));
  assert.deepEqual(calls, ["report", "revoke"]);
});
