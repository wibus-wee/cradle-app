import {
  deleteAcpAgentsByAgentIdInstallationMutation,
  deleteAcpAgentsByAgentIdMutation,
  getAcpAgentsOptions,
  getAcpAgentsQueryKey,
  getAcpRegistryByAgentIdDistributionTypesOptions,
  getAcpRegistryOptions,
  getAcpRegistryQueryKey,
  patchAcpAgentsByAgentIdLaunchConfigMutation,
  postAcpAgentsMutation,
  putAcpAgentsByAgentIdInstallationMutation,
} from '~/api-gen/@tanstack/react-query.gen'

export const acpRegistryApi = {
  agentsOptions: getAcpAgentsOptions,
  agentsQueryKey: getAcpAgentsQueryKey,
  registryOptions: getAcpRegistryOptions,
  registryQueryKey: getAcpRegistryQueryKey,
  distributionTypesOptions: getAcpRegistryByAgentIdDistributionTypesOptions,
  createLocalMutation: postAcpAgentsMutation,
  updateLaunchConfigMutation: patchAcpAgentsByAgentIdLaunchConfigMutation,
  installMutation: putAcpAgentsByAgentIdInstallationMutation,
  cancelInstallMutation: deleteAcpAgentsByAgentIdInstallationMutation,
  uninstallMutation: deleteAcpAgentsByAgentIdMutation,
} as const
