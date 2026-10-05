import { createServer } from "node:http";
import { ZodError } from "zod";
import { createInfraiClient, InfraiError } from "./infrai_client.js";
import { drillRequestSchema, runLeakedKeyDrill } from "./leaked_key_drill.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const client = createInfraiClient(apiKey);
const port = Number(process.env.PORT ?? 3000);

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/drills") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "route_not_found" }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = drillRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const result = await runLeakedKeyDrill(client, input);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof ZodError ? 400 : error instanceof InfraiError ? error.status : 500;
    const body = error instanceof ZodError
      ? { error: "invalid_request", details: error.issues }
      : error instanceof InfraiError
        ? { error: error.code, message: error.message }
        : { error: "internal_error" };
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  }
}).listen(port, () => console.log(`Leaked-key drill service listening on http://localhost:${port}`));
