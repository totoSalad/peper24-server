import { z } from 'zod';

export const EnglishLevelSchema = z.enum([ 'A1', 'A2', 'B1', 'B2', 'C1', 'C2' ]);

export const AccountProfileSchema = z.object({
  displayName: z.string().trim().min(1)
    .max(50),
  age: z.number().int().min(8)
    .max(100)
    .optional(),
  occupation: z.string().trim().max(80)
    .optional(),
  englishLevel: EnglishLevelSchema,
});

export const RegisterAccountSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(8).max(128),
  profile: AccountProfileSchema,
});

export const LoginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

export const UpdateProfileSchema = AccountProfileSchema;
