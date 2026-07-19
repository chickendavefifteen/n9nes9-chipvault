export const BUILD_ID = '2026-07-18.11'

export interface BuildManifest {
  build: string
}

function buildNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})\.(\d+)$/.exec(value)
  if (!match) return null
  return Number(`${match[1]}${match[2]}${match[3]}`) * 1000 + Number(match[4])
}

export function isNewerBuild(remoteBuild: string | undefined, currentBuild = BUILD_ID): boolean {
  if (!remoteBuild) return false
  const current = buildNumber(currentBuild)
  const remote = buildNumber(remoteBuild)
  return current !== null && remote !== null && remote > current
}

export function shouldReloadBuild(remoteBuild: string | undefined): boolean {
  return isNewerBuild(remoteBuild)
}

export function buildUpdateAction(remoteBuild: string | undefined, state: {
  playbackActive: boolean
  editing: boolean
  storageHealthy: boolean
}): 'none' | 'reload' | 'notify' {
  if (!isNewerBuild(remoteBuild)) return 'none'
  return !state.playbackActive && !state.editing && state.storageHealthy ? 'reload' : 'notify'
}

export async function fetchBuildManifest(baseUrl: string): Promise<BuildManifest | null> {
  try {
    const response = await fetch(`${baseUrl}version.json?time=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return null
    const manifest = await response.json() as Partial<BuildManifest>
    return typeof manifest.build === 'string' ? { build: manifest.build } : null
  } catch {
    return null
  }
}
