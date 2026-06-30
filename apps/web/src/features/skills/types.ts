import type {
  GetSkillsResponse,
  PostSkillsFetchSourceResponse,
  PostSkillsResponse,
} from '~/api-gen/types.gen'

export type SkillScope = GetSkillsResponse[number]['scope']
export type SkillInventoryEntry = Omit<GetSkillsResponse[number], 'description'> & {
  description: string
}
export type SkillDocument = Omit<PostSkillsResponse, 'description'> & {
  description: string
}
export type ParsedSkillSource = PostSkillsFetchSourceResponse['source']
export type DiscoveredSkill = Omit<PostSkillsFetchSourceResponse['skills'][number], 'description'> & {
  description: string
}
