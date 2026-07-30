import { useEffect } from 'react'

import { openNewWork, openPullRequests } from '~/navigation/navigation-commands'

import { GithubAppConnectionView } from './github-app-connection-view'
import { useGithubRequiredDialogStore } from './github-required-dialog-store'
import { GithubRequiredDialogView } from './github-required-dialog-view'
import { GithubRequiredFixturePreview } from './github-required-fixture-preview'
import { useGithubAppConnectionController } from './use-github-app-connection-controller'

/**
 * Gate dialog for GitHub-backed surfaces. Left pane explains + connects;
 * right pane shows a fixture preview of the locked feature.
 */
export function GithubRequiredDialog() {
  const open = useGithubRequiredDialogStore(s => s.open)
  const feature = useGithubRequiredDialogStore(s => s.feature)
  const close = useGithubRequiredDialogStore(s => s.close)
  const github = useGithubAppConnectionController()

  useEffect(() => {
    if (!open || !feature || !github.isConnected) {
      return
    }
    close()
    if (feature === 'pull-requests') {
      openPullRequests()
      return
    }
    openNewWork()
  }, [close, feature, github.isConnected, open])

  return (
    <GithubRequiredDialogView
      open={open}
      feature={feature}
      onOpenChange={(next) => {
        if (!next) {
          close()
        }
      }}
      connectionPanel={(
        <GithubAppConnectionView
          embedded
          connection={github.connection}
          pendingLogin={github.pendingLogin}
          loading={github.loading}
          connecting={github.connecting}
          disconnecting={github.disconnecting}
          labels={github.labels}
          onInstall={github.onInstall}
          onConnect={github.onConnect}
          onContinueInBrowser={github.onContinueInBrowser}
          onCancel={github.onCancel}
          onDisconnect={github.onDisconnect}
        />
      )}
      fixture={feature
        ? <GithubRequiredFixturePreview feature={feature} />
        : null}
    />
  )
}
