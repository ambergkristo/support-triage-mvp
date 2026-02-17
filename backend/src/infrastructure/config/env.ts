import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
    PORT: z
        .string()
        .optional()
        .transform((value) => (value ? Number(value) : 3000))
        .refine((value) => Number.isInteger(value) && value > 0, "PORT must be a positive integer"),
    FRONTEND_REDIRECT_URL: z.string().url().optional(),
    CORS_ORIGIN: z.string().optional(),
    TOKEN_ENCRYPTION_KEY: z.string().optional(),
    DB_PATH: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = parsed.data;
