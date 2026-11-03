import type { ApiErrorCode } from '@shifubot/shared';
import type { ZodType, ZodTypeDef } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503,
    readonly code: ApiErrorCode | (string & {}),
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Validate any API input with Zod and turn failures into a clear 400 response. */
export function parseInput<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown, what = 'Request'): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
    throw new ApiError(
      400,
      'validation',
      `${what} is invalid: ${fields.map((field) => `${field.path} ${field.message}`).join('; ')}`,
      fields,
    );
  }
  return result.data;
}

/** Read and validate a JSON body. */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T, ZodTypeDef, unknown>,
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, 'validation', 'Request body must be valid JSON');
  }
  return parseInput(schema, body, 'Request body');
}
