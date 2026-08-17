import { ConnectDeviceDialogView } from './connect-device-dialog-view'
import { NodeAccessDialogView } from './node-access-dialog-view'
import { NodesSettingsView } from './nodes-settings-view'
import { useNodesController } from './use-nodes-controller'

/** Settings container for the Fabric membership and Node access lifecycle. */
export function NodesSettings() {
  const controller = useNodesController()

  return (
    <>
      <NodesSettingsView
        membership={controller.membership}
        managedRelay={controller.managedRelay}
        nodes={controller.nodes}
        networkCode={controller.networkCode}
        canManageAccess={controller.membership?.role === 'owner'}
        reconnectingNodeId={controller.connectingNodeId}
        onLinkDevice={() => controller.setConnectOpen(true)}
        onReconnect={nodeId => void controller.handleReconnect(nodeId)}
        onManageAccess={controller.setAccessNodeId}
      />
      <ConnectDeviceDialogView
        open={controller.connectOpen}
        fabricExists={controller.membership !== null}
        managedRelay={controller.managedRelay}
        busy={controller.busy}
        networkCode={controller.networkCode}
        inviteCode={controller.inviteCode}
        awaitingApproval={controller.awaitingApproval}
        onOpenChange={controller.handleConnectOpenChange}
        onStart={() => void controller.handleStart()}
        onGetCode={(code, displayName) => void controller.handleGetCode(code, displayName)}
        onSubmitCode={code => void controller.handleSubmitCode(code)}
      />
      <NodeAccessDialogView
        open={controller.accessNodeId !== null}
        node={controller.accessNode}
        grants={controller.accessGrants}
        revokingGrantId={controller.revokingGrantId}
        onOpenChange={(open) => {
          if (!open) {
            controller.setAccessNodeId(null)
          }
        }}
        onRevokeGrant={grantId => void controller.handleRevokeGrant(grantId)}
      />
    </>
  )
}
