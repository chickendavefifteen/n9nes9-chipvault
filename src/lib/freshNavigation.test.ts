import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(resolve('index.html'), 'utf8')
const source = html.match(/<script id="chipvault-fresh-navigation">([\s\S]*?)<\/script>/)?.[1]

function runBootstrap(href: string) {
  const replacements: string[] = []
  const cleanUrls: string[] = []
  const window = {
    location: { href, replace: (url: string) => replacements.push(url) },
    history: { replaceState: (_state: null, _title: string, url: string) => cleanUrls.push(url) },
  }
  const fakeDate = { now: () => 123456789 }
  const fakeMath = { random: () => 0.5 }
  if (!source) throw new Error('Fresh-navigation bootstrap is missing from index.html')
  Function('window', 'URL', 'Date', 'Math', source)(window, URL, fakeDate, fakeMath)
  return { replacements, cleanUrls }
}

describe('fresh navigation bootstrap', () => {
  it('redirects every clean entry URL to a unique cache-busting document request', () => {
    const result = runBootstrap('https://example.test/n9nes9-chipvault/?filter=all#interstellar-odyssey')
    expect(result.replacements).toHaveLength(1)
    const redirected = new URL(result.replacements[0])
    expect(redirected.searchParams.get('filter')).toBe('all')
    expect(redirected.searchParams.get('fresh')).toMatch(/^21i3v9-/)
    expect(redirected.hash).toBe('#interstellar-odyssey')
    expect(result.cleanUrls).toHaveLength(0)
  })

  it('removes only the fresh token without another navigation or redirect loop', () => {
    const result = runBootstrap('https://example.test/n9nes9-chipvault/?filter=all&fresh=unique#dark-moon-city')
    expect(result.replacements).toHaveLength(0)
    expect(result.cleanUrls).toEqual(['/n9nes9-chipvault/?filter=all#dark-moon-city'])
  })

  it('runs before the Vite application entrypoint', () => {
    expect(html.indexOf('chipvault-fresh-navigation')).toBeGreaterThan(0)
    expect(html.indexOf('chipvault-fresh-navigation')).toBeLessThan(html.indexOf('/src/main.tsx'))
  })
})
