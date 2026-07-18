export const BUILD_ID = '2026-07-18.3'

export interface BuildManifest {
  build: string
}

function buildNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})\.(\d+)$/.exec(value)
  if (!match) return null
  return Number(`${match[1]}${match[2]}${match[3]}`) * 1000 + Number(match[4])
}

export function shouldReloadBuild(remoteBuild: string | undefined): boolean {
  if (!remoteBuild) return false
  const current = buildNumber(BUILD_ID)
  const remote = buildNumber(remoteBuild)
  return current !== null && remote !== null && remote > current
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
