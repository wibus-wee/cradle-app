import { z } from 'zod'

const RawAcpChatConfigSchema = z.object({
  distributionType: z.enum(['binary', 'npx', 'uvx']).default('npx'),
  installPath: z.string().trim().min(1).nullable().default(null),
  cmd: z.string().trim().min(1).optional(),
  packageName: z.string().trim().min(1).optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
})

export const acpChatConfigSchema = RawAcpChatConfigSchema
  .transform(({ packageName, ...config }) => ({
    ...config,
    cmd: config.cmd ?? packageName,
  }))
  .pipe(z.object({
    distributionType: z.enum(['binary', 'npx', 'uvx']),
    installPath: z.string().trim().min(1).nullable(),
    cmd: z.string().trim().min(1),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()),
  }))

export const acpChatConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(acpChatConfigSchema)

export type AcpChatConfig = z.infer<typeof acpChatConfigSchema>
