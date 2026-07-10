/**
 * Request validation via the FROZEN `@robbed/shared` zod schemas (and small
 * app-local query schemas). Hand-rolled rather than `@hono/zod-validator` — one
 * fewer dependency and no zod-v4 peer-dep coordination risk. Any parse failure
 * becomes `errors.validation` (→ 400 `invalid_request`) via the central handler.
 */
import type { Context } from "hono";
import type { z } from "zod";
import { errors } from "./errors";

function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "invalid request";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const res = schema.safeParse(value);
  if (!res.success) throw errors.validation(firstIssue(res.error));
  return res.data;
}

/** Validate the flat query-string record. */
export function parseQuery<T extends z.ZodType>(schema: T, c: Context): z.infer<T> {
  return parse(schema, c.req.query());
}

/** Validate the JSON body (throws `invalid_request` on non-JSON too). */
export async function parseJson<T extends z.ZodType>(
  schema: T,
  c: Context,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw errors.validation("body must be valid JSON");
  }
  return parse(schema, body);
}
