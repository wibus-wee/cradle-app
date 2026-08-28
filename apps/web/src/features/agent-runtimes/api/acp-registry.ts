import {
  deleteAcpAgentsByAgentIdInstallationMutation,
  deleteAcpAgentsByAgentIdMutation,
  getAcpAgentsOptions,
  getAcpAgentsQueryKey,
  getAcpRegistryByAgentIdDistributionTypesOptions,
  getAcpRegistryOptions,
  getAcpRegistryQueryKey,
  patchAcpAgentsByAgentIdLaunchConfigMutation,
  patchAcpAgentsByAgentIdRemoteConfigMutation,
  postAcpAgentsMutation,
  postAcpAgentsRemoteMutation,
  putAcpAgentsByAgentIdInstallationMutation,
} from '~/api-gen/@tanstack/react-query.gen'

export const acpRegistryApi = {
  agentsOptions: getAcpAgentsOptions,
  agentsQueryKey: getAcpAgentsQueryKey,
  registryOptions: getAcpRegistryOptions,
  registryQueryKey: getAcpRegistryQueryKey,
  distributionTypesOptions: getAcpRegistryByAgentIdDistributionTypesOptions,
  createLocalMutation: postAcpAgentsMutation,
  createRemoteMutation: postAcpAgentsRemoteMutation,
  updateLaunchConfigMutation: patchAcpAgentsByAgentIdLaunchConfigMutation,
  updateRemoteConfigMutation: patchAcpAgentsByAgentIdRemoteConfigMutation,
  installMutation: putAcpAgentsByAgentIdInstallationMutation,
  cancelInstallMutation: deleteAcpAgentsByAgentIdInstallationMutation,
  uninstallMutation: deleteAcpAgentsByAgentIdMutation,
} as const
