import { spawn } from 'node:child_process'

interface TerminalCandidate {
  label: string
  executable: string
  args: (cwd: string) => string[]
}

const MAC_TERMINAL_CANDIDATES: TerminalCandidate[] = [
  { label: 'Terminal', executable: '/usr/bin/open', args: cwd => ['-a', 'Terminal', cwd] },
  { label: 'iTerm', executable: '/usr/bin/open', args: cwd => ['-a', 'iTerm', cwd] },
  { label: 'Warp', executable: '/usr/bin/open', args: cwd => ['-a', 'Warp', cwd] },
]

const WINDOWS_TERMINAL_CANDIDATES: TerminalCandidate[] = [
  { label: 'Windows Terminal', executable: 'wt.exe', args: cwd => ['-d', cwd] },
  { label: 'PowerShell', executable: 'cmd.exe', args: () => ['/d', '/s', '/c', 'start "" powershell.exe -NoExit -NoLogo'] },
  { label: 'Command Prompt', executable: 'cmd.exe', args: () => ['/d', '/s', '/c', 'start "" cmd.exe /K'] },
]

const LINUX_TERMINAL_CANDIDATES: TerminalCandidate[] = [
  { label: 'x-terminal-emulator', executable: 'x-terminal-emulator', args: () => [] },
  { label: 'GNOME Terminal', executable: 'gnome-terminal', args: cwd => [`--working-directory=${cwd}`] },
  { label: 'Konsole', executable: 'konsole', args: cwd => ['--workdir', cwd] },
  { label: 'XFCE Terminal', executable: 'xfce4-terminal', args: cwd => [`--working-directory=${cwd}`] },
  { label: 'Kitty', executable: 'kitty', args: cwd => ['--directory', cwd] },
  { label: 'Alacritty', executable: 'alacritty', args: cwd => ['--working-directory', cwd] },
  { label: 'WezTerm', executable: 'wezterm', args: cwd => ['start', '--cwd', cwd] },
  { label: 'XTerm', executable: 'xterm', args: () => [] },
]

export function readTerminalLaunchCandidates(platform: NodeJS.Platform = process.platform): readonly TerminalCandidate[] {
  if (platform === 'darwin') {
    return MAC_TERMINAL_CANDIDATES
  }
  if (platform === 'win32') {
    return WINDOWS_TERMINAL_CANDIDATES
  }
  return LINUX_TERMINAL_CANDIDATES
}

function runTerminalCandidate(candidate: TerminalCandidate, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(candidate.executable, candidate.args(cwd), {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export async function launchPathInTerminal(cwd: string): Promise<string> {
  const candidates = readTerminalLaunchCandidates()
  const errors: string[] = []

  for (const candidate of candidates) {
    try {
      await runTerminalCandidate(candidate, cwd)
      return candidate.label
    }
    catch (error) {
      errors.push(`${candidate.label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw new Error(`No supported terminal could open ${cwd}. Tried ${candidates.map(candidate => candidate.label).join(', ')}. ${errors.join(' | ')}`)
}
