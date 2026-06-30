import { getPluginMarketplacePayload } from '@/lib/plugin-marketplace'

export function GET() {
  return Response.json(getPluginMarketplacePayload())
}
