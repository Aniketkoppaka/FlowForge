import { z } from "zod";

export const RegisterRequestSchema = z.object({
  email: z.string().trim().email("Must be a valid email address").max(255).toLowerCase(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .max(128, "Password must not exceed 128 characters"),
  name: z.string().trim().min(1, "Name is required").max(100, "Name must not exceed 100 characters").optional()
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().trim().email("Must be a valid email address").max(255).toLowerCase(),
  password: z.string().min(1, "Password is required").max(128)
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UserResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type UserResponse = z.infer<typeof UserResponseSchema>;
