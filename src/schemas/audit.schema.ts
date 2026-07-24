import { z } from "zod";

export const auditRequestSchema = z.object({
  url: z
    .string({
      error: "URL is required",
    })
    .trim()
    .min(1, "URL cannot be empty")
    .url("Please provide a valid URL")
    .refine(
      (value) => {
        try {
          const protocol = new URL(value).protocol;
          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      },
      {
        message: "Only HTTP and HTTPS URLs are supported",
      }
    ),
});

export type AuditRequest = z.infer<typeof auditRequestSchema>;