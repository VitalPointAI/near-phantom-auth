/**
 * validateBody Helper
 *
 * Calls schema.safeParse(req.body). On success, returns typed data.
 * On failure, sends HTTP 400 with the first Zod error message and returns null.
 *
 * Usage:
 *   const body = validateBody(registerFinishBodySchema, req, res);
 *   if (!body) return; // 400 already sent
 *   // body is fully typed
 *
 * Why safeParse: Never throws. Uncaught ZodError from parse() produces a 500,
 * defeating the purpose of validation.
 */

import type { Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

export function validateBody<T extends ZodTypeAny>(
  schema: T,
  req: Request,
  res: Response,
): z.infer<T> | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      error: result.error.issues[0]?.message ?? 'Invalid request body',
    });
    return null;
  }
  return result.data;
}
