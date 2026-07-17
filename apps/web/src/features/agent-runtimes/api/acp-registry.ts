import {
  deleteAcpAgentsByAgentIdInstallationMutation,
  deleteAcpAgentsByAgentIdMutation,
  getAcpAgentsOptions,
  getAcpAgentsQueryKey,
  getAcpRegistryOptions,
  getAcpRegistryQueryKey,
  putAcpAgentsByAgentIdInstallationMutation,
} from '~/api-gen/@tanstack/react-query.gen'

export const acpRegistryApi = {
  agentsOptions: getAcpAgentsOptions,
  agentsQueryKey: getAcpAgentsQueryKey,
  registryOptions: getAcpRegistryOptions,
  registryQueryKey: getAcpRegistryQueryKey,
  installMutation: putAcpAgentsByAgentIdInstallationMutation,
  cancelInstallMutation: deleteAcpAgentsByAgentIdInstallationMutation,
  uninstallMutation: deleteAcpAgentsByAgentIdMutation,
} as const
