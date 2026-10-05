import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { InfraiClient } from "./infrai_client.js";

export const drillRequestSchema = z.object({
  service: z.string().min(1),
  since: z.string().datetime(),
  grace_hours: z.number().int().min(0).max(72).default(1),
  project_id: z.string().min(1).optional(),
});

export type DrillRequest = z.infer<typeof drillRequestSchema>;

export type DrillResult = {
  drill_key_id: string;
  state: "confirmed";
  actions: ["reported", "blast-radius-searched", "rotated", "confirmed", "revoked"];
  diagnostics: {
    service: string;
    searched_since: string;
    matched_log_events: number;
    replacement_secret_received: boolean;
  };
};

function countLogEvents(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (typeof data !== "object" || data === null) return 0;
  const record = data as Record<string, unknown>;
  for (const field of ["items", "logs", "results"]) {
    if (Array.isArray(record[field])) return record[field].length;
  }
  return 0;
}

export async function runLeakedKeyDrill(
  client: InfraiClient,
  input: DrillRequest,
  operationId: string = randomUUID(),
): Promise<DrillResult> {
  const created = await client.account.keys.create({
    project_id: input.project_id,
    name: `leaked-key-drill-${operationId}`,
    idempotency_key: `${operationId}:create`,
  });

  const keyId = created.key_id;
  let cleanupNeeded = true;
  try {
    await client.account.keys.suspectedCompromise(keyId, {
      confirmed_leak: false,
      auto_rotate: false,
    });

    const evidence = await client.logs.search({
      q: `key_id:${keyId}`,
      service: input.service,
      since: input.since,
      limit: "100",
    });

    const rotated = await client.account.keys.rotate(keyId, {
      grace_hours: input.grace_hours,
      idempotency_key: `${operationId}:rotate`,
    });

    await client.account.keys.suspectedCompromise(keyId, {
      confirmed_leak: true,
      auto_rotate: false,
    });

    await client.account.keys.revoke(keyId);
    cleanupNeeded = false;

    return {
      drill_key_id: keyId,
      state: "confirmed",
      actions: ["reported", "blast-radius-searched", "rotated", "confirmed", "revoked"],
      diagnostics: {
        service: input.service,
        searched_since: input.since,
        matched_log_events: countLogEvents(evidence),
        replacement_secret_received: typeof rotated.key === "string",
      },
    };
  } finally {
    if (cleanupNeeded) await client.account.keys.revoke(keyId);
  }
}
