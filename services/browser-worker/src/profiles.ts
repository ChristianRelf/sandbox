import { z } from "zod";

export const cloudProfileSchema=z.object({
  profileId:z.string().uuid(),workspaceId:z.string().uuid(),region:z.string().min(2),encryptedStateReference:z.string().min(1),
  viewport:z.object({width:z.number().int().min(320).max(7680),height:z.number().int().min(240).max(4320)}).strict(),
  locale:z.string().min(2).max(35),timeZone:z.string().min(1).max(100),downloadPolicy:z.object({maximumBytes:z.number().int().positive(),allowedMimeTypes:z.array(z.string()).max(100)}).strict(),
  proxyReference:z.string().nullable(),expiresAt:z.string().datetime(),lastUsedAt:z.string().datetime().nullable()
}).strict();
export type CloudProfile=z.infer<typeof cloudProfileSchema>;
export const profileImportSchema=z.object({source:"explicit_local_export",workspaceId:z.string().uuid(),expiresAt:z.string().datetime(),summary:z.object({cookieCount:z.number().int().min(0),localStorageOrigins:z.number().int().min(0),browserPermissions:z.array(z.string()),containsSavedPasswords:z.literal(false)}).strict(),encryptedArchiveReference:z.string().min(1),securityWarningAccepted:z.literal(true),reauthenticationRecommended:z.literal(true)}).strict();
export function validateProfileImport(value:unknown,now:Date= new Date()){const parsed=profileImportSchema.parse(value);if(new Date(parsed.expiresAt)<=now)throw new Error("Cloud profile import has expired.");return parsed;}
