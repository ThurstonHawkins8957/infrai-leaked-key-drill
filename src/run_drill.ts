import { createInfraiClient } from "./infrai_client.js";
import { drillRequestSchema, runLeakedKeyDrill } from "./leaked_key_drill.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the drill");

const input = drillRequestSchema.parse({
  service: process.env.DRILL_SERVICE ?? "developer-tools",
  since: process.env.DRILL_SINCE ?? new Date(Date.now() - 60 * 60 * 1_000).toISOString(),
  grace_hours: Number(process.env.DRILL_GRACE_HOURS ?? 1),
  project_id: process.env.INFRAI_PROJECT_ID,
});

const result = await runLeakedKeyDrill(createInfraiClient(apiKey), input);
console.log(JSON.stringify(result, null, 2));
