import { ConnectDeviceDialogView } from './connect-device-dialog-view'
import { FabricSettingsGroup } from './fabric-settings'
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
        pendingEnrollment={controller.pendingEnrollment}
        pendingInviteCode={controller.inviteCode}
        membershipLoading={controller.membershipLoading}
        membershipError={controller.membershipError}
        managedRelay={controller.managedRelay}
        nodes={controller.nodes}
        nodesLoading={controller.nodesLoading}
        nodesError={controller.nodesError}
        pendingRequests={controller.pendingRequests}
        pendingRequestsLoading={controller.pendingRequestsLoading}
        pendingRequestsError={controller.pendingRequestsError}
        pendingRequestAction={controller.pendingRequestAction}
        networkCode={controller.networkCode}
        canManageAccess={controller.membership?.role === 'owner'}
        reconnectingNodeId={controller.connectingNodeId}
        removingNodeId={controller.removingNodeId}
        cancellingEnrollment={controller.cancellingEnrollment}
        leavingFabric={controller.leavingFabric}
        onLinkDevice={() => controller.setConnectOpen(true)}
        onReconnect={nodeId => void controller.handleReconnect(nodeId)}
        onManageAccess={controller.setAccessNodeId}
        onRemoveNode={nodeId => void controller.handleRemoveNode(nodeId)}
        onRefreshMembership={controller.refreshMembership}
        onRefreshNodes={controller.refreshNodes}
        onRefreshPendingRequests={controller.refreshPendingRequests}
        onApprovePendingRequest={requestId => void controller.handleApprovePendingRequest(requestId)}
        onRejectPendingRequest={requestId => void controller.handleRejectPendingRequest(requestId)}
        onCancelPendingEnrollment={() => void controller.handleCancelEnrollment()}
        onLeaveFabric={() => void controller.handleLeaveFabric()}
        fabricSettings={<FabricSettingsGroup />}
      />
      <ConnectDeviceDialogView
        open={controller.connectOpen}
        fabricExists={controller.membership !== null}
        managedRelay={controller.managedRelay}
        busy={controller.busy}
        networkCode={controller.networkCode}
        inviteCode={controller.inviteCode}
        awaitingApproval={controller.awaitingApproval}
        cancellingEnrollment={controller.cancellingEnrollment}
        onOpenChange={controller.handleConnectOpenChange}
        onStart={() => void controller.handleStart()}
        onGetCode={(code, displayName) => void controller.handleGetCode(code, displayName)}
        onSubmitCode={code => void controller.handleSubmitCode(code)}
        onCancelEnrollment={() => void controller.handleCancelEnrollment()}
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
