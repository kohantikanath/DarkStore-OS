import { z } from "zod";

// The one error shape every backend endpoint returns:
// { "error": "CODE", "message": "...", "details": {} }
export const AppErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export type AppError = z.infer<typeof AppErrorSchema>;
