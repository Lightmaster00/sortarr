import { describe, expect, it } from 'vitest'
import { languageLabel, normalizeCodec, normalizeLanguage, normalizeResolution, parseLanguageList, parseRuntime, resolutionLabel } from '#shared/media'
import { formatDate, formatSize } from '#shared/format'

describe('langues', () => {
  it.each([
    ['English', 'en'], ['eng', 'en'], ['en', 'en'], ['French', 'fr'], ['fre', 'fr'], ['fra', 'fr'],
    ['Français', 'fr'], ['Japanese', 'ja'], ['jpn', 'ja'], ['Portuguese (Brazil)', 'pt'], ['ger', 'de'],
  ])('%s → %s', (raw, code) => {
    expect(normalizeLanguage(raw)).toBe(code)
  })

  it('renvoie null pour une langue vide ou indéterminée', () => {
    for (const raw of ['', 'und', 'Unknown', null, undefined, 42]) expect(normalizeLanguage(raw)).toBeNull()
  })

  it('garde une langue inconnue en minuscules', () => {
    expect(normalizeLanguage('Klingon')).toBe('klingon')
  })

  it('découpe les listes des *arr', () => {
    expect(parseLanguageList('eng/fre')).toEqual(['en', 'fr'])
    expect(parseLanguageList('English / French / English')).toEqual(['en', 'fr'])
    expect(parseLanguageList('en, fr | ja')).toEqual(['en', 'fr', 'ja'])
    expect(parseLanguageList(['French', 'und'])).toEqual(['fr'])
    expect(parseLanguageList(undefined)).toEqual([])
  })

  it('a des libellés français', () => {
    expect(languageLabel('fr')).toBe('Français')
    expect(languageLabel('xx')).toBe('xx')
  })
})

describe('résolution', () => {
  it.each([
    [1080, 1080], [2160, 2160], [720, 720], [576, 480], [0, null],
    ['1920x1080', 1080], ['1920x800', 1080], ['3840x1600', 2160], ['1280x536', 720], ['720x480', 480],
    ['1440x1080', 1080], ['960x720', 720], ['1680x1050', 1080],
    ['1080', 1080],
    ['1080p', 1080], ['4K', 2160], ['', null], [null, null],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeResolution(raw)).toBe(expected)
  })

  it('a des libellés', () => {
    expect(resolutionLabel(2160)).toBe('4K')
    expect(resolutionLabel(1080)).toBe('1080p')
    expect(resolutionLabel(null)).toBe('—')
  })
})

describe('codec et durée', () => {
  it.each([['x265', 'hevc'], ['HEVC', 'hevc'], ['h264', 'h264'], ['AVC', 'h264'], ['AV1', 'av1'], ['VC-1', 'vc1'], ['XviD', 'mpeg4'], ['', null]])('%s → %s', (raw, code) => {
    expect(normalizeCodec(raw)).toBe(code)
  })

  it('convertit la durée en secondes', () => {
    expect(parseRuntime('1:58:00')).toBe(7080)
    expect(parseRuntime('58:30')).toBe(3510)
    expect(parseRuntime('01:02:03.456')).toBe(3723)
    expect(parseRuntime('n/a')).toBeNull()
  })
})

describe('format', () => {
  it('affiche les tailles en Go ou To', () => {
    expect(formatSize(0)).toBe('0 Go')
    expect(formatSize(12.34)).toBe('12,3 Go')
    expect(formatSize(2048)).toBe('2 To')
    expect(formatSize(NaN)).toBe('—')
  })

  it('affiche un tiret pour une date absente', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(Date.UTC(2026, 9, 24, 12))).toBe('24/10/2026')
  })
})
