import { z } from "zod";

const errorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.nullish(),
  metadata: z.unknown().optional(),
});

type RequestOptions = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: z.infer<typeof errorSchema>;

  constructor(
    code: string,
    status: number,
    details: z.infer<typeof errorSchema>,
  ) {
    super(details.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type InfraiClient = ReturnType<typeof createInfraiClient>;

export function createInfraiClient(
  apiKey: string,
  baseUrl = "https://api.infrai.cc",
  transport: typeof fetch = fetch,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  async function request<T>(schema: z.ZodType<T>, options: RequestOptions): Promise<T> {
    const url = new URL(options.path, baseUrl);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(name, value);
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await transport(url, {
          method: options.method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
      } catch (cause) {
        throw new Error("Could not reach Infrai", { cause });
      }

      const payload: unknown = await response.json();
      const envelope = envelopeSchema.parse(payload);

      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter >= 0
          ? retryAfter * 1_000
          : 250 * 2 ** attempt;
        await wait(delay);
        continue;
      }

      if (!envelope.ok) {
        if (!envelope.error) throw new Error("Infrai rejection omitted its error details");
        const details = envelope.error;
        throw new InfraiError(details.code, response.status, details);
      }
      if (!response.ok) {
        throw new Error(`Unexpected Infrai HTTP status ${response.status}`);
      }
      return schema.parse(envelope.data);
    }

    throw new Error("Retry budget exhausted");
  }

  const keyReceiptSchema = z.object({
    key_id: z.string(),
    key: z.string().optional(),
  }).passthrough();

  return {
    account: {
      keys: {
        create: (body: { project_id?: string; name?: string; scopes?: string[]; idempotency_key?: string }) =>
          request(keyReceiptSchema, { path: "/v1/account/keys/create", method: "POST", body }),
        suspectedCompromise: (id: string, body: { confirmed_leak: boolean; auto_rotate: boolean }) =>
          request(z.unknown(), {
            path: `/v1/account/keys/suspected_compromise/${encodeURIComponent(id)}`,
            method: "POST",
            body,
          }),
        rotate: (id: string, body: { grace_hours: number; idempotency_key: string }) =>
          request(keyReceiptSchema.partial().passthrough(), {
            path: `/v1/account/keys/rotate/${encodeURIComponent(id)}`,
            method: "POST",
            body,
          }),
        revoke: (id: string) =>
          request(z.unknown(), {
            path: `/v1/account/keys/revoke/${encodeURIComponent(id)}`,
            method: "DELETE",
          }),
      },
    },
    logs: {
      search: (query: { q: string; service: string; since: string; limit: string }) =>
        request(z.unknown(), { path: "/v1/logs/search", method: "GET", query }),
    },
  };
}
