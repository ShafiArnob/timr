import "server-only";

/**
 * Machine-readable failure reasons. Firmware can branch on these without
 * parsing prose, and the strings stay stable even if the messages are reworded.
 */
export type ApiErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "not_found"
  | "server_error";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  invalid_request: 400,
  not_found: 404,
  server_error: 500,
};

/** Nothing here is cacheable — every response is scoped to one API key. */
const BASE_HEADERS = { "Cache-Control": "no-store" };

export function apiJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: BASE_HEADERS });
}

export function apiError(code: ApiErrorCode, message: string): Response {
  return Response.json(
    { error: { code, message } },
    {
      status: STATUS_BY_CODE[code],
      headers:
        code === "unauthorized"
          ? { ...BASE_HEADERS, "WWW-Authenticate": "Bearer" }
          : BASE_HEADERS,
    },
  );
}
