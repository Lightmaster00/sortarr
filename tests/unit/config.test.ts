import { afterEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import { configDir, mediaRoot } from '../../server/lib/config'

const saved = { config: process.env.SORTARR_CONFIG_DIR, media: process.env.SORTARR_MEDIA_ROOT }

afterEach(() => {
  process.env.SORTARR_CONFIG_DIR = saved.config
  process.env.SORTARR_MEDIA_ROOT = saved.media
})

describe('config', () => {
  it('lit SORTARR_CONFIG_DIR', () => {
    process.env.SORTARR_CONFIG_DIR = '/tmp/sortarr-x'
    expect(configDir()).toBe(path.resolve('/tmp/sortarr-x'))
  })

  it('utilise ./config par défaut', () => {
    delete process.env.SORTARR_CONFIG_DIR
    expect(configDir()).toBe(path.resolve(process.cwd(), 'config'))
  })

  it('utilise /media par défaut et ignore les espaces', () => {
    delete process.env.SORTARR_MEDIA_ROOT
    expect(mediaRoot()).toBe('/media')
    process.env.SORTARR_MEDIA_ROOT = '  /mnt/media  '
    expect(mediaRoot()).toBe('/mnt/media')
  })
})
