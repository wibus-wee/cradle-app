import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { COMPOSER_BANG_PTY_HEIGHT_PX } from '../bang-pty'
import { ComposerBangPtyView } from '../views/composer-bang-pty-view'

function FixtureTerminal({ lines }: { lines: string[] }) {
  return (
    <div
      className="h-full overflow-hidden bg-zinc-950 px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-100"
      style={{ height: COMPOSER_BANG_PTY_HEIGHT_PX }}
      data-testid="composer-bang-pty-fixture-terminal"
    >
      {lines.map(line => (
        <div key={line} className="whitespace-pre">
          {line}
        </div>
      ))}
      <span className="inline-block h-3 w-1.5 animate-pulse bg-zinc-200 align-middle" aria-hidden="true" />
    </div>
  )
}

const meta = {
  title: 'Chat/Composer/ComposerBangPtyView',
  component: ComposerBangPtyView,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
  args: {
    busy: false,
    onSubmit: fn(),
    onDiscard: fn(),
  },
} satisfies Meta<typeof ComposerBangPtyView>

export default meta

type Story = StoryObj<typeof meta>

export const IdlePrompt: Story = {
  render: args => (
    <main className="flex min-h-[32rem] items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-zinc-800 shadow-md">
        <ComposerBangPtyView
          {...args}
          terminal={(
            <FixtureTerminal
              lines={[
                'user@cradle:~/workspace$ ',
              ]}
            />
          )}
        />
      </div>
    </main>
  ),
}

export const WithOutput: Story = {
  render: args => (
    <main className="flex min-h-[32rem] items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-zinc-800 shadow-md">
        <ComposerBangPtyView
          {...args}
          terminal={(
            <FixtureTerminal
              lines={[
                'user@cradle:~/workspace$ ls',
                'AGENTS.md  README.md  apps  packages',
                'user@cradle:~/workspace$ git status -sb',
                '## cursor/composer-bang-pty-f544',
                'user@cradle:~/workspace$ ',
              ]}
            />
          )}
        />
      </div>
    </main>
  ),
}

export const BusyWritingBack: Story = {
  args: {
    busy: true,
  },
  render: args => (
    <main className="flex min-h-[32rem] items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-zinc-800 shadow-md">
        <ComposerBangPtyView
          {...args}
          terminal={(
            <FixtureTerminal
              lines={[
                'user@cradle:~/workspace$ pnpm --filter @cradle/web typecheck',
                '…',
                'user@cradle:~/workspace$ ',
              ]}
            />
          )}
        />
      </div>
    </main>
  ),
}
