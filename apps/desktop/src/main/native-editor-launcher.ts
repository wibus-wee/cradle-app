import { execFile } from 'node:child_process'

interface EditorCandidate {
  label: string
  executable: string
  args: (targetPath: string) => string[]
}

const MAC_EDITOR_CANDIDATES: EditorCandidate[] = [
  { label: 'Visual Studio Code', executable: '/usr/bin/open', args: targetPath => ['-a', 'Visual Studio Code', targetPath] },
  { label: 'Cursor', executable: '/usr/bin/open', args: targetPath => ['-a', 'Cursor', targetPath] },
  { label: 'Windsurf', executable: '/usr/bin/open', args: targetPath => ['-a', 'Windsurf', targetPath] },
  { label: 'Zed', executable: '/usr/bin/open', args: targetPath => ['-a', 'Zed', targetPath] },
  { label: 'Sublime Text', executable: '/usr/bin/open', args: targetPath => ['-a', 'Sublime Text', targetPath] },
]

const CLI_EDITOR_CANDIDATES: EditorCandidate[] = [
  { label: 'code', executable: 'code', args: targetPath => [targetPath] },
  { label: 'cursor', executable: 'cursor', args: targetPath => [targetPath] },
  { label: 'windsurf', executable: 'windsurf', args: targetPath => [targetPath] },
  { label: 'zed', executable: 'zed', args: targetPath => [targetPath] },
  { label: 'subl', executable: 'subl', args: targetPath => [targetPath] },
]

export function readEditorLaunchCandidates(platform: NodeJS.Platform = process.platform): readonly EditorCandidate[] {
  return platform === 'darwin'
    ? [...MAC_EDITOR_CANDIDATES, ...CLI_EDITOR_CANDIDATES]
    : CLI_EDITOR_CANDIDATES
}

function runEditorCandidate(candidate: EditorCandidate, targetPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(candidate.executable, candidate.args(targetPath), { windowsHide: true }, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export async function launchPathInEditor(targetPath: string): Promise<string> {
  const candidates = readEditorLaunchCandidates()
  const errors: string[] = []

  for (const candidate of candidates) {
    try {
      await runEditorCandidate(candidate, targetPath)
      return candidate.label
    }
    catch (error) {
      errors.push(`${candidate.label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw new Error(`No supported editor could open ${targetPath}. Tried ${candidates.map(candidate => candidate.label).join(', ')}. ${errors.join(' | ')}`)
}
