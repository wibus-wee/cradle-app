import { GithubAppConnectionView } from './github-app-connection-view'
import { useGithubAppConnectionController } from './use-github-app-connection-controller'

export function GithubAppConnection() {
  const controller = useGithubAppConnectionController()
  return (
    <GithubAppConnectionView
      connection={controller.connection}
      pendingLogin={controller.pendingLogin}
      loading={controller.loading}
      connecting={controller.connecting}
      disconnecting={controller.disconnecting}
      labels={controller.labels}
      onInstall={controller.onInstall}
      onConnect={controller.onConnect}
      onContinueInBrowser={controller.onContinueInBrowser}
      onCancel={controller.onCancel}
      onDisconnect={controller.onDisconnect}
    />
  )
}
