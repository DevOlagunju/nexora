/**
 * Transport-agnostic result for domain services. Server actions map it to
 * ActionResult; JSON routes map it to Response with `status`.
 */
export type ServiceOk<T> = { ok: true; data: T; message?: string };
export type ServiceFail = { ok: false; error: string; status: number };
export type ServiceResult<T> = ServiceOk<T> | ServiceFail;

export function ok<T>(data: T, message?: string): ServiceOk<T> {
  return { ok: true, data, message };
}

export function fail(error: string, status = 400): ServiceFail {
  return { ok: false, error, status };
}

export const TOO_MANY = (what = "attempts") => fail(`Too many ${what}. Try again shortly.`, 429);

/** Map a service result to a JSON Response for API routes. */
export function toResponse<T>(
  result: ServiceResult<T>,
  shape: (data: T, message?: string) => Record<string, unknown>,
): Response {
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(shape(result.data, result.message));
}
