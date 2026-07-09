import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { ImportTab } from '~/features/plugins/import-tab'
import { InstalledTab } from '~/features/plugins/installed-tab'
import { MarketplaceTab } from '~/features/plugins/marketplace-tab'

export const Route = createFileRoute('/plugins/')({
  component: PluginCenter,
})

function PluginCenter() {
  const { t } = useTranslation('settings')

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden px-8 pt-8">
      <div className="pb-4">
        <h1 className="text-[15px] font-semibold text-foreground">{t('plugins.center.title')}</h1>
      </div>

      <Tabs defaultValue="marketplace" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TabsList className="self-start">
          <TabsTrigger value="marketplace">{t('plugins.center.tab.marketplace')}</TabsTrigger>
          <TabsTrigger value="installed">{t('plugins.center.tab.installed')}</TabsTrigger>
          <TabsTrigger value="import">{t('plugins.center.tab.import')}</TabsTrigger>
        </TabsList>

        <TabsContent value="marketplace" className="min-h-0 flex-1 overflow-hidden">
          <MarketplaceTab />
        </TabsContent>
        <TabsContent value="installed" className="min-h-0 flex-1 overflow-hidden">
          <InstalledTab />
        </TabsContent>
        <TabsContent value="import" className="min-h-0 flex-1 overflow-hidden">
          <ImportTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
