import type { PullRequestDetail } from './api/pull-requests'

type PullRequestPerson = PullRequestDetail['pullRequest']['assignees'][number]

export interface PullRequestPeopleValueViewProps {
  people: PullRequestPerson[]
  empty: string
}

export function PullRequestPeopleValueView({
  people,
  empty,
}: PullRequestPeopleValueViewProps) {
  if (people.length === 0) {
    return <span className="font-normal text-muted-foreground/70">{empty}</span>
  }

  return people.map(person => (
    <a
      key={person.login}
      href={person.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted/50 py-0.5 pl-0.5 pr-2 text-[12px] text-foreground/75 transition-colors hover:bg-muted hover:text-foreground"
    >
      <img
        src={person.avatarUrl}
        alt=""
        className="size-5 rounded-full outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
      />
      <span className="font-medium">{person.login}</span>
    </a>
  ))
}
