# Sortarr — Phase 1 (Socle) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer une application Nuxt dockerisée avec connexion admin, gestion des instances Radarr/Sonarr/Plex/Jellyfin depuis l'interface (test de connexion, état), correspondance des chemins avec suggestions, synchronisation planifiée vers un catalogue SQLite, et une page Catalogue en lecture seule avec le moteur de filtres.

**Architecture:** Une seule app Nuxt 4 (front SPA + serveur Nitro). Le code métier serveur vit dans `server/lib/` et `server/connectors/` (imports explicites, testables sans Nuxt) ; les routes `server/api/` sont de fines couches qui valident l'entrée (Zod) et appellent ces modules. Le code partagé front/serveur (types, schémas, moteur de filtres) vit dans `shared/` (alias `#shared`).

**Tech Stack:** Nuxt 4, Nuxt UI 4, TypeScript, Zod 4, better-sqlite3, croner, bcryptjs, Vitest 4, @nuxt/test-utils 4, Docker (node:24-alpine).

**Spec :** `docs/superpowers/specs/2026-10-24-sortarr-design.md` (§3, §4, §5, §9, §10, §11, §12, phase 1 du §13).

## Global Constraints

- Langue de l'interface et des messages d'erreur : français.
- Volumes conteneur : `/config` (base SQLite, réglages, clés API) et `/media` (racine médias du NAS, lecture-écriture). En dehors de Docker : `SORTARR_CONFIG_DIR` (défaut `./config`) et `SORTARR_MEDIA_ROOT` (défaut `/media`).
- Clés API chiffrées au repos, **jamais renvoyées au front** (le DTO expose seulement `hasKey`).
- Compte admin unique ; mot de passe bcrypt ; cookie de session httpOnly, `SameSite=Lax`.
- Toutes les routes `/api/**` exigent une session, sauf `/api/health`, `/api/auth/status`, `/api/auth/login`, `/api/auth/setup`.
- Appels HTTP sortants : délai max 15 s, 3 tentatives au total avec délai croissant, uniquement sur erreurs réseau et 5xx.
- Jellyfin : en-tête `Authorization: MediaBrowser Token="<clé>"` (pas `X-Emby-Token`).
- Une instance dont la dernière synchro a échoué passe « périmée » (`perime`) si elle avait déjà été synchronisée, sinon « erreur ». Ses données précédentes sont conservées.
- Synchro : cron configurable, défaut `0 * * * *`, + bouton manuel. Une seule synchro à la fois.
- Aucun test n'écrit sur les vrais services. Les tests serveur utilisent une base `:memory:` et des dossiers temporaires.
- Rien de destructif en phase 1 : aucune suppression, migration ni écriture vers Radarr/Sonarr/Plex/Jellyfin.

## File Structure

```
package.json, nuxt.config.ts, tsconfig.json, vitest.config.ts, app.config.ts → app/app.config.ts
.gitignore, Dockerfile, entrypoint.sh, docker-compose.yml, unraid/sortarr.xml, README.md

shared/
  media.ts        normalisation langues / résolution / codec / durée + libellés
  format.ts       formatSize, formatDate, formatDateTime
  auth.ts         schémas Zod connexion / création / changement de mot de passe
  instances.ts    types, libellés, schémas Zod des instances, Discovery, TestResult
  paths.ts        types et schémas des correspondances de chemins
  sync.ts         types de l'état de synchro
  filters.ts      registre des champs, opérateurs, schéma, validateFilter, matches
  catalog.ts      schéma de requête catalogue, CatalogResult, ItemDetail, DashboardDto

server/lib/
  config.ts       configDir(), mediaRoot()
  errors.ts       AppError
  api.ts          defineApiHandler, parseOrThrow, parseId
  db.ts           openDatabase, getDb, setDbForTests
  schema.ts       migrations SQLite
  settings.ts     getSetting / setSetting
  secrets.ts      encrypt / decrypt (AES-256-GCM, clé dans /config/secret)
  auth.ts         compte admin, sessions
  sessionCookie.ts cookie de session
  http.ts         httpJson (timeout, retries) + HttpError
  concurrency.ts  mapLimit
  instances.ts    CRUD des instances, statut, garde de suppression
  discovery.ts    test de connexion + découverte
  envImport.ts    import de media.env
  paths.ts        toReal/toService, suggestions, vérification
  catalog.ts      lignes du catalogue, requêtes, fiche détaillée, options des champs
  scheduler.ts    planification croner de la synchro
  sync/types.ts   enregistrements normalisés produits par les connecteurs
  sync/store.ts   écriture du catalogue
  sync/fetchers.ts appels connecteurs par type d'instance
  sync/runner.ts  orchestration, état, verrou

server/connectors/  arr.ts, plex.ts, jellyfin.ts (clients HTTP + mappers purs)
server/middleware/auth.ts
server/plugins/scheduler.ts
server/api/...      routes (détaillées dans chaque tâche)

app/
  app.vue, assets/css/main.css, app.config.ts
  composables/useApi.ts, composables/useSync.ts
  middleware/auth.global.ts
  layouts/default.vue, layouts/auth.vue
  components/AppPage.vue, AppStatusBar.vue, InstanceForm.vue, DiscoveryResult.vue,
             FilterBuilder.vue, FilterConditionRow.vue, ItemDetail.vue
  pages/login.vue, setup.vue, index.vue, catalogue.vue,
        reglages/instances.vue, reglages/chemins.vue, reglages/general.vue

scripts/record-fixtures.mjs
tests/setup.ts, tests/helpers/db.ts, tests/helpers/fetch.ts
tests/unit/**.test.ts, tests/e2e/api.test.ts, tests/fixtures/recorded/ (généré)
```

---

### Task 1: Projet Nuxt, Nuxt UI, Vitest et configuration des dossiers

**Files:**
- Create: `package.json` (via npm), `nuxt.config.ts`, `tsconfig.json`, `vitest.config.ts`, `app/app.vue`, `app/app.config.ts`, `app/assets/css/main.css`, `app/pages/index.vue` (temporaire), `server/lib/config.ts`, `tests/setup.ts`
- Modify: `.gitignore`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `configDir(): string`, `mediaRoot(): string` (chemins absolus, relus à chaque appel depuis l'environnement).

- [ ] **Step 1: Initialiser package.json et installer les dépendances**

```bash
cd sortarr
npm init -y >/dev/null
npm pkg set name=sortarr type=module private=true --json
npm pkg delete main scripts.test keywords author license description version
npm pkg set scripts.dev="nuxt dev" scripts.build="nuxt build" scripts.preview="nuxt preview" scripts.postinstall="nuxt prepare" scripts.test="vitest run" scripts.test:watch="vitest" scripts.typecheck="nuxt typecheck"
npm install nuxt@^4.6.0 @nuxt/ui@^4.4.0 tailwindcss@^4.2.0 zod@^4.3.6 better-sqlite3@^12.10.0 croner@^10.0.1 bcryptjs@^3.0.3 @iconify-json/lucide@^1.2.93
npm install -D vitest@^4.1.10 @nuxt/test-utils@^4.1.0 @types/better-sqlite3@^7.6.13 @types/bcryptjs@^2.4.6 @types/node@^24 typescript vue-tsc
```

Expected: installation sans erreur ; `nuxt prepare` s'exécute à la fin (il peut avertir qu'il n'y a pas encore de `nuxt.config.ts`, c'est normal).

- [ ] **Step 2: Écrire la configuration Nuxt**

`nuxt.config.ts` :

```ts
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  // Application d'administration privée : rendu côté client uniquement.
  ssr: false,
  nitro: {
    externals: { external: ['better-sqlite3'] },
  },
  app: {
    head: {
      title: 'Sortarr',
      htmlAttrs: { lang: 'fr' },
      meta: [{ name: 'robots', content: 'noindex, nofollow' }],
    },
  },
})
```

`tsconfig.json` :

```json
{
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.app.json" },
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" }
  ]
}
```

`app/assets/css/main.css` :

```css
@import "tailwindcss";
@import "@nuxt/ui";
```

`app/app.config.ts` :

```ts
export default defineAppConfig({
  ui: {
    colors: { primary: 'emerald', neutral: 'zinc' },
  },
})
```

`app/app.vue` :

```vue
<script setup lang="ts">
import { fr } from '@nuxt/ui/locale'
</script>

<template>
  <UApp :locale="fr">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
```

`app/pages/index.vue` (remplacée à la tâche 20) :

```vue
<template>
  <div class="p-8"><h1 class="text-xl font-semibold">Sortarr</h1></div>
</template>
```

- [ ] **Step 3: Configurer Vitest et l'environnement de test**

`vitest.config.ts` :

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '~~': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    unstubGlobals: true,
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
})
```

`tests/setup.ts` :

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Chaque fichier de test a ses propres dossiers temporaires : jamais ./config ni le vrai /media.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sortarr-test-'))
process.env.SORTARR_CONFIG_DIR = path.join(root, 'config')
process.env.SORTARR_MEDIA_ROOT = path.join(root, 'media')
process.env.SORTARR_DISABLE_SCHEDULER = '1'
fs.mkdirSync(process.env.SORTARR_MEDIA_ROOT, { recursive: true })
process.on('exit', () => {
  try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
})
```

Ajouter à `.gitignore` (garder les lignes existantes) :

```
.vitest/
coverage/
tests/fixtures/recorded/*.raw.json
```

- [ ] **Step 4: Écrire le test qui échoue**

`tests/unit/config.test.ts` :

```ts
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
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL — `Failed to resolve import "../../server/lib/config"`.

- [ ] **Step 6: Implémenter `server/lib/config.ts`**

```ts
import path from 'node:path'

/** Dossier des données de Sortarr (base, secret, media.env). /config dans Docker. */
export function configDir(): string {
  const value = process.env.SORTARR_CONFIG_DIR?.trim()
  return value ? path.resolve(value) : path.resolve(process.cwd(), 'config')
}

/** Racine des médias du NAS telle que montée dans le conteneur. */
export function mediaRoot(): string {
  const value = process.env.SORTARR_MEDIA_ROOT?.trim()
  return path.resolve(value || '/media')
}
```

- [ ] **Step 7: Vérifier tests, typecheck et build**

Run: `npx vitest run tests/unit/config.test.ts`
Expected: PASS (3 tests).

Run: `npm run typecheck && npm run build`
Expected: pas d'erreur TypeScript ; build terminé avec `.output/server/index.mjs`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: projet Nuxt 4 + Nuxt UI + Vitest"
```

---

### Task 2: Base SQLite, migrations et réglages

**Files:**
- Create: `server/lib/errors.ts`, `server/lib/db.ts`, `server/lib/schema.ts`, `server/lib/settings.ts`, `tests/helpers/db.ts`
- Test: `tests/unit/db.test.ts`

**Interfaces:**
- Consumes: `configDir()` (tâche 1).
- Produces:
  - `class AppError extends Error { statusCode: number; details: string[] }` — `new AppError(message, statusCode = 400, details = [])`.
  - `type Db = Database.Database`, `openDatabase(file: string): Db`, `getDb(): Db`, `setDbForTests(db: Db | null): void`.
  - `migrate(db: Db): void`, `SCHEMA_VERSION: number`.
  - `getSetting(key: string, db?: Db): string | null`, `setSetting(key: string, value: string, db?: Db): void`.
  - `useTestDb(): () => Db` (helper de test : base `:memory:` neuve par test).
  - Tables : `settings`, `users`, `sessions`, `instances`, `path_mappings`, `items`, `files`, `presences`, `watch_history`, `disk_entries` (colonnes ci-dessous, utilisées par toutes les tâches suivantes).

- [ ] **Step 1: Écrire le helper de test et le test qui échoue**

`tests/helpers/db.ts` :

```ts
import { afterEach, beforeEach } from 'vitest'
import { openDatabase, setDbForTests, type Db } from '../../server/lib/db'

/** Une base en mémoire neuve pour chaque test, branchée sur getDb(). */
export function useTestDb(): () => Db {
  let db: Db
  beforeEach(() => {
    db = openDatabase(':memory:')
    setDbForTests(db)
  })
  afterEach(() => {
    setDbForTests(null)
    db.close()
  })
  return () => db
}
```

`tests/unit/db.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { getDb, openDatabase, setDbForTests } from '../../server/lib/db'
import { migrate, SCHEMA_VERSION } from '../../server/lib/schema'
import { getSetting, setSetting } from '../../server/lib/settings'
import { configDir } from '../../server/lib/config'
import { useTestDb } from '../helpers/db'

const db = useTestDb()

describe('schéma', () => {
  it('crée toutes les tables et fixe user_version', () => {
    const tables = (db().prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(t => t.name)
    expect(tables).toEqual(expect.arrayContaining([
      'settings', 'users', 'sessions', 'instances', 'path_mappings', 'items', 'files', 'presences', 'watch_history', 'disk_entries',
    ]))
    expect(db().pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('est idempotent', () => {
    expect(() => migrate(db())).not.toThrow()
    expect(db().pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('active les clés étrangères (suppression en cascade)', () => {
    db().prepare("INSERT INTO instances (kind, name, url, api_key_enc, created_at) VALUES ('radarr', 'R', 'http://r', 'x', 0)").run()
    db().prepare("INSERT INTO path_mappings (instance_id, service_path, real_path) VALUES (1, '/movies', '/media/movies')").run()
    db().prepare('DELETE FROM instances WHERE id = 1').run()
    expect(db().prepare('SELECT COUNT(*) AS n FROM path_mappings').get()).toEqual({ n: 0 })
  })
})

describe('réglages', () => {
  it('lit, écrit et remplace une valeur', () => {
    expect(getSetting('sync_cron')).toBeNull()
    setSetting('sync_cron', '0 * * * *')
    setSetting('sync_cron', '0 4 * * *')
    expect(getSetting('sync_cron')).toBe('0 4 * * *')
  })
})

describe('getDb', () => {
  it('ouvre sortarr.db dans le dossier de config', () => {
    setDbForTests(null)
    const real = getDb()
    expect(fs.existsSync(path.join(configDir(), 'sortarr.db'))).toBe(true)
    real.close()
    setDbForTests(openDatabase(':memory:'))
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/db.test.ts`
Expected: FAIL — `Failed to resolve import "../../server/lib/db"`.

- [ ] **Step 3: Implémenter les modules**

`server/lib/errors.ts` :

```ts
/** Erreur métier : son message est affiché tel quel à l'utilisateur. */
export class AppError extends Error {
  constructor(message: string, public readonly statusCode = 400, public readonly details: string[] = []) {
    super(message)
    this.name = 'AppError'
  }
}
```

`server/lib/schema.ts` :

```ts
import type { Db } from './db'

const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('radarr', 'sonarr', 'plex', 'jellyfin')),
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    url TEXT NOT NULL,
    api_key_enc TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    version TEXT,
    last_status TEXT NOT NULL DEFAULT 'inconnu' CHECK (last_status IN ('inconnu', 'ok', 'erreur', 'perime')),
    last_status_at INTEGER,
    last_error TEXT,
    last_sync_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE path_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    service_path TEXT NOT NULL,
    real_path TEXT NOT NULL,
    managed INTEGER NOT NULL DEFAULT 1,
    UNIQUE (instance_id, service_path)
  );

  CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_key TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('movie', 'series')),
    title TEXT NOT NULL,
    year INTEGER,
    tmdb_id INTEGER,
    tvdb_id INTEGER,
    imdb_id TEXT,
    original_language TEXT,
    genres TEXT NOT NULL DEFAULT '[]',
    rating_tmdb REAL,
    rating_imdb REAL,
    added_at INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    external_id INTEGER NOT NULL,
    season INTEGER,
    episode INTEGER,
    real_path TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    resolution INTEGER,
    video_codec TEXT,
    audio_languages TEXT NOT NULL DEFAULT '[]',
    subtitle_languages TEXT NOT NULL DEFAULT '[]',
    is_remux INTEGER NOT NULL DEFAULT 0,
    runtime_seconds INTEGER
  );
  CREATE INDEX files_item ON files(item_id);

  CREATE TABLE presences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    library TEXT,
    root_folder TEXT,
    real_folder TEXT,
    monitored INTEGER,
    has_file INTEGER,
    size INTEGER,
    tags TEXT NOT NULL DEFAULT '[]',
    synced_at INTEGER NOT NULL,
    UNIQUE (instance_id, external_id)
  );
  CREATE INDEX presences_item ON presences(item_id);
  CREATE INDEX presences_folder ON presences(real_folder);

  CREATE TABLE watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    server_instance_id INTEGER NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    user TEXT NOT NULL,
    last_watched_at INTEGER,
    play_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, server_instance_id, user)
  );

  CREATE TABLE disk_entries (
    real_path TEXT PRIMARY KEY,
    parent_real_path TEXT NOT NULL,
    scanned_at INTEGER NOT NULL
  );
  `,
]

export const SCHEMA_VERSION = MIGRATIONS.length

/** Applique les migrations manquantes, chacune dans une transaction. */
export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!)
      db.pragma(`user_version = ${i + 1}`)
    })()
  }
}
```

`server/lib/db.ts` :

```ts
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { configDir } from './config'
import { migrate } from './schema'

export type Db = Database.Database

let instance: Db | null = null

/** Ouvre (et migre) une base SQLite. ':memory:' pour les tests. */
export function openDatabase(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

/** La base de l'application : <configDir>/sortarr.db, ouverte au premier appel. */
export function getDb(): Db {
  if (instance?.open) return instance
  const dir = configDir()
  fs.mkdirSync(dir, { recursive: true })
  instance = openDatabase(path.join(dir, 'sortarr.db'))
  return instance
}

/** Tests uniquement : remplace la base renvoyée par getDb(). */
export function setDbForTests(db: Db | null): void {
  instance = db
}
```

`server/lib/settings.ts` :

```ts
import { getDb, type Db } from './db'

export function getSetting(key: string, db: Db = getDb()): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string, db: Db = getDb()): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run tests/unit/db.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib tests
git commit -m "feat: base SQLite, migrations et réglages"
```

---

### Task 3: Chiffrement des clés API

**Files:**
- Create: `server/lib/secrets.ts`
- Test: `tests/unit/secrets.test.ts`

**Interfaces:**
- Consumes: `configDir()`.
- Produces: `encrypt(plain: string): string` (format `v1:<iv>:<tag>:<data>` en base64), `decrypt(token: string): string`, `resetSecretCacheForTests(): void`. La clé maître (32 octets hex) est créée dans `<configDir>/secret` (mode 600) au premier usage.

- [ ] **Step 1: Écrire le test qui échoue**

`tests/unit/secrets.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { decrypt, encrypt, resetSecretCacheForTests } from '../../server/lib/secrets'
import { configDir } from '../../server/lib/config'

beforeEach(() => resetSecretCacheForTests())

describe('secrets', () => {
  it('chiffre et déchiffre', () => {
    const token = encrypt('ma-cle-api')
    expect(token.startsWith('v1:')).toBe(true)
    expect(token).not.toContain('ma-cle-api')
    expect(decrypt(token)).toBe('ma-cle-api')
  })

  it('produit un chiffré différent à chaque appel', () => {
    expect(encrypt('x')).not.toBe(encrypt('x'))
  })

  it('refuse un chiffré modifié', () => {
    const [v, iv, tag, data] = encrypt('ma-cle-api').split(':')
    const flipped = Buffer.from(data!, 'base64')
    flipped[0] = flipped[0]! ^ 0xff
    expect(() => decrypt([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow()
  })

  it('réutilise la clé maître enregistrée après un redémarrage', () => {
    const token = encrypt('persistante')
    expect(fs.existsSync(path.join(configDir(), 'secret'))).toBe(true)
    resetSecretCacheForTests()
    expect(decrypt(token)).toBe('persistante')
  })

  it('rejette un format inconnu', () => {
    expect(() => decrypt('pas-un-secret')).toThrow('Secret chiffré illisible')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/secrets.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `server/lib/secrets.ts`**

```ts
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { configDir } from './config'

let cachedKey: Buffer | null = null

function masterKey(): Buffer {
  if (cachedKey) return cachedKey
  const dir = configDir()
  const file = path.join(dir, 'secret')
  let key: Buffer
  if (fs.existsSync(file)) {
    key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex')
  } else {
    fs.mkdirSync(dir, { recursive: true })
    key = crypto.randomBytes(32)
    fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 })
  }
  if (key.length !== 32) throw new Error(`Fichier ${file} invalide : 64 caractères hexadécimaux attendus.`)
  cachedKey = key
  return key
}

/** Tests uniquement : oublie la clé en mémoire, comme un redémarrage. */
export function resetSecretCacheForTests(): void {
  cachedKey = null
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':')
}

export function decrypt(token: string): string {
  const [version, iv, tag, data] = token.split(':')
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Secret chiffré illisible.')
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run tests/unit/secrets.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/secrets.ts tests/unit/secrets.test.ts
git commit -m "feat: chiffrement AES-GCM des clés API"
```

---

### Task 4: Compte admin, sessions, middleware et routes d'authentification

**Files:**
- Create: `shared/auth.ts`, `server/lib/api.ts`, `server/lib/auth.ts`, `server/lib/sessionCookie.ts`, `server/middleware/auth.ts`, `server/api/health.get.ts`, `server/api/auth/status.get.ts`, `server/api/auth/setup.post.ts`, `server/api/auth/login.post.ts`, `server/api/auth/logout.post.ts`, `server/api/auth/password.post.ts`
- Test: `tests/unit/auth.test.ts`, `tests/e2e/api.test.ts`

**Interfaces:**
- Consumes: `getDb`, `AppError`.
- Produces:
  - `shared/auth.ts` : `loginSchema` (`{ username, password }`), `setupSchema` (`{ username, password, confirm }`, mot de passe ≥ 8), `passwordChangeSchema` (`{ current, next, confirm }`), `MIN_PASSWORD_LENGTH = 8`.
  - `server/lib/api.ts` : `defineApiHandler(fn)` (convertit `AppError` et `HttpError` en erreurs HTTP avec `message` lisible et `data.details`), `parseOrThrow(schema, data)`, `parseId(event): number`.
  - `server/lib/auth.ts` : `SESSION_COOKIE = 'sortarr_session'`, `SESSION_TTL_MS`, `hasAdmin()`, `createAdmin(username, password)`, `verifyCredentials(username, password): Promise<boolean>`, `createSession(): string`, `isValidSession(id?: string): boolean`, `deleteSession(id)`, `changePassword(current, next)`.
  - `server/lib/sessionCookie.ts` : `setSessionCookie(event, id)`, `clearSessionCookie(event)`, `readSessionId(event)`.
  - Routes : `GET /api/health → { ok: true }`, `GET /api/auth/status → { hasAdmin, authenticated }`, `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/password` (toutes renvoient `{ ok: true }`).
  - Règle CSRF : toute requête `/api/**` en POST/PUT/PATCH/DELETE doit porter l'en-tête `x-sortarr: 1`, sinon 403.

> Note pour `defineApiHandler` : h3 retire les caractères non ASCII de `statusMessage`. Le texte français part donc dans `message` ; le front lit `error.data.message` (tâche 16).

- [ ] **Step 1: Écrire les tests unitaires qui échouent**

`tests/unit/auth.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { changePassword, createAdmin, createSession, deleteSession, hasAdmin, isValidSession, SESSION_TTL_MS, verifyCredentials } from '../../server/lib/auth'
import { useTestDb } from '../helpers/db'

const db = useTestDb()

describe('compte admin', () => {
  it('crée le compte une seule fois', async () => {
    expect(hasAdmin()).toBe(false)
    await createAdmin('admin', 'motdepasse1')
    expect(hasAdmin()).toBe(true)
    await expect(createAdmin('autre', 'motdepasse2')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuse un mot de passe trop court', async () => {
    await expect(createAdmin('admin', 'court')).rejects.toThrow('au moins 8 caractères')
  })

  it('vérifie les identifiants', async () => {
    await createAdmin('admin', 'motdepasse1')
    expect(await verifyCredentials('admin', 'motdepasse1')).toBe(true)
    expect(await verifyCredentials('admin', 'mauvais')).toBe(false)
    expect(await verifyCredentials('inconnu', 'motdepasse1')).toBe(false)
  })

  it('ne stocke pas le mot de passe en clair', async () => {
    await createAdmin('admin', 'motdepasse1')
    const row = db().prepare('SELECT password_hash FROM users').get() as { password_hash: string }
    expect(row.password_hash).not.toContain('motdepasse1')
    expect(row.password_hash.startsWith('$2')).toBe(true)
  })
})

describe('sessions', () => {
  it('crée, valide et supprime une session', () => {
    const id = createSession()
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(isValidSession(id)).toBe(true)
    deleteSession(id)
    expect(isValidSession(id)).toBe(false)
    expect(isValidSession(undefined)).toBe(false)
  })

  it('expire après SESSION_TTL_MS', () => {
    const now = 1_000_000
    const id = createSession(undefined, now)
    expect(isValidSession(id, undefined, now + SESSION_TTL_MS - 1)).toBe(true)
    expect(isValidSession(id, undefined, now + SESSION_TTL_MS + 1)).toBe(false)
  })

  it('changer le mot de passe ferme toutes les sessions', async () => {
    await createAdmin('admin', 'motdepasse1')
    const id = createSession()
    await expect(changePassword('mauvais', 'nouveaumdp1')).rejects.toMatchObject({ statusCode: 403 })
    await changePassword('motdepasse1', 'nouveaumdp1')
    expect(isValidSession(id)).toBe(false)
    expect(await verifyCredentials('admin', 'nouveaumdp1')).toBe(true)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/auth.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le code partagé et le module d'auth**

`shared/auth.ts` :

```ts
import { z } from 'zod'

export const MIN_PASSWORD_LENGTH = 8

const password = z.string().min(MIN_PASSWORD_LENGTH, `Au moins ${MIN_PASSWORD_LENGTH} caractères`)

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Nom d'utilisateur obligatoire"),
  password: z.string().min(1, 'Mot de passe obligatoire'),
})

export const setupSchema = z.object({
  username: z.string().trim().min(1, "Nom d'utilisateur obligatoire").max(60),
  password,
  confirm: z.string(),
}).refine(v => v.password === v.confirm, { message: 'Les mots de passe ne correspondent pas', path: ['confirm'] })

export const passwordChangeSchema = z.object({
  current: z.string().min(1, 'Mot de passe actuel obligatoire'),
  next: password,
  confirm: z.string(),
}).refine(v => v.next === v.confirm, { message: 'Les mots de passe ne correspondent pas', path: ['confirm'] })
```

`server/lib/auth.ts` :

```ts
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { MIN_PASSWORD_LENGTH } from '#shared/auth'
import { getDb, type Db } from './db'
import { AppError } from './errors'

export const SESSION_COOKIE = 'sortarr_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const ROUNDS = 10

// Comparé quand le compte n'existe pas : même durée qu'un mauvais mot de passe.
let dummyHash: string | null = null
function getDummyHash(): string {
  dummyHash ??= bcrypt.hashSync('sortarr-dummy-password', ROUNDS)
  return dummyHash
}

function checkPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new AppError(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`)
}

export function hasAdmin(db: Db = getDb()): boolean {
  return db.prepare('SELECT 1 FROM users WHERE id = 1').get() !== undefined
}

export async function createAdmin(username: string, password: string, db: Db = getDb()): Promise<void> {
  if (hasAdmin(db)) throw new AppError('Le compte admin existe déjà.', 409)
  const name = username.trim()
  if (!name) throw new AppError("Nom d'utilisateur obligatoire.")
  checkPassword(password)
  const hash = await bcrypt.hash(password, ROUNDS)
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)').run(name, hash, Date.now())
}

export async function verifyCredentials(username: string, password: string, db: Db = getDb()): Promise<boolean> {
  const row = db.prepare('SELECT username, password_hash FROM users WHERE id = 1').get() as { username: string; password_hash: string } | undefined
  const ok = await bcrypt.compare(password, row?.password_hash ?? getDummyHash())
  return ok && row !== undefined && row.username === username.trim()
}

export function createSession(db: Db = getDb(), now = Date.now()): string {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
  const id = crypto.randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (id, expires_at, created_at) VALUES (?, ?, ?)').run(id, now + SESSION_TTL_MS, now)
  return id
}

export function isValidSession(id: string | undefined, db: Db = getDb(), now = Date.now()): boolean {
  if (!id) return false
  const row = db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(id) as { expires_at: number } | undefined
  return row !== undefined && row.expires_at > now
}

export function deleteSession(id: string | undefined, db: Db = getDb()): void {
  if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

/** Change le mot de passe et ferme toutes les sessions ouvertes. */
export async function changePassword(current: string, next: string, db: Db = getDb()): Promise<void> {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = 1').get() as { password_hash: string } | undefined
  if (!row || !(await bcrypt.compare(current, row.password_hash))) throw new AppError('Mot de passe actuel incorrect.', 403)
  checkPassword(next)
  const hash = await bcrypt.hash(next, ROUNDS)
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = 1').run(hash)
    db.prepare('DELETE FROM sessions').run()
  })()
}
```

- [ ] **Step 4: Lancer les tests unitaires**

Run: `npx vitest run tests/unit/auth.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Implémenter les helpers HTTP, le middleware et les routes**

`server/lib/api.ts` (l'import de `HttpError` est ajouté à la tâche 5 ; écrire le fichier ainsi pour l'instant) :

```ts
import { createError, defineEventHandler, getRouterParam, type EventHandlerRequest, type H3Event } from 'h3'
import type { ZodType } from 'zod'
import { AppError } from './errors'

/** Route API : les AppError deviennent des erreurs HTTP avec un message lisible. */
export function defineApiHandler<T>(fn: (event: H3Event<EventHandlerRequest>) => T | Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await fn(event)
    } catch (error) {
      throw toHttpError(error)
    }
  })
}

export function toHttpError(error: unknown): unknown {
  if (error instanceof AppError) {
    return createError({ statusCode: error.statusCode, statusMessage: 'Error', message: error.message, data: { details: error.details } })
  }
  return error
}

export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const details = result.error.issues.map(i => (i.path.length ? `${i.path.join('.')} : ${i.message}` : i.message))
    throw new AppError('Données invalides.', 400, details)
  }
  return result.data
}

export function parseId(event: H3Event): number {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Identifiant invalide.')
  return id
}
```

`server/lib/sessionCookie.ts` :

```ts
import { deleteCookie, getCookie, setCookie, type H3Event } from 'h3'
import { SESSION_COOKIE, SESSION_TTL_MS } from './auth'

// Secure seulement si COOKIE_SECURE=true : sur http://192.168.x.x, un cookie Secure serait ignoré.
export function setSessionCookie(event: H3Event, id: string): void {
  setCookie(event, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

export function readSessionId(event: H3Event): string | undefined {
  return getCookie(event, SESSION_COOKIE)
}
```

`server/middleware/auth.ts` :

```ts
import { createError, defineEventHandler, getHeader, getRequestURL } from 'h3'
import { isValidSession } from '../lib/auth'
import { readSessionId } from '../lib/sessionCookie'

const PUBLIC = new Set(['/api/health', '/api/auth/status', '/api/auth/login', '/api/auth/setup'])
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname.replace(/\/+$/, '')
  if (!path.startsWith('/api/')) return
  // Un formulaire d'un autre site ne peut pas ajouter d'en-tête personnalisé : protection CSRF.
  if (MUTATING.has(event.method) && getHeader(event, 'x-sortarr') !== '1') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden', message: 'En-tête x-sortarr manquant.' })
  }
  if (PUBLIC.has(path)) return
  if (!isValidSession(readSessionId(event))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized', message: 'Connexion requise.' })
  }
})
```

`server/api/health.get.ts` :

```ts
export default defineEventHandler(() => ({ ok: true }))
```

`server/api/auth/status.get.ts` :

```ts
import { defineApiHandler } from '~~/server/lib/api'
import { hasAdmin, isValidSession } from '~~/server/lib/auth'
import { readSessionId } from '~~/server/lib/sessionCookie'

export default defineApiHandler(event => ({
  hasAdmin: hasAdmin(),
  authenticated: isValidSession(readSessionId(event)),
}))
```

`server/api/auth/setup.post.ts` :

```ts
import { setupSchema } from '#shared/auth'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { createAdmin, createSession } from '~~/server/lib/auth'
import { setSessionCookie } from '~~/server/lib/sessionCookie'

export default defineApiHandler(async (event) => {
  const input = parseOrThrow(setupSchema, await readBody(event))
  await createAdmin(input.username, input.password)
  setSessionCookie(event, createSession())
  return { ok: true }
})
```

`server/api/auth/login.post.ts` :

```ts
import { loginSchema } from '#shared/auth'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { createSession, hasAdmin, verifyCredentials } from '~~/server/lib/auth'
import { AppError } from '~~/server/lib/errors'
import { setSessionCookie } from '~~/server/lib/sessionCookie'

export default defineApiHandler(async (event) => {
  const input = parseOrThrow(loginSchema, await readBody(event))
  if (!hasAdmin()) throw new AppError("Aucun compte n'existe encore.", 409)
  if (!(await verifyCredentials(input.username, input.password))) throw new AppError('Identifiants incorrects.', 401)
  setSessionCookie(event, createSession())
  return { ok: true }
})
```

`server/api/auth/logout.post.ts` :

```ts
import { defineApiHandler } from '~~/server/lib/api'
import { deleteSession } from '~~/server/lib/auth'
import { clearSessionCookie, readSessionId } from '~~/server/lib/sessionCookie'

export default defineApiHandler((event) => {
  deleteSession(readSessionId(event))
  clearSessionCookie(event)
  return { ok: true }
})
```

`server/api/auth/password.post.ts` :

```ts
import { passwordChangeSchema } from '#shared/auth'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { changePassword, createSession } from '~~/server/lib/auth'
import { setSessionCookie } from '~~/server/lib/sessionCookie'

export default defineApiHandler(async (event) => {
  const input = parseOrThrow(passwordChangeSchema, await readBody(event))
  await changePassword(input.current, input.next)
  setSessionCookie(event, createSession())
  return { ok: true }
})
```

- [ ] **Step 6: Écrire le test de bout en bout**

`tests/e2e/api.test.ts` (complété aux tâches 10 et 15) :

```ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fetch, setup } from '@nuxt/test-utils/e2e'

process.env.SORTARR_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sortarr-e2e-'))
process.env.SORTARR_DISABLE_SCHEDULER = '1'

export function post(body: unknown, cookie?: string, method = 'POST'): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', 'x-sortarr': '1', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }
}

describe('API', async () => {
  await setup({ server: true, browser: false })
  let cookie = ''

  it('répond au healthcheck sans session', async () => {
    const res = await fetch('/api/health')
    expect(await res.json()).toEqual({ ok: true })
  })

  it('refuse les routes protégées sans session', async () => {
    expect((await fetch('/api/instances')).status).toBe(401)
  })

  it('refuse une écriture sans en-tête x-sortarr', async () => {
    const res = await fetch('/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'motdepasse1', confirm: 'motdepasse1' }) })
    expect(res.status).toBe(403)
  })

  it('crée le compte admin et ouvre une session', async () => {
    const res = await fetch('/api/auth/setup', post({ username: 'admin', password: 'motdepasse1', confirm: 'motdepasse1' }))
    expect(res.status).toBe(200)
    cookie = res.headers.get('set-cookie')!.split(';')[0]!
    const status = await (await fetch('/api/auth/status', { headers: { cookie } })).json()
    expect(status).toEqual({ hasAdmin: true, authenticated: true })
  })

  it('refuse un second compte', async () => {
    const res = await fetch('/api/auth/setup', post({ username: 'b', password: 'motdepasse2', confirm: 'motdepasse2' }))
    expect(res.status).toBe(409)
  })

  it('refuse un mauvais mot de passe avec un message en français', async () => {
    const res = await fetch('/api/auth/login', post({ username: 'admin', password: 'mauvais' }))
    expect(res.status).toBe(401)
    expect((await res.json()).message).toBe('Identifiants incorrects.')
  })
})
```

> La route `/api/instances` n'existe pas encore : sans session, le middleware répond 401 avant le routage, le test passe déjà.

- [ ] **Step 7: Lancer tous les tests**

Run: `npx vitest run`
Expected: PASS. Le fichier e2e construit l'app (30 à 90 s la première fois).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: compte admin, sessions et protection des routes API"
```

---

### Task 5: Client HTTP avec délai et nouvelles tentatives, et mapLimit

**Files:**
- Create: `server/lib/http.ts`, `server/lib/concurrency.ts`, `tests/helpers/fetch.ts`
- Modify: `server/lib/api.ts` (convertir `HttpError` en 502)
- Test: `tests/unit/http.test.ts`

**Interfaces:**
- Produces:
  - `class HttpError extends Error { status: number | null; url: string }`.
  - `httpJson<T>(url: string, opts?: HttpOptions): Promise<T>` avec `HttpOptions = { method?, headers?, body?, timeoutMs? (15000), attempts? (3), retryDelayMs? (500) }`. Délai entre tentatives : `retryDelayMs × 2^(n-1)`. La query string n'apparaît jamais dans les messages d'erreur.
  - `mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>` (ordre conservé).
  - Helper de test `mockFetch(routes)` : `routes` associe `pathname` ou `pathname+search` à un corps JSON, une `Response` ou une fonction `(url: URL, init?: RequestInit) => unknown` ; renvoie `{ fn, calls }`.

- [ ] **Step 1: Écrire le helper et le test qui échoue**

`tests/helpers/fetch.ts` :

```ts
import { vi } from 'vitest'

type Handler = unknown | ((url: URL, init?: RequestInit) => unknown)

/** Remplace fetch : chaque route renvoie du JSON (ou une Response). Route absente → 404. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: { url: URL; init?: RequestInit }[] = []
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, init })
    const handler = routes[url.pathname + url.search] ?? routes[url.pathname]
    if (handler === undefined) return new Response('not found', { status: 404 })
    const body = typeof handler === 'function' ? (handler as (u: URL, i?: RequestInit) => unknown)(url, init) : handler
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls }
}

export function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const headers = (init?.headers ?? {}) as Record<string, string>
  const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : undefined
}
```

`tests/unit/http.test.ts` :

```ts
import { describe, expect, it, vi } from 'vitest'
import { HttpError, httpJson } from '../../server/lib/http'
import { mapLimit } from '../../server/lib/concurrency'
import { mockFetch } from '../helpers/fetch'

const fast = { retryDelayMs: 1 }

describe('httpJson', () => {
  it('renvoie le JSON décodé', async () => {
    mockFetch({ '/ok': { a: 1 } })
    expect(await httpJson('http://svc/ok', fast)).toEqual({ a: 1 })
  })

  it('réessaie sur 503 puis réussit', async () => {
    let n = 0
    const { fn } = mockFetch({ '/flaky': () => (++n === 1 ? new Response('busy', { status: 503 }) : { ok: true }) })
    expect(await httpJson('http://svc/flaky', fast)).toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('ne réessaie pas sur 404', async () => {
    const { fn } = mockFetch({})
    await expect(httpJson('http://svc/absent', fast)).rejects.toMatchObject({ status: 404 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('explique un 401', async () => {
    mockFetch({ '/secure': new Response('no', { status: 401 }) })
    await expect(httpJson('http://svc/secure', fast)).rejects.toThrow('Accès refusé (HTTP 401) : vérifie la clé API.')
  })

  it("fait 3 tentatives sur erreur réseau puis échoue", async () => {
    const fn = vi.fn(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) })
    vi.stubGlobal('fetch', fn)
    const error = await httpJson('http://svc/down', fast).catch(e => e)
    expect(error).toBeInstanceOf(HttpError)
    expect(error.message).toContain('Service injoignable (ECONNREFUSED)')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("n'écrit jamais la query string dans l'erreur", async () => {
    mockFetch({})
    const error = await httpJson('http://svc/x?X-Plex-Token=secret123', fast).catch(e => e)
    expect(error.message).not.toContain('secret123')
  })

  it('envoie le corps en JSON', async () => {
    const { calls } = mockFetch({ '/post': { done: true } })
    await httpJson('http://svc/post', { ...fast, method: 'POST', body: { x: 1 } })
    expect(calls[0]!.init!.body).toBe('{"x":1}')
  })
})

describe('mapLimit', () => {
  it('respecte la limite et conserve l\'ordre', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50, 60])
    expect(peak).toBe(2)
  })

  it('accepte une liste vide', async () => {
    expect(await mapLimit([], 4, async x => x)).toEqual([])
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/http.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

`server/lib/http.ts` :

```ts
export class HttpError extends Error {
  constructor(message: string, public readonly status: number | null, public readonly url: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export interface HttpOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  attempts?: number
  retryDelayMs?: number
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** URL sans query string : les jetons ne finissent jamais dans un message ou un journal. */
function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    u.search = ''
    return u.toString()
  } catch {
    return url.split('?')[0]!
  }
}

function networkReason(error: unknown, timeoutMs: number): string {
  const e = error as { name?: string; message?: string; cause?: { code?: string } }
  if (e?.name === 'TimeoutError') return `délai de ${timeoutMs / 1000} s dépassé`
  return e?.cause?.code ?? e?.message ?? 'erreur réseau'
}

export async function httpJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3
  const delay = opts.retryDelayMs ?? 500
  const timeoutMs = opts.timeoutMs ?? 15_000
  const shown = displayUrl(url)
  let lastError: HttpError | null = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const canRetry = attempt < attempts
    let res: Response
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      lastError = new HttpError(`Service injoignable (${networkReason(error, timeoutMs)}) : ${shown}`, null, shown)
      if (canRetry) { await sleep(delay * 2 ** (attempt - 1)); continue }
      throw lastError
    }

    if (res.ok) {
      const text = res.status === 204 ? '' : await res.text()
      if (!text) return undefined as T
      try {
        return JSON.parse(text) as T
      } catch {
        throw new HttpError(`Réponse non JSON : ${shown}`, res.status, shown)
      }
    }

    const snippet = (await res.text().catch(() => '')).slice(0, 200).trim()
    const message = res.status === 401 || res.status === 403
      ? `Accès refusé (HTTP ${res.status}) : vérifie la clé API.`
      : `HTTP ${res.status} sur ${shown}${snippet ? ` : ${snippet}` : ''}`
    lastError = new HttpError(message, res.status, shown)
    if (res.status >= 500 && canRetry) { await sleep(delay * 2 ** (attempt - 1)); continue }
    throw lastError
  }
  throw lastError ?? new HttpError(`Échec de la requête : ${shown}`, null, shown)
}
```

`server/lib/concurrency.ts` :

```ts
/** Comme Promise.all(items.map(fn)) mais avec au plus `limit` appels en parallèle. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++
      out[index] = await fn(items[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
```

Dans `server/lib/api.ts`, ajouter l'import et la branche `HttpError` dans `toHttpError` :

```ts
import { HttpError } from './http'
```

```ts
export function toHttpError(error: unknown): unknown {
  if (error instanceof AppError) {
    return createError({ statusCode: error.statusCode, statusMessage: 'Error', message: error.message, data: { details: error.details } })
  }
  if (error instanceof HttpError) {
    return createError({ statusCode: 502, statusMessage: 'Bad Gateway', message: error.message, data: { details: [] } })
  }
  return error
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run tests/unit/http.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib tests
git commit -m "feat: client HTTP avec délai et nouvelles tentatives"
```

---

### Task 6: Normalisation des infos médias (langues, résolution, codec, durée)

**Files:**
- Create: `shared/media.ts`, `shared/format.ts`
- Test: `tests/unit/media.test.ts`

**Interfaces:**
- Produces (`shared/media.ts`) :
  - `normalizeLanguage(raw: unknown): string | null` — code ISO 639-1 (`'en'`, `'fr'`…) à partir d'un nom anglais/français ou d'un code 639-1/639-2 ; valeur inconnue renvoyée en minuscules ; `null` pour vide/`und`/`unknown`.
  - `parseLanguageList(raw: unknown): string[]` — accepte `"eng/fre"`, `"English / French"`, `"en, fr"` ou un tableau ; dédoublonne.
  - `RESOLUTIONS = [480, 720, 1080, 2160] as const`, `normalizeResolution(raw: unknown): number | null` — nombre = hauteur, `"1920x800"` = d'après la largeur, `"1080p"`, `"4K"`.
  - `normalizeCodec(raw: unknown): string | null` — `hevc`, `h264`, `av1`, `vc1`, `mpeg2`, `mpeg4` ou valeur brute en minuscules.
  - `parseRuntime(raw: unknown): number | null` — `"1:58:00"` / `"58:00"` → secondes.
  - `languageLabel(code: string): string`, `resolutionLabel(r: number | null): string`.
- Produces (`shared/format.ts`) : `formatSize(gb: number): string`, `formatDate(ts: number | null): string`, `formatDateTime(ts: number | null): string` (fr-FR, `'—'` si null).

- [ ] **Step 1: Écrire le test qui échoue**

`tests/unit/media.test.ts` :

```ts
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
  })

  it('affiche un tiret pour une date absente', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(Date.UTC(2026, 9, 24, 12))).toBe('24/10/2026')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/media.test.ts`
Expected: FAIL — `Failed to resolve import "#shared/media"`.

- [ ] **Step 3: Implémenter `shared/media.ts`**

```ts
const LANGUAGE_CODES: Record<string, string> = {
  en: 'en', eng: 'en', english: 'en', anglais: 'en',
  fr: 'fr', fre: 'fr', fra: 'fr', french: 'fr', francais: 'fr',
  ja: 'ja', jpn: 'ja', japanese: 'ja', japonais: 'ja',
  de: 'de', ger: 'de', deu: 'de', german: 'de', allemand: 'de',
  es: 'es', spa: 'es', spanish: 'es', espagnol: 'es',
  it: 'it', ita: 'it', italian: 'it', italien: 'it',
  ko: 'ko', kor: 'ko', korean: 'ko', coreen: 'ko',
  zh: 'zh', chi: 'zh', zho: 'zh', chinese: 'zh', mandarin: 'zh', cantonese: 'zh', chinois: 'zh',
  pt: 'pt', por: 'pt', portuguese: 'pt', 'portuguese (brazil)': 'pt', portugais: 'pt',
  ru: 'ru', rus: 'ru', russian: 'ru', russe: 'ru',
  nl: 'nl', dut: 'nl', nld: 'nl', dutch: 'nl', flemish: 'nl', neerlandais: 'nl',
  sv: 'sv', swe: 'sv', swedish: 'sv',
  no: 'no', nor: 'no', nob: 'no', norwegian: 'no',
  da: 'da', dan: 'da', danish: 'da',
  fi: 'fi', fin: 'fi', finnish: 'fi',
  pl: 'pl', pol: 'pl', polish: 'pl',
  tr: 'tr', tur: 'tr', turkish: 'tr',
  ar: 'ar', ara: 'ar', arabic: 'ar',
  hi: 'hi', hin: 'hi', hindi: 'hi',
  th: 'th', tha: 'th', thai: 'th',
  he: 'he', heb: 'he', hebrew: 'he',
  cs: 'cs', cze: 'cs', ces: 'cs', czech: 'cs',
  hu: 'hu', hun: 'hu', hungarian: 'hu',
  uk: 'uk', ukr: 'uk', ukrainian: 'uk',
  vi: 'vi', vie: 'vi', vietnamese: 'vi',
  id: 'id', ind: 'id', indonesian: 'id',
  el: 'el', gre: 'el', ell: 'el', greek: 'el',
  ro: 'ro', rum: 'ro', ron: 'ro', romanian: 'ro',
  ta: 'ta', tam: 'ta', tamil: 'ta',
  te: 'te', tel: 'te', telugu: 'te',
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'Anglais', fr: 'Français', ja: 'Japonais', de: 'Allemand', es: 'Espagnol', it: 'Italien', ko: 'Coréen',
  zh: 'Chinois', pt: 'Portugais', ru: 'Russe', nl: 'Néerlandais', sv: 'Suédois', no: 'Norvégien', da: 'Danois',
  fi: 'Finnois', pl: 'Polonais', tr: 'Turc', ar: 'Arabe', hi: 'Hindi', th: 'Thaï', he: 'Hébreu', cs: 'Tchèque',
  hu: 'Hongrois', uk: 'Ukrainien', vi: 'Vietnamien', id: 'Indonésien', el: 'Grec', ro: 'Roumain', ta: 'Tamoul', te: 'Télougou',
}

const UNKNOWN_LANGUAGES = new Set(['', 'und', 'unknown', 'any', 'original', 'mul', 'zxx', 'n/a'])

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export function normalizeLanguage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const key = fold(raw)
  if (UNKNOWN_LANGUAGES.has(key)) return null
  return LANGUAGE_CODES[key] ?? key
}

export function parseLanguageList(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\s*[/,|]\s*/) : []
  const codes = parts.map(normalizeLanguage).filter((c): c is string => c !== null)
  return [...new Set(codes)]
}

export function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code
}

export const RESOLUTIONS = [480, 720, 1080, 2160] as const

function fromHeight(h: number): number | null {
  if (!(h > 0)) return null
  return h >= 1600 ? 2160 : h >= 900 ? 1080 : h >= 600 ? 720 : 480
}

// D'après la largeur : un film en 2.39:1 encodé en 1920x800 est bien du 1080p.
function fromWidth(w: number): number | null {
  if (!(w > 0)) return null
  return w >= 3200 ? 2160 : w >= 1700 ? 1080 : w >= 1100 ? 720 : 480
}

export function normalizeResolution(raw: unknown): number | null {
  if (typeof raw === 'number') return fromHeight(raw)
  if (typeof raw !== 'string') return null
  const size = raw.match(/^\s*(\d+)\s*x\s*(\d+)\s*$/i)
  if (size) return fromWidth(Number(size[1]))
  const p = raw.match(/(\d{3,4})\s*[pi]\b/i)
  if (p) return fromHeight(Number(p[1]))
  if (/\b(4k|uhd)\b/i.test(raw)) return 2160
  return null
}

export function resolutionLabel(resolution: number | null): string {
  if (resolution === null) return '—'
  return resolution === 2160 ? '4K' : `${resolution}p`
}

export function normalizeCodec(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const v = raw.toLowerCase()
  if (/265|hevc/.test(v)) return 'hevc'
  if (/264|avc/.test(v)) return 'h264'
  if (/av1/.test(v)) return 'av1'
  if (/vc-?1/.test(v)) return 'vc1'
  if (/mpeg-?2/.test(v)) return 'mpeg2'
  if (/xvid|divx|mpeg-?4/.test(v)) return 'mpeg4'
  return v.trim()
}

export function parseRuntime(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.\d+)?$/)
  if (!m) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])
}
```

`shared/format.ts` :

```ts
export function formatSize(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} To`
  return `${gb.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`
}

export function formatDate(ts: number | null): string {
  if (ts === null) return '—'
  return new Date(ts).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })
}

export function formatDateTime(ts: number | null): string {
  if (ts === null) return '—'
  return new Date(ts).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' })
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run tests/unit/media.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared tests/unit/media.test.ts
git commit -m "feat: normalisation des langues, résolutions et codecs"
```

---

### Task 7: Connecteur Radarr / Sonarr

**Files:**
- Create: `server/lib/sync/types.ts`, `server/connectors/arr.ts`
- Test: `tests/unit/connectors/arr.test.ts`

**Interfaces:**
- Consumes: `httpJson`, `normalizeLanguage`, `parseLanguageList`, `normalizeResolution`, `normalizeCodec`, `parseRuntime`.
- Produces (`server/lib/sync/types.ts`) :

```ts
export type MediaType = 'movie' | 'series'
export interface FileRecord { externalId: number; season: number | null; episode: number | null; servicePath: string; size: number; resolution: number | null; videoCodec: string | null; audioLanguages: string[]; subtitleLanguages: string[]; isRemux: boolean; runtimeSeconds: number | null }
export interface ArrItemRecord { externalId: number; type: MediaType; title: string; year: number | null; tmdbId: number | null; tvdbId: number | null; imdbId: string | null; originalLanguage: string | null; genres: string[]; ratingTmdb: number | null; ratingImdb: number | null; addedAt: number | null; servicePath: string; rootFolder: string | null; monitored: boolean; hasFile: boolean; size: number; tags: string[]; files: FileRecord[] }
export interface ServerItemRecord { externalId: string; type: MediaType; title: string; year: number | null; tmdbId: number | null; tvdbId: number | null; imdbId: string | null; servicePaths: string[]; library: string }
export interface HistoryRecord { externalId: string; user: string; lastWatchedAt: number | null; playCount: number }
```

- Produces (`server/connectors/arr.ts`) : `ArrConn = { url; apiKey }`, `arrStatus`, `arrRootFolders`, `arrQualityProfiles`, `arrTags` (→ `Map<number, string>`), `radarrMovies`, `sonarrSeries`, `sonarrEpisodes(c, seriesId)`, `sonarrEpisodeFiles(c, seriesId)`, mappers purs `mapArrFile`, `mapRadarrMovie(movie, tags)`, `mapSonarrSeries(series, episodes, files, tags)`, types `RadarrMovie`, `SonarrSeries`, `SonarrEpisode`, `ArrFile`. Tous les appels passent l'en-tête `X-Api-Key`.

- [ ] **Step 1: Écrire le test qui échoue**

`tests/unit/connectors/arr.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { arrStatus, arrTags, mapRadarrMovie, mapSonarrSeries, type RadarrMovie, type SonarrEpisode, type SonarrSeries, type ArrFile } from '../../../server/connectors/arr'
import { headerOf, mockFetch } from '../../helpers/fetch'

const tags = new Map([[1, 'kids'], [2, '4k']])

const movie: RadarrMovie = {
  id: 7, title: 'Dune', year: 2021, tmdbId: 438631, imdbId: 'tt1160419',
  originalLanguage: { name: 'English' }, genres: ['Science Fiction'],
  ratings: { imdb: { value: 8 }, tmdb: { value: 7.8 } },
  added: '2024-01-05T10:00:00Z', path: '/movies/Dune (2021)', rootFolderPath: '/movies/',
  monitored: true, hasFile: true, sizeOnDisk: 9_000_000_000, tags: [2],
  movieFile: {
    id: 70, path: '/movies/Dune (2021)/Dune.mkv', size: 9_000_000_000,
    quality: { quality: { name: 'Bluray-1080p Remux', resolution: 1080, modifier: 'remux' } },
    mediaInfo: { audioLanguages: 'eng/fre', subtitles: 'French / English', videoCodec: 'x265', resolution: '1920x800', runTime: '2:35:00' },
  },
}

describe('mapRadarrMovie', () => {
  it('normalise un film', () => {
    expect(mapRadarrMovie(movie, tags)).toEqual({
      externalId: 7, type: 'movie', title: 'Dune', year: 2021, tmdbId: 438631, tvdbId: null, imdbId: 'tt1160419',
      originalLanguage: 'en', genres: ['Science Fiction'], ratingTmdb: 7.8, ratingImdb: 8,
      addedAt: Date.parse('2024-01-05T10:00:00Z'), servicePath: '/movies/Dune (2021)', rootFolder: '/movies',
      monitored: true, hasFile: true, size: 9_000_000_000, tags: ['4k'],
      files: [{
        externalId: 70, season: null, episode: null, servicePath: '/movies/Dune (2021)/Dune.mkv', size: 9_000_000_000,
        resolution: 1080, videoCodec: 'hevc', audioLanguages: ['en', 'fr'], subtitleLanguages: ['fr', 'en'],
        isRemux: true, runtimeSeconds: 9300,
      }],
    })
  })

  it('gère un film sans fichier ni métadonnées', () => {
    const r = mapRadarrMovie({ id: 1, title: 'X', path: '/movies/X', monitored: false, hasFile: false, year: 0, added: '0001-01-01T00:00:00Z' }, tags)
    expect(r).toMatchObject({ year: null, addedAt: null, originalLanguage: null, files: [], size: 0, rootFolder: null })
  })

  it('reconstruit le chemin du fichier depuis relativePath', () => {
    const r = mapRadarrMovie({ ...movie, movieFile: { id: 1, relativePath: 'Dune.mkv', size: 1 } }, tags)
    expect(r.files[0]!.servicePath).toBe('/movies/Dune (2021)/Dune.mkv')
  })
})

describe('mapSonarrSeries', () => {
  const series: SonarrSeries = {
    id: 3, title: 'The Expanse', year: 2015, tvdbId: 280619, tmdbId: 63639, imdbId: 'tt3230854',
    originalLanguage: { name: 'English' }, genres: ['Drama'], added: '2023-02-01T00:00:00Z',
    path: '/series/The Expanse', rootFolderPath: '/series', monitored: true, tags: [1],
    statistics: { episodeFileCount: 2, sizeOnDisk: 3000 },
  }
  const episodes: SonarrEpisode[] = [
    { id: 1, seasonNumber: 1, episodeNumber: 1, hasFile: true, episodeFileId: 11 },
    { id: 2, seasonNumber: 1, episodeNumber: 2, hasFile: true, episodeFileId: 12 },
    { id: 3, seasonNumber: 1, episodeNumber: 3, hasFile: true, episodeFileId: 12 },
    { id: 4, seasonNumber: 1, episodeNumber: 4, hasFile: false },
  ]
  const files: ArrFile[] = [
    { id: 11, path: '/series/The Expanse/S01/e1.mkv', size: 1000, quality: { quality: { resolution: 720 } }, mediaInfo: { audioLanguages: 'English' } },
    { id: 12, path: '/series/The Expanse/S01/e2-e3.mkv', size: 2000, quality: { quality: { resolution: 1080 } }, mediaInfo: { audioLanguages: 'English/French' } },
  ]

  it('normalise une série et ses fichiers (un fichier multi-épisodes compte une fois)', () => {
    const r = mapSonarrSeries(series, episodes, files, tags)
    expect(r).toMatchObject({ type: 'series', tvdbId: 280619, tmdbId: 63639, hasFile: true, size: 3000, tags: ['kids'], ratingTmdb: null })
    expect(r.files).toHaveLength(2)
    expect(r.files[1]).toMatchObject({ externalId: 12, season: 1, episode: 2, resolution: 1080, audioLanguages: ['en', 'fr'] })
  })

  it('a hasFile faux sans fichier', () => {
    expect(mapSonarrSeries({ ...series, statistics: { episodeFileCount: 0 } }, [], [], tags).hasFile).toBe(false)
  })
})

describe('appels API', () => {
  it('envoie X-Api-Key sur /api/v3', async () => {
    const { calls } = mockFetch({ '/api/v3/system/status': { appName: 'Radarr', version: '6.4.4' } })
    expect(await arrStatus({ url: 'http://radarr:7878/', apiKey: 'k1' })).toEqual({ appName: 'Radarr', version: '6.4.4' })
    expect(calls[0]!.url.toString()).toBe('http://radarr:7878/api/v3/system/status')
    expect(headerOf(calls[0]!.init, 'X-Api-Key')).toBe('k1')
  })

  it('transforme les tags en dictionnaire', async () => {
    mockFetch({ '/api/v3/tag': [{ id: 1, label: 'kids' }] })
    expect(await arrTags({ url: 'http://r', apiKey: 'k' })).toEqual(new Map([[1, 'kids']]))
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/connectors/arr.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `server/lib/sync/types.ts`**

Écrire exactement le bloc de types donné dans **Interfaces** ci-dessus, chaque interface exportée.

- [ ] **Step 4: Implémenter `server/connectors/arr.ts`**

```ts
import path from 'node:path'
import { normalizeCodec, normalizeLanguage, normalizeResolution, parseLanguageList, parseRuntime } from '#shared/media'
import { httpJson } from '../lib/http'
import type { ArrItemRecord, FileRecord } from '../lib/sync/types'

const posix = path.posix

export interface ArrConn { url: string; apiKey: string }

interface Quality { quality?: { name?: string; resolution?: number; modifier?: string } }
interface MediaInfo { audioLanguages?: string; subtitles?: string; videoCodec?: string; resolution?: string; runTime?: string }
export interface ArrFile { id: number; path?: string; relativePath?: string; size?: number; seasonNumber?: number; quality?: Quality; mediaInfo?: MediaInfo }
interface Ratings { imdb?: { value?: number }; tmdb?: { value?: number } }

export interface RadarrMovie {
  id: number; title: string; year?: number; tmdbId?: number; imdbId?: string
  originalLanguage?: { name?: string }; genres?: string[]; ratings?: Ratings; added?: string
  path: string; rootFolderPath?: string; monitored: boolean; hasFile: boolean; sizeOnDisk?: number; tags?: number[]
  movieFile?: ArrFile
}

export interface SonarrSeries {
  id: number; title: string; year?: number; tvdbId?: number; tmdbId?: number; imdbId?: string
  originalLanguage?: { name?: string }; genres?: string[]; added?: string
  path: string; rootFolderPath?: string; monitored: boolean; tags?: number[]
  statistics?: { episodeFileCount?: number; sizeOnDisk?: number }
}

export interface SonarrEpisode { id: number; seasonNumber: number; episodeNumber: number; hasFile: boolean; episodeFileId?: number }

function arr<T>(c: ArrConn, route: string): Promise<T> {
  return httpJson<T>(`${c.url.replace(/\/+$/, '')}/api/v3${route}`, { headers: { 'X-Api-Key': c.apiKey } })
}

export const arrStatus = (c: ArrConn) => arr<{ appName: string; version: string }>(c, '/system/status')
export const arrRootFolders = (c: ArrConn) => arr<{ path: string; freeSpace?: number }[]>(c, '/rootfolder')
export const arrQualityProfiles = (c: ArrConn) => arr<{ id: number; name: string }[]>(c, '/qualityprofile')
export const radarrMovies = (c: ArrConn) => arr<RadarrMovie[]>(c, '/movie')
export const sonarrSeries = (c: ArrConn) => arr<SonarrSeries[]>(c, '/series')
export const sonarrEpisodes = (c: ArrConn, seriesId: number) => arr<SonarrEpisode[]>(c, `/episode?seriesId=${seriesId}`)
export const sonarrEpisodeFiles = (c: ArrConn, seriesId: number) => arr<ArrFile[]>(c, `/episodefile?seriesId=${seriesId}`)

export async function arrTags(c: ArrConn): Promise<Map<number, string>> {
  const list = await arr<{ id: number; label: string }[]>(c, '/tag')
  return new Map(list.map(t => [t.id, t.label]))
}

/** Date ISO → ms ; les dates « 0001-01-01 » des *arr deviennent null. */
function parseDate(value?: string): number | null {
  if (!value) return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) && ts > 0 ? ts : null
}

const orNull = <T>(value: T | undefined | null): T | null => (value ? value : null)
const trimDir = (p?: string) => (p ? p.replace(/\/+$/, '') || '/' : null)
const tagLabels = (ids: number[] | undefined, tags: Map<number, string>) => (ids ?? []).map(id => tags.get(id)).filter((t): t is string => !!t)

export function mapArrFile(file: ArrFile, folder: string, season: number | null, episode: number | null): FileRecord {
  const info = file.mediaInfo ?? {}
  const quality = file.quality?.quality ?? {}
  return {
    externalId: file.id,
    season,
    episode,
    servicePath: file.path ?? posix.join(folder, file.relativePath ?? ''),
    size: file.size ?? 0,
    resolution: normalizeResolution(quality.resolution || null) ?? normalizeResolution(info.resolution ?? null),
    videoCodec: normalizeCodec(info.videoCodec),
    audioLanguages: parseLanguageList(info.audioLanguages),
    subtitleLanguages: parseLanguageList(info.subtitles),
    isRemux: quality.modifier === 'remux' || /remux/i.test(quality.name ?? ''),
    runtimeSeconds: parseRuntime(info.runTime),
  }
}

export function mapRadarrMovie(m: RadarrMovie, tags: Map<number, string>): ArrItemRecord {
  return {
    externalId: m.id,
    type: 'movie',
    title: m.title,
    year: orNull(m.year),
    tmdbId: orNull(m.tmdbId),
    tvdbId: null,
    imdbId: orNull(m.imdbId),
    originalLanguage: normalizeLanguage(m.originalLanguage?.name),
    genres: m.genres ?? [],
    ratingTmdb: orNull(m.ratings?.tmdb?.value),
    ratingImdb: orNull(m.ratings?.imdb?.value),
    addedAt: parseDate(m.added),
    servicePath: m.path,
    rootFolder: trimDir(m.rootFolderPath),
    monitored: m.monitored,
    hasFile: m.hasFile,
    size: m.sizeOnDisk ?? m.movieFile?.size ?? 0,
    tags: tagLabels(m.tags, tags),
    files: m.movieFile ? [mapArrFile(m.movieFile, m.path, null, null)] : [],
  }
}

export function mapSonarrSeries(s: SonarrSeries, episodes: SonarrEpisode[], files: ArrFile[], tags: Map<number, string>): ArrItemRecord {
  // Un fichier peut contenir plusieurs épisodes : on garde le plus petit numéro.
  const firstEpisode = new Map<number, SonarrEpisode>()
  for (const e of episodes) {
    if (!e.episodeFileId) continue
    const current = firstEpisode.get(e.episodeFileId)
    if (!current || e.episodeNumber < current.episodeNumber) firstEpisode.set(e.episodeFileId, e)
  }
  return {
    externalId: s.id,
    type: 'series',
    title: s.title,
    year: orNull(s.year),
    tmdbId: orNull(s.tmdbId),
    tvdbId: orNull(s.tvdbId),
    imdbId: orNull(s.imdbId),
    originalLanguage: normalizeLanguage(s.originalLanguage?.name),
    genres: s.genres ?? [],
    ratingTmdb: null,
    ratingImdb: null,
    addedAt: parseDate(s.added),
    servicePath: s.path,
    rootFolder: trimDir(s.rootFolderPath),
    monitored: s.monitored,
    hasFile: (s.statistics?.episodeFileCount ?? 0) > 0,
    size: s.statistics?.sizeOnDisk ?? files.reduce((n, f) => n + (f.size ?? 0), 0),
    tags: tagLabels(s.tags, tags),
    files: files.map((f) => {
      const ep = firstEpisode.get(f.id)
      return mapArrFile(f, s.path, ep?.seasonNumber ?? f.seasonNumber ?? null, ep?.episodeNumber ?? null)
    }),
  }
}
```

- [ ] **Step 5: Lancer les tests**

Run: `npx vitest run tests/unit/connectors/arr.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server tests
git commit -m "feat: connecteur Radarr/Sonarr"
```

---

### Task 8: Connecteur Plex

**Files:**
- Create: `server/connectors/plex.ts`
- Test: `tests/unit/connectors/plex.test.ts`

**Interfaces:**
- Consumes: `httpJson`, `ServerItemRecord`, `HistoryRecord`.
- Produces: `PlexConn = { url; token }`, `plexIdentity(c) → { machineIdentifier, version }`, `plexSections(c) → PlexSection[]` (`{ key, title, type, locations }`), `plexSectionItems(c, key) → PlexMeta[]`, `plexMetadata(c, ratingKey) → PlexMeta | null`, `plexHistory(c, pageSize = 1000) → PlexHistoryEntry[]`, `plexAccounts(c) → Map<number, string>`, `parsePlexGuids(guids)`, `mapPlexItem(meta, library): ServerItemRecord`, `aggregatePlexHistory(entries, accounts): HistoryRecord[]`. En-têtes : `X-Plex-Token` et `Accept: application/json` (jamais de jeton dans l'URL).

- [ ] **Step 1: Écrire le test qui échoue**

`tests/unit/connectors/plex.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { aggregatePlexHistory, mapPlexItem, parsePlexGuids, plexHistory, plexSections } from '../../../server/connectors/plex'
import { headerOf, mockFetch } from '../../helpers/fetch'

const conn = { url: 'http://plex:32400', token: 'tok' }

describe('Plex', () => {
  it('lit les GUID externes', () => {
    expect(parsePlexGuids([{ id: 'imdb://tt1' }, { id: 'tmdb://42' }, { id: 'tvdb://7' }])).toEqual({ imdbId: 'tt1', tmdbId: 42, tvdbId: 7 })
    expect(parsePlexGuids(undefined)).toEqual({ imdbId: null, tmdbId: null, tvdbId: null })
  })

  it("prend le dossier d'un film à partir de ses fichiers", () => {
    const r = mapPlexItem({ ratingKey: '10', type: 'movie', title: 'Dune', year: 2021, Guid: [{ id: 'tmdb://438631' }], Media: [{ Part: [{ file: '/media/movies/Dune (2021)/Dune.mkv' }] }, { Part: [{ file: '/media/movies/Dune (2021)/Dune.4k.mkv' }] }] }, 'Movies')
    expect(r).toEqual({ externalId: '10', type: 'movie', title: 'Dune', year: 2021, tmdbId: 438631, tvdbId: null, imdbId: null, servicePaths: ['/media/movies/Dune (2021)'], library: 'Movies' })
  })

  it("prend les dossiers d'une série dans Location", () => {
    const r = mapPlexItem({ ratingKey: '20', type: 'show', title: 'X', Location: [{ path: '/media/series/X' }] }, 'Series')
    expect(r).toMatchObject({ type: 'series', servicePaths: ['/media/series/X'], year: null })
  })

  it('agrège l\'historique par titre et par compte', () => {
    const accounts = new Map([[1, 'alice']])
    const out = aggregatePlexHistory([
      { type: 'movie', ratingKey: '10', viewedAt: 100, accountID: 1 },
      { type: 'movie', ratingKey: '10', viewedAt: 300, accountID: 1 },
      { type: 'episode', ratingKey: '99', grandparentKey: '/library/metadata/20', viewedAt: 200, accountID: 2 },
    ], accounts)
    expect(out).toEqual([
      { externalId: '10', user: 'alice', lastWatchedAt: 300_000, playCount: 2 },
      { externalId: '20', user: 'compte 2', lastWatchedAt: 200_000, playCount: 1 },
    ])
  })

  it('lit les sections avec le jeton en en-tête', async () => {
    const { calls } = mockFetch({ '/library/sections': { MediaContainer: { Directory: [{ key: '1', title: 'Movies', type: 'movie', Location: [{ path: '/media/movies' }] }] } } })
    expect(await plexSections(conn)).toEqual([{ key: '1', title: 'Movies', type: 'movie', locations: ['/media/movies'] }])
    expect(headerOf(calls[0]!.init, 'X-Plex-Token')).toBe('tok')
    expect(calls[0]!.url.search).not.toContain('tok')
  })

  it("pagine l'historique", async () => {
    mockFetch({
      '/status/sessions/history/all': (url: URL) => {
        const start = Number(url.searchParams.get('X-Plex-Container-Start'))
        const size = start === 0 ? 2 : 1
        return { MediaContainer: { Metadata: Array.from({ length: size }, (_, i) => ({ type: 'movie', ratingKey: String(start + i), viewedAt: 1, accountID: 1 })) } }
      },
    })
    expect(await plexHistory(conn, 2)).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/connectors/plex.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `server/connectors/plex.ts`**

```ts
import path from 'node:path'
import { httpJson } from '../lib/http'
import type { HistoryRecord, ServerItemRecord } from '../lib/sync/types'

const posix = path.posix

export interface PlexConn { url: string; token: string }
export interface PlexSection { key: string; title: string; type: string; locations: string[] }
export interface PlexMeta {
  ratingKey: string; title: string; year?: number; type: string
  Guid?: { id: string }[]
  Media?: { Part?: { file?: string }[] }[]
  Location?: { path: string }[]
}
export interface PlexHistoryEntry { type: string; ratingKey?: string; grandparentRatingKey?: string; grandparentKey?: string; viewedAt: number; accountID: number }

function plex<T>(c: PlexConn, route: string): Promise<T> {
  return httpJson<T>(`${c.url.replace(/\/+$/, '')}${route}`, { headers: { 'X-Plex-Token': c.token, Accept: 'application/json' } })
}

export async function plexIdentity(c: PlexConn): Promise<{ machineIdentifier: string; version: string }> {
  const r = await plex<{ MediaContainer: { machineIdentifier: string; version: string } }>(c, '/identity')
  return { machineIdentifier: r.MediaContainer.machineIdentifier, version: r.MediaContainer.version }
}

export async function plexSections(c: PlexConn): Promise<PlexSection[]> {
  const r = await plex<{ MediaContainer: { Directory?: { key: string; title: string; type: string; Location?: { path: string }[] }[] } }>(c, '/library/sections')
  return (r.MediaContainer.Directory ?? []).map(d => ({ key: d.key, title: d.title, type: d.type, locations: (d.Location ?? []).map(l => l.path) }))
}

export async function plexSectionItems(c: PlexConn, key: string): Promise<PlexMeta[]> {
  const r = await plex<{ MediaContainer: { Metadata?: PlexMeta[] } }>(c, `/library/sections/${encodeURIComponent(key)}/all?includeGuids=1`)
  return r.MediaContainer.Metadata ?? []
}

export async function plexMetadata(c: PlexConn, ratingKey: string): Promise<PlexMeta | null> {
  const r = await plex<{ MediaContainer: { Metadata?: PlexMeta[] } }>(c, `/library/metadata/${encodeURIComponent(ratingKey)}`)
  return r.MediaContainer.Metadata?.[0] ?? null
}

/** Historique de tous les comptes du serveur (le jeton doit être celui de l'admin). */
export async function plexHistory(c: PlexConn, pageSize = 1000): Promise<PlexHistoryEntry[]> {
  const out: PlexHistoryEntry[] = []
  for (let page = 0; page < 500; page++) {
    const start = page * pageSize
    const r = await plex<{ MediaContainer: { Metadata?: PlexHistoryEntry[] } }>(c, `/status/sessions/history/all?sort=viewedAt:desc&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`)
    const batch = r.MediaContainer.Metadata ?? []
    out.push(...batch)
    if (batch.length < pageSize) break
  }
  return out
}

export async function plexAccounts(c: PlexConn): Promise<Map<number, string>> {
  const r = await plex<{ MediaContainer: { Account?: { id: number; name: string }[] } }>(c, '/accounts')
  return new Map((r.MediaContainer.Account ?? []).map(a => [a.id, a.name]))
}

export function parsePlexGuids(guids: { id: string }[] | undefined): { tmdbId: number | null; tvdbId: number | null; imdbId: string | null } {
  const out = { tmdbId: null as number | null, tvdbId: null as number | null, imdbId: null as string | null }
  for (const g of guids ?? []) {
    const [scheme, value] = g.id.split('://')
    if (scheme === 'tmdb') out.tmdbId = Number(value) || null
    else if (scheme === 'tvdb') out.tvdbId = Number(value) || null
    else if (scheme === 'imdb') out.imdbId = value || null
  }
  return out
}

export function mapPlexItem(meta: PlexMeta, library: string): ServerItemRecord {
  const isMovie = meta.type === 'movie'
  const paths = isMovie
    ? (meta.Media ?? []).flatMap(m => m.Part ?? []).map(p => p.file).filter((f): f is string => !!f).map(f => posix.dirname(f))
    : (meta.Location ?? []).map(l => l.path)
  return {
    externalId: String(meta.ratingKey),
    type: isMovie ? 'movie' : 'series',
    title: meta.title,
    year: meta.year ?? null,
    ...parsePlexGuids(meta.Guid),
    servicePaths: [...new Set(paths)],
    library,
  }
}

function lastSegment(key?: string): string | undefined {
  return key?.split('/').filter(Boolean).pop()
}

export function aggregatePlexHistory(entries: PlexHistoryEntry[], accounts: Map<number, string>): HistoryRecord[] {
  const byKey = new Map<string, HistoryRecord>()
  for (const e of entries) {
    const externalId = e.type === 'episode' ? (e.grandparentRatingKey ?? lastSegment(e.grandparentKey)) : e.ratingKey
    if (!externalId) continue
    const user = accounts.get(e.accountID) ?? `compte ${e.accountID}`
    const key = `${externalId}\u0000${user}`
    const viewedAt = e.viewedAt * 1000
    const current = byKey.get(key)
    if (current) {
      current.playCount++
      current.lastWatchedAt = Math.max(current.lastWatchedAt ?? 0, viewedAt)
    } else {
      byKey.set(key, { externalId: String(externalId), user, lastWatchedAt: viewedAt, playCount: 1 })
    }
  }
  return [...byKey.values()]
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run tests/unit/connectors/plex.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/connectors/plex.ts tests/unit/connectors/plex.test.ts
git commit -m "feat: connecteur Plex"
```

---

### Task 9: Connecteur Jellyfin

**Files:**
- Create: `server/connectors/jellyfin.ts`
- Test: `tests/unit/connectors/jellyfin.test.ts`

**Interfaces:**
- Consumes: `httpJson`, `ServerItemRecord`, `HistoryRecord`.
- Produces: `JellyfinConn = { url; apiKey }`, `jellyfinInfo(c) → { version, serverName }`, `jellyfinLibraries(c) → JellyfinLibrary[]` (`{ id, name, collectionType, locations }`), `jellyfinLibraryItems(c, libraryId) → JellyfinItem[]`, `jellyfinUsers(c) → { id, name }[]`, `jellyfinPlayed(c, userId) → JellyfinItem[]`, `mapJellyfinItem(item, library): ServerItemRecord`, `aggregateJellyfinPlayed(perUser: { user: string; items: JellyfinItem[] }[]): HistoryRecord[]`. En-tête : `Authorization: MediaBrowser Token="<clé>"`.

- [ ] **Step 1: Écrire le test qui échoue**

`tests/unit/connectors/jellyfin.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { aggregateJellyfinPlayed, jellyfinLibraries, mapJellyfinItem } from '../../../server/connectors/jellyfin'
import { headerOf, mockFetch } from '../../helpers/fetch'

describe('Jellyfin', () => {
  it("utilise le dossier parent du fichier d'un film", () => {
    const r = mapJellyfinItem({ Id: 'a', Name: 'Dune', ProductionYear: 2021, Type: 'Movie', ProviderIds: { Tmdb: '438631', Imdb: 'tt1160419' }, Path: '/data/movies/Dune (2021)/Dune.mkv' }, 'Movies')
    expect(r).toEqual({ externalId: 'a', type: 'movie', title: 'Dune', year: 2021, tmdbId: 438631, tvdbId: null, imdbId: 'tt1160419', servicePaths: ['/data/movies/Dune (2021)'], library: 'Movies' })
  })

  it("garde le chemin d'un film rangé en dossier (BDMV) et d'une série", () => {
    expect(mapJellyfinItem({ Id: 'b', Name: 'B', Type: 'Movie', Path: '/data/movies/B (2000)' }, 'M').servicePaths).toEqual(['/data/movies/B (2000)'])
    expect(mapJellyfinItem({ Id: 'c', Name: 'C', Type: 'Series', Path: '/data/tvshows/C', ProviderIds: { Tvdb: '5' } }, 'S')).toMatchObject({ type: 'series', tvdbId: 5, servicePaths: ['/data/tvshows/C'] })
  })

  it('agrège le visionnage par film ou par série', () => {
    const out = aggregateJellyfinPlayed([
      { user: 'alice', items: [
        { Id: 'm1', Name: 'M', Type: 'Movie', UserData: { PlayCount: 2, LastPlayedDate: '2026-01-02T00:00:00Z' } },
        { Id: 'e1', Name: 'E1', Type: 'Episode', SeriesId: 's1', UserData: { PlayCount: 1, LastPlayedDate: '2026-02-01T00:00:00Z' } },
        { Id: 'e2', Name: 'E2', Type: 'Episode', SeriesId: 's1', UserData: { PlayCount: 0, LastPlayedDate: '2026-03-01T00:00:00Z' } },
      ] },
    ])
    expect(out).toEqual([
      { externalId: 'm1', user: 'alice', lastWatchedAt: Date.parse('2026-01-02T00:00:00Z'), playCount: 2 },
      { externalId: 's1', user: 'alice', lastWatchedAt: Date.parse('2026-03-01T00:00:00Z'), playCount: 2 },
    ])
  })

  it("s'authentifie avec l'en-tête MediaBrowser", async () => {
    const { calls } = mockFetch({ '/Library/VirtualFolders': [{ Name: 'Movies', CollectionType: 'movies', Locations: ['/data/movies'], ItemId: 'lib1' }] })
    expect(await jellyfinLibraries({ url: 'http://jf:8096', apiKey: 'k' })).toEqual([{ id: 'lib1', name: 'Movies', collectionType: 'movies', locations: ['/data/movies'] }])
    expect(headerOf(calls[0]!.init, 'Authorization')).toBe('MediaBrowser Token="k"')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/connectors/jellyfin.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `server/connectors/jellyfin.ts`**

```ts
import path from 'node:path'
import { httpJson } from '../lib/http'
import type { HistoryRecord, ServerItemRecord } from '../lib/sync/types'

const posix = path.posix

export interface JellyfinConn { url: string; apiKey: string }
export interface JellyfinLibrary { id: string; name: string; collectionType: string | null; locations: string[] }
export interface JellyfinItem {
  Id: string; Name: string; ProductionYear?: number; Type: string
  ProviderIds?: Record<string, string>; Path?: string; SeriesId?: string
  UserData?: { PlayCount?: number; LastPlayedDate?: string; Played?: boolean }
}

function jf<T>(c: JellyfinConn, route: string): Promise<T> {
  return httpJson<T>(`${c.url.replace(/\/+$/, '')}${route}`, { headers: { Authorization: `MediaBrowser Token="${c.apiKey}"` } })
}

export async function jellyfinInfo(c: JellyfinConn): Promise<{ version: string; serverName: string }> {
  const r = await jf<{ Version: string; ServerName: string }>(c, '/System/Info')
  return { version: r.Version, serverName: r.ServerName }
}

export async function jellyfinLibraries(c: JellyfinConn): Promise<JellyfinLibrary[]> {
  const r = await jf<{ Name: string; CollectionType?: string; Locations?: string[]; ItemId: string }[]>(c, '/Library/VirtualFolders')
  return r.map(f => ({ id: f.ItemId, name: f.Name, collectionType: f.CollectionType ?? null, locations: f.Locations ?? [] }))
}

const ITEM_FIELDS = 'Fields=ProviderIds,Path&EnableImages=false&EnableUserData=true'

export async function jellyfinLibraryItems(c: JellyfinConn, libraryId: string): Promise<JellyfinItem[]> {
  const r = await jf<{ Items: JellyfinItem[] }>(c, `/Items?ParentId=${encodeURIComponent(libraryId)}&Recursive=true&IncludeItemTypes=Movie,Series&${ITEM_FIELDS}`)
  return r.Items ?? []
}

export async function jellyfinUsers(c: JellyfinConn): Promise<{ id: string; name: string }[]> {
  const r = await jf<{ Id: string; Name: string }[]>(c, '/Users')
  return r.map(u => ({ id: u.Id, name: u.Name }))
}

export async function jellyfinPlayed(c: JellyfinConn, userId: string): Promise<JellyfinItem[]> {
  const r = await jf<{ Items: JellyfinItem[] }>(c, `/Items?userId=${encodeURIComponent(userId)}&Recursive=true&IncludeItemTypes=Movie,Episode&Filters=IsPlayed&${ITEM_FIELDS}`)
  return r.Items ?? []
}

function providerId(item: JellyfinItem, name: string): string | undefined {
  const ids = item.ProviderIds ?? {}
  const key = Object.keys(ids).find(k => k.toLowerCase() === name.toLowerCase())
  return key ? ids[key] : undefined
}

export function mapJellyfinItem(item: JellyfinItem, library: string): ServerItemRecord {
  const isMovie = item.Type === 'Movie'
  // Un film a pour Path son fichier, sauf s'il est rangé en dossier (BDMV, VIDEO_TS).
  const folder = item.Path ? (isMovie && /\.[a-z0-9]{2,4}$/i.test(item.Path) ? posix.dirname(item.Path) : item.Path) : null
  return {
    externalId: item.Id,
    type: isMovie ? 'movie' : 'series',
    title: item.Name,
    year: item.ProductionYear ?? null,
    tmdbId: Number(providerId(item, 'Tmdb')) || null,
    tvdbId: Number(providerId(item, 'Tvdb')) || null,
    imdbId: providerId(item, 'Imdb') || null,
    servicePaths: folder ? [folder] : [],
    library,
  }
}

export function aggregateJellyfinPlayed(perUser: { user: string; items: JellyfinItem[] }[]): HistoryRecord[] {
  const byKey = new Map<string, HistoryRecord>()
  for (const { user, items } of perUser) {
    for (const item of items) {
      const externalId = item.Type === 'Episode' ? item.SeriesId : item.Id
      if (!externalId) continue
      const key = `${externalId}\u0000${user}`
      const last = item.UserData?.LastPlayedDate ? Date.parse(item.UserData.LastPlayedDate) : null
      const plays = Math.max(item.UserData?.PlayCount ?? 0, 1)
      const current = byKey.get(key)
      if (current) {
        current.playCount += plays
        if (last !== null) current.lastWatchedAt = Math.max(current.lastWatchedAt ?? 0, last)
      } else {
        byKey.set(key, { externalId, user, lastWatchedAt: last, playCount: plays })
      }
    }
  }
  return [...byKey.values()]
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run tests/unit/connectors/jellyfin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/connectors/jellyfin.ts tests/unit/connectors/jellyfin.test.ts
git commit -m "feat: connecteur Jellyfin"
```

---

### Task 10: Instances — stockage, test de connexion, découverte et routes

**Files:**
- Create: `shared/instances.ts`, `server/lib/instances.ts`, `server/lib/discovery.ts`, `server/api/instances/index.get.ts`, `server/api/instances/index.post.ts`, `server/api/instances/[id].put.ts`, `server/api/instances/[id].delete.ts`, `server/api/instances/test.post.ts`
- Modify: `tests/e2e/api.test.ts`
- Test: `tests/unit/instances.test.ts`, `tests/unit/discovery.test.ts`

**Interfaces:**
- Consumes: `getDb`, `encrypt`/`decrypt`, `AppError`, `defineApiHandler`/`parseOrThrow`/`parseId`, connecteurs des tâches 7 à 9.
- Produces (`shared/instances.ts`) : `INSTANCE_KINDS`, `type InstanceKind`, `KIND_LABELS`, `isArrKind(kind)`, `type InstanceStatus = 'inconnu' | 'ok' | 'erreur' | 'perime'`, `STATUS_LABELS`, `STATUS_DOT` (classes Tailwind), `interface InstanceDto`, `instanceCreateSchema`, `instanceUpdateSchema` (sans `kind`, `apiKey` optionnelle : vide = garder la clé), `instanceTestSchema`, `interface Discovery { version; roots: { path; label }[]; qualityProfiles: string[]; libraries: { id; name; type; locations }[] }`, `type TestResult = { ok: true; discovery: Discovery } | { ok: false; error: string }`.
- Produces (`server/lib/instances.ts`) : `interface InstanceSecret { id; kind; name; url; apiKey }`, `listInstances(db?)`, `getInstance(id, db?)`, `getInstanceSecret(id, db?)`, `createInstance(input, db?)`, `updateInstance(id, input, db?)`, `deleteInstance(id, db?)`, `registerDeletionGuard(guard: (id: number, db: Db) => string[])`, `setInstanceStatus(id, { status, error?, version?, syncedAt? }, db?)`.
- Produces (`server/lib/discovery.ts`) : `discover(conn: { kind; url; apiKey }): Promise<Discovery>` — ne garde que les bibliothèques films/séries de Plex et Jellyfin ; refuse un Radarr déclaré Sonarr (et inversement).
- Routes : `GET /api/instances → InstanceDto[]`, `POST /api/instances → InstanceDto`, `PUT /api/instances/:id → InstanceDto`, `DELETE /api/instances/:id → { ok: true }` (409 + `details` si bloquée), `POST /api/instances/test → TestResult`.

- [ ] **Step 1: Écrire les tests qui échouent**

`tests/unit/instances.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { createInstance, deleteInstance, getInstance, getInstanceSecret, listInstances, registerDeletionGuard, setInstanceStatus, updateInstance } from '../../server/lib/instances'
import { useTestDb } from '../helpers/db'

const db = useTestDb()
const radarr = { kind: 'radarr' as const, name: 'Radarr', url: 'http://192.168.1.10:7878', apiKey: 'cle-secrete', enabled: true }

describe('instances', () => {
  it('crée une instance sans jamais exposer la clé', () => {
    const dto = createInstance(radarr)
    expect(dto).toMatchObject({ id: 1, kind: 'radarr', name: 'Radarr', hasKey: true, enabled: true, lastStatus: 'inconnu' })
    expect(JSON.stringify(dto)).not.toContain('cle-secrete')
    const row = db().prepare('SELECT api_key_enc FROM instances').get() as { api_key_enc: string }
    expect(row.api_key_enc).not.toContain('cle-secrete')
    expect(getInstanceSecret(1)!.apiKey).toBe('cle-secrete')
  })

  it('refuse deux instances du même nom (sans tenir compte de la casse)', () => {
    createInstance(radarr)
    expect(() => createInstance({ ...radarr, name: 'radarr' })).toThrow('Une instance porte déjà ce nom.')
  })

  it('garde la clé si aucune nouvelle clé n\'est fournie', () => {
    createInstance(radarr)
    updateInstance(1, { name: 'Radarr HD', url: 'http://r:7878', enabled: false })
    expect(getInstance(1)).toMatchObject({ name: 'Radarr HD', url: 'http://r:7878', enabled: false })
    expect(getInstanceSecret(1)!.apiKey).toBe('cle-secrete')
    updateInstance(1, { name: 'Radarr HD', url: 'http://r:7878', enabled: true, apiKey: 'nouvelle' })
    expect(getInstanceSecret(1)!.apiKey).toBe('nouvelle')
  })

  it('supprime une instance et refuse si une garde la bloque', () => {
    createInstance(radarr)
    createInstance({ ...radarr, name: 'Radarr 4K' })
    registerDeletionGuard(id => (id === 2 ? ['Règle « Films anglais → 4K »'] : []))
    deleteInstance(1)
    expect(listInstances().map(i => i.name)).toEqual(['Radarr 4K'])
    expect(() => deleteInstance(2)).toThrow('Instance utilisée')
    expect(() => deleteInstance(99)).toThrow('Instance introuvable')
  })

  it('met à jour le statut', () => {
    createInstance(radarr)
    setInstanceStatus(1, { status: 'ok', error: null, version: '6.4.4', syncedAt: 123 })
    expect(getInstance(1)).toMatchObject({ lastStatus: 'ok', version: '6.4.4', lastSyncAt: 123, lastError: null })
    setInstanceStatus(1, { status: 'perime', error: 'Service injoignable' })
    expect(getInstance(1)).toMatchObject({ lastStatus: 'perime', version: '6.4.4', lastSyncAt: 123, lastError: 'Service injoignable' })
  })
})
```

> La garde enregistrée reste active pour les tests suivants du fichier : elle ne vise que l'id 2, ce qui ne gêne pas les autres tests (ils ne suppriment pas l'id 2).

`tests/unit/discovery.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { discover } from '../../server/lib/discovery'
import { mockFetch } from '../helpers/fetch'

describe('discover', () => {
  it('découvre un Radarr', async () => {
    mockFetch({
      '/api/v3/system/status': { appName: 'Radarr', version: '6.4.4' },
      '/api/v3/rootfolder': [{ path: '/movies' }, { path: '/animations' }],
      '/api/v3/qualityprofile': [{ id: 1, name: 'Any' }],
    })
    expect(await discover({ kind: 'radarr', url: 'http://r', apiKey: 'k' })).toEqual({
      version: '6.4.4',
      roots: [{ path: '/movies', label: '/movies' }, { path: '/animations', label: '/animations' }],
      qualityProfiles: ['Any'],
      libraries: [],
    })
  })

  it('refuse un Sonarr déclaré comme Radarr', async () => {
    mockFetch({ '/api/v3/system/status': { appName: 'Sonarr', version: '4.0.20' } })
    await expect(discover({ kind: 'radarr', url: 'http://s', apiKey: 'k' })).rejects.toThrow('Ce service est un Sonarr, pas un Radarr.')
  })

  it('ne garde que les bibliothèques films et séries de Plex', async () => {
    mockFetch({
      '/identity': { MediaContainer: { machineIdentifier: 'm', version: '1.41.0' } },
      '/library/sections': { MediaContainer: { Directory: [
        { key: '1', title: 'Movies', type: 'movie', Location: [{ path: '/media/movies' }] },
        { key: '2', title: 'Music', type: 'artist', Location: [{ path: '/music' }] },
        { key: '3', title: 'Animes', type: 'show', Location: [{ path: '/media/animes' }, { path: '/media/animes-extra' }] },
      ] } },
    })
    const d = await discover({ kind: 'plex', url: 'http://p', apiKey: 't' })
    expect(d.libraries.map(l => l.name)).toEqual(['Movies', 'Animes'])
    expect(d.roots).toEqual([
      { path: '/media/movies', label: 'Movies' },
      { path: '/media/animes', label: 'Animes' },
      { path: '/media/animes-extra', label: 'Animes' },
    ])
  })

  it('découvre Jellyfin', async () => {
    mockFetch({
      '/System/Info': { Version: '12.3.0', ServerName: 'Primary' },
      '/Library/VirtualFolders': [
        { Name: 'Series', CollectionType: 'tvshows', Locations: ['/data/tvshows'], ItemId: 'a' },
        { Name: 'Photos', CollectionType: 'homevideos', Locations: ['/data/photos'], ItemId: 'b' },
      ],
    })
    const d = await discover({ kind: 'jellyfin', url: 'http://j', apiKey: 'k' })
    expect(d).toMatchObject({ version: '12.3.0', roots: [{ path: '/data/tvshows', label: 'Series' }] })
  })
})
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run tests/unit/instances.test.ts tests/unit/discovery.test.ts`
Expected: FAIL — modules introuvables.

- [ ] **Step 3: Implémenter `shared/instances.ts`**

```ts
import { z } from 'zod'

export const INSTANCE_KINDS = ['radarr', 'sonarr', 'plex', 'jellyfin'] as const
export type InstanceKind = typeof INSTANCE_KINDS[number]

export const KIND_LABELS: Record<InstanceKind, string> = { radarr: 'Radarr', sonarr: 'Sonarr', plex: 'Plex', jellyfin: 'Jellyfin' }

export function isArrKind(kind: InstanceKind): kind is 'radarr' | 'sonarr' {
  return kind === 'radarr' || kind === 'sonarr'
}

export type InstanceStatus = 'inconnu' | 'ok' | 'erreur' | 'perime'

export const STATUS_LABELS: Record<InstanceStatus, string> = {
  inconnu: 'jamais testée',
  ok: 'connectée',
  erreur: 'erreur',
  perime: 'données périmées',
}

export const STATUS_DOT: Record<InstanceStatus, string> = {
  inconnu: 'bg-neutral-400',
  ok: 'bg-success',
  erreur: 'bg-error',
  perime: 'bg-warning',
}

export interface InstanceDto {
  id: number
  kind: InstanceKind
  name: string
  url: string
  enabled: boolean
  hasKey: boolean
  version: string | null
  lastStatus: InstanceStatus
  lastStatusAt: number | null
  lastError: string | null
  lastSyncAt: number | null
}

const url = z.string().trim()
  .regex(/^https?:\/\/[^\s/]+/i, 'URL invalide (http:// ou https:// attendu)')
  .transform(u => u.replace(/\/+$/, ''))

const name = z.string().trim().min(1, 'Nom obligatoire').max(60, '60 caractères maximum')

export const instanceCreateSchema = z.object({
  kind: z.enum(INSTANCE_KINDS),
  name,
  url,
  apiKey: z.string().trim().min(1, 'Clé API obligatoire'),
  enabled: z.boolean().default(true),
})

export const instanceUpdateSchema = z.object({
  name,
  url,
  apiKey: z.string().trim().optional().transform(v => (v ? v : undefined)),
  enabled: z.boolean().default(true),
})

export const instanceTestSchema = z.object({
  id: z.number().int().positive().optional(),
  kind: z.enum(INSTANCE_KINDS),
  url,
  apiKey: z.string().trim().optional().transform(v => (v ? v : undefined)),
})

export interface Discovery {
  version: string
  roots: { path: string; label: string }[]
  qualityProfiles: string[]
  libraries: { id: string; name: string; type: string; locations: string[] }[]
}

export type TestResult = { ok: true; discovery: Discovery } | { ok: false; error: string }
```

- [ ] **Step 4: Implémenter `server/lib/instances.ts`**

```ts
import type { InstanceDto, InstanceKind, InstanceStatus } from '#shared/instances'
import { getDb, type Db } from './db'
import { AppError } from './errors'
import { decrypt, encrypt } from './secrets'

interface Row {
  id: number; kind: InstanceKind; name: string; url: string; api_key_enc: string; enabled: number
  version: string | null; last_status: InstanceStatus; last_status_at: number | null; last_error: string | null; last_sync_at: number | null
}

export interface InstanceSecret { id: number; kind: InstanceKind; name: string; url: string; apiKey: string }

function toDto(r: Row): InstanceDto {
  return {
    id: r.id, kind: r.kind, name: r.name, url: r.url, enabled: r.enabled === 1, hasKey: r.api_key_enc.length > 0,
    version: r.version, lastStatus: r.last_status, lastStatusAt: r.last_status_at, lastError: r.last_error, lastSyncAt: r.last_sync_at,
  }
}

function row(id: number, db: Db): Row | undefined {
  return db.prepare('SELECT * FROM instances WHERE id = ?').get(id) as Row | undefined
}

function assertNameFree(db: Db, name: string, exceptId?: number): void {
  const other = db.prepare('SELECT id FROM instances WHERE name = ? COLLATE NOCASE AND id IS NOT ?').get(name, exceptId ?? null)
  if (other) throw new AppError('Une instance porte déjà ce nom.', 409)
}

export function listInstances(db: Db = getDb()): InstanceDto[] {
  const order = "CASE kind WHEN 'radarr' THEN 1 WHEN 'sonarr' THEN 2 WHEN 'plex' THEN 3 ELSE 4 END"
  return (db.prepare(`SELECT * FROM instances ORDER BY ${order}, name COLLATE NOCASE`).all() as Row[]).map(toDto)
}

export function getInstance(id: number, db: Db = getDb()): InstanceDto | null {
  const r = row(id, db)
  return r ? toDto(r) : null
}

export function getInstanceSecret(id: number, db: Db = getDb()): InstanceSecret | null {
  const r = row(id, db)
  return r ? { id: r.id, kind: r.kind, name: r.name, url: r.url, apiKey: decrypt(r.api_key_enc) } : null
}

export function createInstance(input: { kind: InstanceKind; name: string; url: string; apiKey: string; enabled: boolean }, db: Db = getDb()): InstanceDto {
  assertNameFree(db, input.name)
  const info = db.prepare('INSERT INTO instances (kind, name, url, api_key_enc, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.kind, input.name, input.url, encrypt(input.apiKey), input.enabled ? 1 : 0, Date.now())
  return getInstance(Number(info.lastInsertRowid), db)!
}

export function updateInstance(id: number, input: { name: string; url: string; enabled: boolean; apiKey?: string }, db: Db = getDb()): InstanceDto {
  if (!row(id, db)) throw new AppError('Instance introuvable.', 404)
  assertNameFree(db, input.name, id)
  db.prepare('UPDATE instances SET name = ?, url = ?, enabled = ? WHERE id = ?').run(input.name, input.url, input.enabled ? 1 : 0, id)
  if (input.apiKey) db.prepare('UPDATE instances SET api_key_enc = ? WHERE id = ?').run(encrypt(input.apiKey), id)
  return getInstance(id, db)!
}

type DeletionGuard = (id: number, db: Db) => string[]
const guards: DeletionGuard[] = []

/** Les phases suivantes (règles) enregistrent ici ce qui empêche de supprimer une instance. */
export function registerDeletionGuard(guard: DeletionGuard): void {
  guards.push(guard)
}

export function deleteInstance(id: number, db: Db = getDb()): void {
  if (!row(id, db)) throw new AppError('Instance introuvable.', 404)
  const blockers = guards.flatMap(g => g(id, db))
  if (blockers.length) throw new AppError('Instance utilisée : retire-la d\'abord de ces éléments.', 409, blockers)
  db.prepare('DELETE FROM instances WHERE id = ?').run(id)
}

export function setInstanceStatus(
  id: number,
  patch: { status: InstanceStatus; error?: string | null; version?: string | null; syncedAt?: number },
  db: Db = getDb(),
): void {
  db.prepare(`UPDATE instances SET last_status = ?, last_status_at = ?, last_error = ?,
    version = COALESCE(?, version), last_sync_at = COALESCE(?, last_sync_at) WHERE id = ?`)
    .run(patch.status, Date.now(), patch.error ?? null, patch.version ?? null, patch.syncedAt ?? null, id)
}
```

- [ ] **Step 5: Implémenter `server/lib/discovery.ts`**

```ts
import { KIND_LABELS, type Discovery, type InstanceKind } from '#shared/instances'
import { arrQualityProfiles, arrRootFolders, arrStatus } from '../connectors/arr'
import { jellyfinInfo, jellyfinLibraries } from '../connectors/jellyfin'
import { plexIdentity, plexSections } from '../connectors/plex'
import { AppError } from './errors'

const PLEX_TYPES = new Set(['movie', 'show'])
const JELLYFIN_TYPES = new Set(['movies', 'tvshows'])

/** Teste la connexion et décrit ce que le service expose (dossiers racines, bibliothèques). */
export async function discover(conn: { kind: InstanceKind; url: string; apiKey: string }): Promise<Discovery> {
  if (conn.kind === 'radarr' || conn.kind === 'sonarr') {
    const c = { url: conn.url, apiKey: conn.apiKey }
    const status = await arrStatus(c)
    const expected = KIND_LABELS[conn.kind]
    if (status.appName && status.appName !== expected) throw new AppError(`Ce service est un ${status.appName}, pas un ${expected}.`)
    const [roots, profiles] = await Promise.all([arrRootFolders(c), arrQualityProfiles(c)])
    return { version: status.version, roots: roots.map(r => ({ path: r.path, label: r.path })), qualityProfiles: profiles.map(p => p.name), libraries: [] }
  }
  if (conn.kind === 'plex') {
    const c = { url: conn.url, token: conn.apiKey }
    const identity = await plexIdentity(c)
    const sections = (await plexSections(c)).filter(s => PLEX_TYPES.has(s.type))
    return {
      version: identity.version,
      roots: sections.flatMap(s => s.locations.map(path => ({ path, label: s.title }))),
      qualityProfiles: [],
      libraries: sections.map(s => ({ id: s.key, name: s.title, type: s.type, locations: s.locations })),
    }
  }
  const c = { url: conn.url, apiKey: conn.apiKey }
  const info = await jellyfinInfo(c)
  const libraries = (await jellyfinLibraries(c)).filter(l => l.collectionType && JELLYFIN_TYPES.has(l.collectionType))
  return {
    version: info.version,
    roots: libraries.flatMap(l => l.locations.map(path => ({ path, label: l.name }))),
    qualityProfiles: [],
    libraries: libraries.map(l => ({ id: l.id, name: l.name, type: l.collectionType!, locations: l.locations })),
  }
}
```

- [ ] **Step 6: Lancer les tests unitaires**

Run: `npx vitest run tests/unit/instances.test.ts tests/unit/discovery.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Écrire les routes**

`server/api/instances/index.get.ts` :

```ts
import { defineApiHandler } from '~~/server/lib/api'
import { listInstances } from '~~/server/lib/instances'

export default defineApiHandler(() => listInstances())
```

`server/api/instances/index.post.ts` :

```ts
import { instanceCreateSchema } from '#shared/instances'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { createInstance } from '~~/server/lib/instances'

export default defineApiHandler(async event => createInstance(parseOrThrow(instanceCreateSchema, await readBody(event))))
```

`server/api/instances/[id].put.ts` :

```ts
import { instanceUpdateSchema } from '#shared/instances'
import { defineApiHandler, parseId, parseOrThrow } from '~~/server/lib/api'
import { updateInstance } from '~~/server/lib/instances'

export default defineApiHandler(async event => updateInstance(parseId(event), parseOrThrow(instanceUpdateSchema, await readBody(event))))
```

`server/api/instances/[id].delete.ts` :

```ts
import { defineApiHandler, parseId } from '~~/server/lib/api'
import { deleteInstance } from '~~/server/lib/instances'

export default defineApiHandler((event) => {
  deleteInstance(parseId(event))
  return { ok: true }
})
```

`server/api/instances/test.post.ts` :

```ts
import { instanceTestSchema, type TestResult } from '#shared/instances'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { discover } from '~~/server/lib/discovery'
import { AppError } from '~~/server/lib/errors'
import { getInstanceSecret, setInstanceStatus } from '~~/server/lib/instances'

export default defineApiHandler(async (event): Promise<TestResult> => {
  const input = parseOrThrow(instanceTestSchema, await readBody(event))
  const saved = input.id ? getInstanceSecret(input.id) : null
  const apiKey = input.apiKey ?? saved?.apiKey
  if (!apiKey) throw new AppError('Clé API obligatoire.')
  // Le statut enregistré ne change que si l'on teste la configuration enregistrée.
  const testsSaved = saved !== null && saved.url === input.url && (!input.apiKey || input.apiKey === saved.apiKey)
  try {
    const discovery = await discover({ kind: input.kind, url: input.url, apiKey })
    if (testsSaved && saved) setInstanceStatus(saved.id, { status: 'ok', error: null, version: discovery.version })
    return { ok: true, discovery }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (testsSaved && saved) setInstanceStatus(saved.id, { status: 'erreur', error: message })
    return { ok: false, error: message }
  }
})
```

- [ ] **Step 8: Compléter le test de bout en bout**

Dans `tests/e2e/api.test.ts`, ajouter à la fin du bloc `describe('API', …)`, après le dernier `it` :

```ts
  it('crée une instance sans jamais renvoyer sa clé', async () => {
    const created = await fetch('/api/instances', post({ kind: 'radarr', name: 'Radarr', url: 'http://127.0.0.1:9/', apiKey: 'cle-tres-secrete' }, cookie))
    expect(created.status).toBe(200)
    const body = await created.text()
    expect(body).not.toContain('cle-tres-secrete')
    expect(JSON.parse(body)).toMatchObject({ name: 'Radarr', url: 'http://127.0.0.1:9', hasKey: true })
    const list = await (await fetch('/api/instances', { headers: { cookie } })).text()
    expect(list).not.toContain('cle-tres-secrete')
  })

  it('valide les entrées avec des messages en français', async () => {
    const res = await fetch('/api/instances', post({ kind: 'radarr', name: '', url: 'pas-une-url', apiKey: '' }, cookie))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.message).toBe('Données invalides.')
    expect(body.data.details.join(' ')).toContain('URL invalide')
  })
```

- [ ] **Step 9: Lancer tous les tests**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: gestion des instances et test de connexion"
```

---

### Task 11: Import de media.env

**Files:**
- Create: `server/lib/envImport.ts`, `server/api/instances/import.get.ts`, `server/api/instances/import.post.ts`
- Modify: `shared/instances.ts` (type `ImportPreview`)
- Test: `tests/unit/envImport.test.ts`

**Interfaces:**
- Consumes: `configDir`, `createInstance`, `listInstances`.
- Produces: `interface EnvProposal { name; kind; url; apiKey }`, `parseMediaEnv(content: string): EnvProposal[]`, `readMediaEnvFile(dir?: string): string | null` (lit `<configDir>/media.env`), `importFromEnv(names: string[], content: string, db?): InstanceDto[]`. Type partagé `ImportPreview = { available: boolean; proposals: { name: string; kind: InstanceKind; url: string; exists: boolean }[] }`. Routes `GET /api/instances/import → ImportPreview` (jamais de clé), `POST /api/instances/import { names: string[] } → InstanceDto[]`.

Règles de lecture : une instance par préfixe `<P>_URL` ; clé = `<P>_KEY` ou `<P>_TOKEN` ; type deviné si le préfixe contient RADARR, SONARR, PLEX ou JELLYFIN ; nom = préfixe en mots capitalisés (`RADARR_4K` → `Radarr 4K`) ; les autres variables (ex : `4K_LIBRARIES`) sont ignorées.

- [ ] **Step 1: Écrire le test qui échoue**

`tests/unit/envImport.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { importFromEnv, parseMediaEnv, readMediaEnvFile } from '../../server/lib/envImport'
import { createInstance, getInstanceSecret, listInstances } from '../../server/lib/instances'
import { useTestDb } from '../helpers/db'

useTestDb()

const SAMPLE = `# Remplis les URL et clés API
RADARR_URL=http://192.168.1.10:7878
RADARR_KEY=abc
RADARR_4K_URL=http://192.168.1.11:7878/
RADARR_4K_KEY="def"
PLEX_URL=http://192.168.1.20:32400
PLEX_TOKEN=tok
JELLYFIN_URL=http://192.168.1.21:8096
JELLYFIN_KEY=
OTHER_URL=http://x
4K_LIBRARIES=Movies 4K,Series 4K
`

describe('parseMediaEnv', () => {
  it('propose une instance par couple URL + clé', () => {
    expect(parseMediaEnv(SAMPLE)).toEqual([
      { name: 'Radarr', kind: 'radarr', url: 'http://192.168.1.10:7878', apiKey: 'abc' },
      { name: 'Radarr 4K', kind: 'radarr', url: 'http://192.168.1.11:7878', apiKey: 'def' },
      { name: 'Plex', kind: 'plex', url: 'http://192.168.1.20:32400', apiKey: 'tok' },
    ])
  })
})

describe('readMediaEnvFile', () => {
  it('renvoie null sans fichier et le contenu sinon', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-'))
    expect(readMediaEnvFile(dir)).toBeNull()
    fs.writeFileSync(path.join(dir, 'media.env'), SAMPLE)
    expect(readMediaEnvFile(dir)).toBe(SAMPLE)
  })
})

describe('importFromEnv', () => {
  it('crée seulement les instances choisies et absentes', () => {
    createInstance({ kind: 'plex', name: 'Plex', url: 'http://p', apiKey: 'x', enabled: true })
    const created = importFromEnv(['Radarr 4K', 'Plex'], SAMPLE)
    expect(created.map(i => i.name)).toEqual(['Radarr 4K'])
    expect(listInstances().map(i => i.name)).toEqual(['Radarr 4K', 'Plex'])
    expect(getInstanceSecret(created[0]!.id)!.apiKey).toBe('def')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/envImport.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

Ajouter à la fin de `shared/instances.ts` :

```ts
export interface ImportPreview {
  available: boolean
  proposals: { name: string; kind: InstanceKind; url: string; exists: boolean }[]
}
```

`server/lib/envImport.ts` :

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { InstanceDto, InstanceKind } from '#shared/instances'
import { configDir } from './config'
import { getDb, type Db } from './db'
import { createInstance, listInstances } from './instances'

export interface EnvProposal { name: string; kind: InstanceKind; url: string; apiKey: string }

const KIND_HINTS: [RegExp, InstanceKind][] = [[/RADARR/, 'radarr'], [/SONARR/, 'sonarr'], [/PLEX/, 'plex'], [/JELLYFIN/, 'jellyfin']]

function displayName(prefix: string): string {
  return prefix.split('_').filter(Boolean).map(w => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

export function parseMediaEnv(content: string): EnvProposal[] {
  const vars = new Map<string, string>()
  for (const line of content.split(/\r?\n/)) {
    const text = line.trim()
    if (!text || text.startsWith('#')) continue
    const eq = text.indexOf('=')
    if (eq < 1) continue
    vars.set(text.slice(0, eq).trim(), text.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2'))
  }
  const proposals: EnvProposal[] = []
  for (const [key, url] of vars) {
    if (!key.endsWith('_URL') || !url) continue
    const prefix = key.slice(0, -'_URL'.length)
    const apiKey = vars.get(`${prefix}_KEY`) || vars.get(`${prefix}_TOKEN`)
    const kind = KIND_HINTS.find(([re]) => re.test(prefix.toUpperCase()))?.[1]
    if (!apiKey || !kind) continue
    proposals.push({ name: displayName(prefix), kind, url: url.replace(/\/+$/, ''), apiKey })
  }
  return proposals
}

export function readMediaEnvFile(dir: string = configDir()): string | null {
  const file = path.join(dir, 'media.env')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

export function importFromEnv(names: string[], content: string, db: Db = getDb()): InstanceDto[] {
  const wanted = new Set(names.map(n => n.toLowerCase()))
  const existing = new Set(listInstances(db).map(i => i.name.toLowerCase()))
  return parseMediaEnv(content)
    .filter(p => wanted.has(p.name.toLowerCase()) && !existing.has(p.name.toLowerCase()))
    .map(p => createInstance({ ...p, enabled: true }, db))
}
```

`server/api/instances/import.get.ts` :

```ts
import type { ImportPreview } from '#shared/instances'
import { defineApiHandler } from '~~/server/lib/api'
import { parseMediaEnv, readMediaEnvFile } from '~~/server/lib/envImport'
import { listInstances } from '~~/server/lib/instances'

export default defineApiHandler((): ImportPreview => {
  const content = readMediaEnvFile()
  if (content === null) return { available: false, proposals: [] }
  const existing = new Set(listInstances().map(i => i.name.toLowerCase()))
  return {
    available: true,
    proposals: parseMediaEnv(content).map(p => ({ name: p.name, kind: p.kind, url: p.url, exists: existing.has(p.name.toLowerCase()) })),
  }
})
```

`server/api/instances/import.post.ts` :

```ts
import { z } from 'zod'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { importFromEnv, readMediaEnvFile } from '~~/server/lib/envImport'
import { AppError } from '~~/server/lib/errors'

const schema = z.object({ names: z.array(z.string().min(1)).min(1, 'Choisis au moins une instance') })

export default defineApiHandler(async (event) => {
  const { names } = parseOrThrow(schema, await readBody(event))
  const content = readMediaEnvFile()
  if (content === null) throw new AppError('Aucun fichier media.env dans le dossier de configuration.', 404)
  return importFromEnv(names, content)
})
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run tests/unit/envImport.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: import des instances depuis media.env"
```

---

### Task 12: Correspondance des chemins (conversion, suggestions, vérification)

**Files:**
- Create: `shared/paths.ts`, `server/lib/paths.ts`, `server/api/instances/[id]/paths/index.get.ts`, `server/api/instances/[id]/paths/index.put.ts`, `server/api/instances/[id]/paths/suggest.post.ts`, `server/api/instances/[id]/paths/verify.post.ts`
- Test: `tests/unit/paths.test.ts`

**Interfaces:**
- Consumes: `mediaRoot`, `getDb`, `AppError`, `discover`, `getInstanceSecret`, `radarrMovies`, `sonarrSeries`.
- Produces (`shared/paths.ts`) : `interface PathMapping { id; instanceId; servicePath; realPath; managed }`, `mappingInputSchema`, `mappingsPutSchema` (`{ mappings: MappingInput[] }`), `interface PathSuggestion { servicePath; label; realPath: string | null; managed; existing }`, `interface PathCheck { servicePath; realPath: string | null; exists: boolean; message: string }`.
- Produces (`server/lib/paths.ts`) :
  - Fonctions pures : `normalizeDir(p)`, `isUnder(child, parent)`, `toRealWith(mappings, servicePath)` (plus long préfixe, lève `PathMappingError`), `toServiceWith(mappings, realPath)`, `tryReal(mappings, servicePath): string | null`.
  - Base : `listMappings(instanceId, db?)`, `replaceMappings(instanceId, rows, db?)` (refuse un chemin réel hors de la racine médias, et les doublons), `toReal(instanceId, servicePath)`, `toService(instanceId, realPath)`.
  - Disque : `assertUnderMediaRoot(realPath)`, `suggestRealPath(servicePath, root = mediaRoot()): string | null`, `verifyInstancePaths(instanceId, deps?): Promise<{ ok: boolean; checks: PathCheck[] }>`.
  - `class PathMappingError extends AppError`.
- Routes : `GET /api/instances/:id/paths → PathMapping[]`, `PUT … { mappings } → PathMapping[]`, `POST …/suggest → { mediaRoot, suggestions: PathSuggestion[] }`, `POST …/verify → { ok, checks }`.

- [ ] **Step 1: Écrire le test qui échoue**

`tests/unit/paths.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isUnder, listMappings, normalizeDir, replaceMappings, suggestRealPath, toRealWith, toServiceWith, tryReal, verifyInstancePaths } from '../../server/lib/paths'
import { createInstance } from '../../server/lib/instances'
import { mediaRoot } from '../../server/lib/config'
import { useTestDb } from '../helpers/db'

useTestDb()

const jellyfin = [
  { servicePath: '/data/', realPath: '/media' },
  { servicePath: '/data/tvshows', realPath: '/media/series' },
]

describe('fonctions pures', () => {
  it('normalise les dossiers', () => {
    expect(normalizeDir('/data//tvshows/')).toBe('/data/tvshows')
    expect(normalizeDir('/')).toBe('/')
  })

  it('teste l\'inclusion sans confondre les préfixes', () => {
    expect(isUnder('/media/movies-4k/X', '/media/movies')).toBe(false)
    expect(isUnder('/media/movies/X', '/media/movies')).toBe(true)
    expect(isUnder('/anything', '/')).toBe(true)
  })

  it('convertit avec le plus long préfixe', () => {
    expect(toRealWith(jellyfin, '/data/tvshows/The Expanse')).toBe('/media/series/The Expanse')
    expect(toRealWith(jellyfin, '/data/movies/Dune (2021)')).toBe('/media/movies/Dune (2021)')
    expect(toRealWith(jellyfin, '/data')).toBe('/media')
  })

  it('lève une erreur explicite sans correspondance', () => {
    expect(() => toRealWith(jellyfin, '/autre/x')).toThrow('Aucune correspondance de chemin pour /autre/x')
    expect(tryReal(jellyfin, '/autre/x')).toBeNull()
  })

  it('convertit dans l\'autre sens', () => {
    expect(toServiceWith([{ servicePath: '/movies', realPath: '/media/movies-4k' }], '/media/movies-4k/Film')).toBe('/movies/Film')
  })
})

describe('stockage', () => {
  it('remplace les correspondances d\'une instance', () => {
    createInstance({ kind: 'radarr', name: 'Radarr', url: 'http://r', apiKey: 'k', enabled: true })
    const root = mediaRoot()
    replaceMappings(1, [{ servicePath: '/movies/', realPath: `${root}/movies`, managed: true }])
    replaceMappings(1, [{ servicePath: '/animations', realPath: `${root}/animations`, managed: false }])
    expect(listMappings(1)).toEqual([{ id: 2, instanceId: 1, servicePath: '/animations', realPath: `${root}/animations`, managed: false }])
  })

  it('refuse un chemin réel hors de la racine médias et les doublons', () => {
    createInstance({ kind: 'radarr', name: 'Radarr', url: 'http://r', apiKey: 'k', enabled: true })
    expect(() => replaceMappings(1, [{ servicePath: '/movies', realPath: '/etc', managed: true }])).toThrow('doit être sous')
    const real = `${mediaRoot()}/movies`
    expect(() => replaceMappings(1, [{ servicePath: '/movies', realPath: real, managed: true }, { servicePath: '/movies/', realPath: real, managed: true }])).toThrow('en double')
  })
})

describe('suggestRealPath', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-'))
  fs.mkdirSync(path.join(root, 'movies'))
  fs.mkdirSync(path.join(root, 'films', 'movies-4k'), { recursive: true })

  it('trouve un dossier de même nom directement sous la racine', () => {
    expect(suggestRealPath('/movies', root)).toBe(`${root}/movies`)
  })

  it('cherche aussi un niveau plus bas', () => {
    expect(suggestRealPath('/data/movies-4k', root)).toBe(`${root}/films/movies-4k`)
  })

  it('garde un chemin qui existe déjà sous la racine', () => {
    expect(suggestRealPath(`${root}/movies`, root)).toBe(`${root}/movies`)
  })

  it('renvoie null sans correspondance', () => {
    expect(suggestRealPath('/data/tvshows', root)).toBeNull()
  })
})

describe('verifyInstancePaths', () => {
  it('vérifie les dossiers racines et un échantillon', async () => {
    createInstance({ kind: 'radarr', name: 'Radarr', url: 'http://r', apiKey: 'k', enabled: true })
    const root = mediaRoot()
    fs.mkdirSync(`${root}/movies/Dune (2021)`, { recursive: true })
    replaceMappings(1, [{ servicePath: '/movies', realPath: `${root}/movies`, managed: true }])
    const result = await verifyInstancePaths(1, {
      roots: async () => ['/movies', '/animations'],
      samples: async () => ['/movies/Dune (2021)', '/movies/Absent (1999)'],
    })
    expect(result.ok).toBe(false)
    expect(result.checks.map(c => [c.servicePath, c.exists, c.message])).toEqual([
      ['/movies', true, 'OK'],
      ['/animations', false, 'Aucune correspondance'],
      ['/movies/Dune (2021)', true, 'OK'],
      ['/movies/Absent (1999)', false, `Dossier introuvable : ${root}/movies/Absent (1999)`],
    ])
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/paths.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `shared/paths.ts`**

```ts
import { z } from 'zod'

export interface PathMapping { id: number; instanceId: number; servicePath: string; realPath: string; managed: boolean }

const absolute = (label: string) => z.string().trim().min(1, `${label} obligatoire`).startsWith('/', `${label} : chemin absolu attendu (commence par /)`)

export const mappingInputSchema = z.object({
  servicePath: absolute('Chemin du service'),
  realPath: absolute('Chemin réel'),
  managed: z.boolean().default(true),
})
export type MappingInput = z.infer<typeof mappingInputSchema>

export const mappingsPutSchema = z.object({ mappings: z.array(mappingInputSchema).max(100) })

export interface PathSuggestion { servicePath: string; label: string; realPath: string | null; managed: boolean; existing: boolean }
export interface PathCheck { servicePath: string; realPath: string | null; exists: boolean; message: string }
```

- [ ] **Step 4: Implémenter `server/lib/paths.ts`**

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { MappingInput, PathCheck, PathMapping } from '#shared/paths'
import { arrRootFolders, radarrMovies, sonarrSeries } from '../connectors/arr'
import { mediaRoot } from './config'
import { getDb, type Db } from './db'
import { discover } from './discovery'
import { AppError } from './errors'
import { getInstanceSecret } from './instances'

const posix = path.posix

export class PathMappingError extends AppError {}

interface MappingLike { servicePath: string; realPath: string }

export function normalizeDir(p: string): string {
  const n = posix.normalize(p.trim().replace(/\\/g, '/'))
  return n.length > 1 ? n.replace(/\/+$/, '') : n
}

export function isUnder(child: string, parent: string): boolean {
  const c = normalizeDir(child)
  const p = normalizeDir(parent)
  return p === '/' ? c.startsWith('/') : c === p || c.startsWith(`${p}/`)
}

function convert(mappings: MappingLike[], value: string, from: keyof MappingLike, to: keyof MappingLike): string | null {
  const target = normalizeDir(value)
  let best: MappingLike | null = null
  for (const m of mappings) {
    if (isUnder(target, m[from]) && (!best || normalizeDir(m[from]).length > normalizeDir(best[from]).length)) best = m
  }
  if (!best) return null
  const prefix = normalizeDir(best[from])
  const rest = prefix === '/' ? target.slice(1) : target.slice(prefix.length).replace(/^\//, '')
  return rest ? posix.join(normalizeDir(best[to]), rest) : normalizeDir(best[to])
}

export function toRealWith(mappings: MappingLike[], servicePath: string): string {
  const real = convert(mappings, servicePath, 'servicePath', 'realPath')
  if (real === null) throw new PathMappingError(`Aucune correspondance de chemin pour ${servicePath}`)
  return real
}

export function toServiceWith(mappings: MappingLike[], realPath: string): string {
  const service = convert(mappings, realPath, 'realPath', 'servicePath')
  if (service === null) throw new PathMappingError(`Aucune correspondance de chemin pour ${realPath}`)
  return service
}

export function tryReal(mappings: MappingLike[], servicePath: string): string | null {
  return convert(mappings, servicePath, 'servicePath', 'realPath')
}

interface Row { id: number; instance_id: number; service_path: string; real_path: string; managed: number }

export function listMappings(instanceId: number, db: Db = getDb()): PathMapping[] {
  return (db.prepare('SELECT * FROM path_mappings WHERE instance_id = ? ORDER BY service_path').all(instanceId) as Row[])
    .map(r => ({ id: r.id, instanceId: r.instance_id, servicePath: r.service_path, realPath: r.real_path, managed: r.managed === 1 }))
}

export function assertUnderMediaRoot(realPath: string): void {
  const root = normalizeDir(mediaRoot())
  if (!isUnder(realPath, root)) throw new PathMappingError(`Le chemin réel ${realPath} doit être sous ${root}.`)
}

export function replaceMappings(instanceId: number, rows: MappingInput[], db: Db = getDb()): PathMapping[] {
  const seen = new Set<string>()
  const clean = rows.map((r) => {
    const servicePath = normalizeDir(r.servicePath)
    const realPath = normalizeDir(r.realPath)
    if (seen.has(servicePath)) throw new PathMappingError(`Le chemin ${servicePath} est en double.`)
    seen.add(servicePath)
    assertUnderMediaRoot(realPath)
    return { servicePath, realPath, managed: r.managed }
  })
  db.transaction(() => {
    db.prepare('DELETE FROM path_mappings WHERE instance_id = ?').run(instanceId)
    const insert = db.prepare('INSERT INTO path_mappings (instance_id, service_path, real_path, managed) VALUES (?, ?, ?, ?)')
    for (const r of clean) insert.run(instanceId, r.servicePath, r.realPath, r.managed ? 1 : 0)
  })()
  return listMappings(instanceId, db)
}

export function toReal(instanceId: number, servicePath: string, db: Db = getDb()): string {
  return toRealWith(listMappings(instanceId, db), servicePath)
}

export function toService(instanceId: number, realPath: string, db: Db = getDb()): string {
  return toServiceWith(listMappings(instanceId, db), realPath)
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory() } catch { return false }
}

function subDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort()
  } catch {
    return []
  }
}

/** Propose le dossier de /media qui correspond à un chemin vu par un service. */
export function suggestRealPath(servicePath: string, root: string = mediaRoot()): string | null {
  const sp = normalizeDir(servicePath)
  const base = normalizeDir(root)
  if (isUnder(sp, base) && isDir(sp)) return sp
  const name = posix.basename(sp)
  if (!name) return null
  const direct = posix.join(base, name)
  if (isDir(direct)) return direct
  for (const child of subDirs(base)) {
    const candidate = posix.join(base, child, name)
    if (isDir(candidate)) return candidate
  }
  return null
}

export interface VerifyDeps {
  roots: () => Promise<string[]>
  samples: () => Promise<string[]>
}

function liveDeps(instanceId: number): VerifyDeps {
  const secret = getInstanceSecret(instanceId)
  if (!secret) throw new AppError('Instance introuvable.', 404)
  const arr = { url: secret.url, apiKey: secret.apiKey }
  return {
    roots: async () => secret.kind === 'radarr' || secret.kind === 'sonarr'
      ? (await arrRootFolders(arr)).map(r => r.path)
      : (await discover(secret)).roots.map(r => r.path),
    samples: async () => {
      if (secret.kind === 'radarr') return (await radarrMovies(arr)).filter(m => m.hasFile).slice(0, 5).map(m => m.path)
      if (secret.kind === 'sonarr') return (await sonarrSeries(arr)).filter(s => (s.statistics?.episodeFileCount ?? 0) > 0).slice(0, 5).map(s => s.path)
      return []
    },
  }
}

/** Vérifie que les dossiers racines (ou bibliothèques) et quelques titres existent sous /media. */
export async function verifyInstancePaths(instanceId: number, deps: VerifyDeps = liveDeps(instanceId)): Promise<{ ok: boolean; checks: PathCheck[] }> {
  const mappings = listMappings(instanceId)
  const paths = [...(await deps.roots()), ...(await deps.samples())]
  const checks = paths.map((servicePath): PathCheck => {
    const realPath = tryReal(mappings, servicePath)
    if (realPath === null) return { servicePath, realPath, exists: false, message: 'Aucune correspondance' }
    const exists = isDir(realPath)
    return { servicePath, realPath, exists, message: exists ? 'OK' : `Dossier introuvable : ${realPath}` }
  })
  return { ok: checks.length > 0 && checks.every(c => c.exists), checks }
}
```

- [ ] **Step 5: Lancer les tests**

Run: `npx vitest run tests/unit/paths.test.ts`
Expected: PASS.

- [ ] **Step 6: Écrire les routes**

`server/api/instances/[id]/paths/index.get.ts` :

```ts
import { defineApiHandler, parseId } from '~~/server/lib/api'
import { listMappings } from '~~/server/lib/paths'

export default defineApiHandler(event => listMappings(parseId(event)))
```

`server/api/instances/[id]/paths/index.put.ts` :

```ts
import { mappingsPutSchema } from '#shared/paths'
import { defineApiHandler, parseId, parseOrThrow } from '~~/server/lib/api'
import { AppError } from '~~/server/lib/errors'
import { getInstance } from '~~/server/lib/instances'
import { replaceMappings } from '~~/server/lib/paths'

export default defineApiHandler(async (event) => {
  const id = parseId(event)
  if (!getInstance(id)) throw new AppError('Instance introuvable.', 404)
  const { mappings } = parseOrThrow(mappingsPutSchema, await readBody(event))
  return replaceMappings(id, mappings)
})
```

`server/api/instances/[id]/paths/suggest.post.ts` :

```ts
import type { PathSuggestion } from '#shared/paths'
import { defineApiHandler, parseId } from '~~/server/lib/api'
import { mediaRoot } from '~~/server/lib/config'
import { discover } from '~~/server/lib/discovery'
import { AppError } from '~~/server/lib/errors'
import { getInstanceSecret } from '~~/server/lib/instances'
import { listMappings, normalizeDir, suggestRealPath } from '~~/server/lib/paths'

export default defineApiHandler(async (event) => {
  const id = parseId(event)
  const secret = getInstanceSecret(id)
  if (!secret) throw new AppError('Instance introuvable.', 404)
  const discovery = await discover(secret)
  const existing = listMappings(id)
  const suggestions: PathSuggestion[] = discovery.roots.map((root) => {
    const servicePath = normalizeDir(root.path)
    const saved = existing.find(m => m.servicePath === servicePath)
    return {
      servicePath,
      label: root.label,
      realPath: saved?.realPath ?? suggestRealPath(servicePath),
      managed: saved?.managed ?? true,
      existing: saved !== undefined,
    }
  })
  return { mediaRoot: mediaRoot(), suggestions }
})
```

`server/api/instances/[id]/paths/verify.post.ts` :

```ts
import { defineApiHandler, parseId } from '~~/server/lib/api'
import { verifyInstancePaths } from '~~/server/lib/paths'

export default defineApiHandler(event => verifyInstancePaths(parseId(event)))
```

- [ ] **Step 7: Lancer tous les tests et le typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, aucune erreur de type.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: correspondance des chemins avec suggestions et vérification"
```

---

### Task 13: Synchronisation du catalogue et planification

**Files:**
- Create: `shared/sync.ts`, `server/lib/sync/store.ts`, `server/lib/sync/fetchers.ts`, `server/lib/sync/runner.ts`, `server/lib/scheduler.ts`, `server/plugins/scheduler.ts`, `server/api/sync/index.get.ts`, `server/api/sync/index.post.ts`, `server/api/settings/general.get.ts`, `server/api/settings/sync.put.ts`
- Modify: `server/lib/sync/types.ts` (ajout de `SyncDeps`, `StoreCounts`)
- Test: `tests/unit/sync/store.test.ts`, `tests/unit/sync/runner.test.ts`, `tests/unit/scheduler.test.ts`

**Interfaces:**
- Consumes: connecteurs (tâches 7 à 9), `mapLimit`, `listInstances`, `getInstanceSecret`, `setInstanceStatus`, `listMappings`, `tryReal`, `getSetting`/`setSetting`.
- Produces (`shared/sync.ts`) : `interface SyncInstanceResult { instanceId; name; ok; error: string | null; items; files; unmapped; durationMs }`, `interface SyncState { running; startedAt: number | null; finishedAt: number | null; results: SyncInstanceResult[] }`, `type SyncStateDto = SyncState & { nextRunAt: number | null }`.
- Produces (ajout à `server/lib/sync/types.ts`) :

```ts
import type { InstanceSecret } from '../instances'
export interface StoreCounts { items: number; files: number; unmapped: number }
export interface SyncDeps {
  fetchArr(instance: InstanceSecret): Promise<{ version: string; records: ArrItemRecord[] }>
  fetchServer(instance: InstanceSecret): Promise<{ version: string; items: ServerItemRecord[]; history: HistoryRecord[] }>
  listTopDirs(realPath: string): string[]
}
```

- Produces (`store.ts`) : `itemKey(record, fallback)`, `storeArrInstance(db, instanceId, records, mappings, now): StoreCounts`, `storeServerInstance(db, instanceId, items, history, mappings, now): StoreCounts`, `pruneItems(db): number`, `replaceDiskEntries(db, entries: { realPath; parent }[], now)`.
- Produces (`fetchers.ts`) : `fetchArr`, `fetchServer`, `listTopDirs`, `defaultSyncDeps: SyncDeps`.
- Produces (`runner.ts`) : `runSync(deps, db?, clock?): Promise<SyncState>`, `startSync(deps?): Promise<SyncState>` (renvoie la synchro en cours si elle existe), `getSyncState(db?)`, `resetSyncStateForTests()`. Appelle `invalidateCatalog()` à la fin (tâche 15 : jusque-là, importer depuis `../catalog` un module minimal — voir Step 5).
- Produces (`scheduler.ts`) : `DEFAULT_SYNC_CRON = '0 * * * *'`, `schedulerEnabled()`, `isValidCron(expr)`, `getSyncCron()`, `scheduleSync(run?)`, `stopScheduler()`, `nextSyncAt(): number | null`.
- Routes : `GET /api/sync → SyncStateDto`, `POST /api/sync → { started: true }`, `GET /api/settings/general → { mediaRoot, configDir, syncCron, nextSyncAt }`, `PUT /api/settings/sync { cron } → même forme`.

Règles de rapprochement (spec §4.3) : les instances *arr passent d'abord ; un élément Plex/Jellyfin est relié à un titre par son dossier réel (dossier réel d'une présence *arr), sinon par identifiant (films : TMDB puis IMDb ; séries : TVDB, TMDB puis IMDb), sinon il crée un titre « orphelin ». Une instance désactivée perd ses présences, fichiers et historique (elle reste configurée). Les titres sans aucune présence sont supprimés.

- [ ] **Step 1: Écrire les tests du stockage qui échouent**

`tests/unit/sync/store.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { itemKey, pruneItems, replaceDiskEntries, storeArrInstance, storeServerInstance } from '../../../server/lib/sync/store'
import type { ArrItemRecord, ServerItemRecord } from '../../../server/lib/sync/types'
import type { PathMapping } from '#shared/paths'
import { useTestDb } from '../../helpers/db'

const db = useTestDb()

function seedInstances() {
  const insert = db().prepare("INSERT INTO instances (kind, name, url, api_key_enc, created_at) VALUES (?, ?, 'http://x', 'k', 0)")
  insert.run('radarr', 'Radarr')  // id 1
  insert.run('plex', 'Plex')      // id 2
  insert.run('radarr', 'Radarr 4K') // id 3
}

const map = (instanceId: number, servicePath: string, realPath: string): PathMapping => ({ id: 0, instanceId, servicePath, realPath, managed: true })
const radarrMaps = [map(1, '/movies', '/media/movies')]
const plexMaps = [map(2, '/media', '/media')]

function movie(overrides: Partial<ArrItemRecord> = {}): ArrItemRecord {
  return {
    externalId: 7, type: 'movie', title: 'Dune', year: 2021, tmdbId: 438631, tvdbId: null, imdbId: 'tt1160419',
    originalLanguage: 'en', genres: ['SF'], ratingTmdb: 7.8, ratingImdb: 8, addedAt: 1000,
    servicePath: '/movies/Dune (2021)', rootFolder: '/movies', monitored: true, hasFile: true, size: 9000, tags: ['4k'],
    files: [{ externalId: 70, season: null, episode: null, servicePath: '/movies/Dune (2021)/Dune.mkv', size: 9000, resolution: 1080, videoCodec: 'hevc', audioLanguages: ['en'], subtitleLanguages: ['fr'], isRemux: false, runtimeSeconds: 9300 }],
    ...overrides,
  }
}

function plexItem(overrides: Partial<ServerItemRecord> = {}): ServerItemRecord {
  return { externalId: '10', type: 'movie', title: 'Dune', year: 2021, tmdbId: null, tvdbId: null, imdbId: null, servicePaths: ['/media/movies/Dune (2021)'], library: 'Movies', ...overrides }
}

const count = (table: string) => (db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('itemKey', () => {
  it('préfère TMDB pour un film et TVDB pour une série', () => {
    expect(itemKey({ type: 'movie', tmdbId: 1, tvdbId: null, imdbId: 'tt' }, 'x')).toBe('movie:tmdb:1')
    expect(itemKey({ type: 'series', tmdbId: 1, tvdbId: 2, imdbId: null }, 'x')).toBe('series:tvdb:2')
    expect(itemKey({ type: 'movie', tmdbId: null, tvdbId: null, imdbId: null }, 'path:/a')).toBe('movie:path:/a')
  })
})

describe('storeArrInstance', () => {
  it('écrit le titre, la présence et les fichiers avec les chemins réels', () => {
    seedInstances()
    expect(storeArrInstance(db(), 1, [movie()], radarrMaps, 5)).toEqual({ items: 1, files: 1, unmapped: 0 })
    expect(db().prepare('SELECT item_key, original_language, genres FROM items').get()).toEqual({ item_key: 'movie:tmdb:438631', original_language: 'en', genres: '["SF"]' })
    expect(db().prepare('SELECT real_folder, root_folder, monitored, tags FROM presences').get()).toEqual({ real_folder: '/media/movies/Dune (2021)', root_folder: '/movies', monitored: 1, tags: '["4k"]' })
    expect(db().prepare('SELECT real_path, audio_languages FROM files').get()).toEqual({ real_path: '/media/movies/Dune (2021)/Dune.mkv', audio_languages: '["en"]' })
  })

  it('remplace les données de l\'instance à chaque synchro sans changer l\'id du titre', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    storeArrInstance(db(), 1, [movie({ title: 'Dune: Part One' })], radarrMaps, 6)
    expect(count('presences')).toBe(1)
    expect(count('files')).toBe(1)
    expect(db().prepare('SELECT id, title FROM items').get()).toEqual({ id: 1, title: 'Dune: Part One' })
  })

  it('compte les chemins sans correspondance', () => {
    seedInstances()
    expect(storeArrInstance(db(), 1, [movie()], [], 5).unmapped).toBe(1)
  })

  it('réunit un même film géré par deux instances', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    storeArrInstance(db(), 3, [movie({ externalId: 99 })], [], 5)
    expect(count('items')).toBe(1)
    expect(count('presences')).toBe(2)
  })
})

describe('storeServerInstance', () => {
  it('relie un élément Plex par son dossier réel', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    storeServerInstance(db(), 2, [plexItem()], [], plexMaps, 6)
    expect(count('items')).toBe(1)
    expect(db().prepare('SELECT item_id, library, real_folder FROM presences WHERE instance_id = 2').get()).toEqual({ item_id: 1, library: 'Movies', real_folder: '/media/movies/Dune (2021)' })
  })

  it('relie par identifiant sans correspondance de chemin', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    expect(storeServerInstance(db(), 2, [plexItem({ tmdbId: 438631 })], [], [], 6)).toEqual({ items: 1, files: 0, unmapped: 1 })
    expect(count('items')).toBe(1)
  })

  it('crée un titre orphelin quand rien ne correspond', () => {
    seedInstances()
    storeServerInstance(db(), 2, [plexItem({ externalId: '11', title: 'Inconnu', servicePaths: ['/media/animes-extra/X'] })], [], plexMaps, 6)
    expect(db().prepare('SELECT item_key, title FROM items').get()).toEqual({ item_key: 'movie:path:/media/animes-extra/X', title: 'Inconnu' })
  })

  it('cumule l\'historique d\'un titre présent dans deux bibliothèques', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    storeServerInstance(db(), 2, [plexItem(), plexItem({ externalId: '12', library: 'Movies 4K' })], [
      { externalId: '10', user: 'alice', lastWatchedAt: 100, playCount: 1 },
      { externalId: '12', user: 'alice', lastWatchedAt: 300, playCount: 2 },
      { externalId: '404', user: 'alice', lastWatchedAt: 1, playCount: 1 },
    ], plexMaps, 6)
    expect(db().prepare('SELECT user, last_watched_at, play_count FROM watch_history').all()).toEqual([{ user: 'alice', last_watched_at: 300, play_count: 3 }])
  })
})

describe('nettoyage', () => {
  it('supprime les titres sans présence', () => {
    seedInstances()
    storeArrInstance(db(), 1, [movie()], radarrMaps, 5)
    storeArrInstance(db(), 1, [], radarrMaps, 6)
    expect(pruneItems(db())).toBe(1)
    expect(count('items')).toBe(0)
  })

  it('remplace les dossiers vus sur le disque', () => {
    replaceDiskEntries(db(), [{ realPath: '/media/movies/A', parent: '/media/movies' }], 1)
    replaceDiskEntries(db(), [{ realPath: '/media/movies/B', parent: '/media/movies' }], 2)
    expect(db().prepare('SELECT real_path, scanned_at FROM disk_entries').all()).toEqual([{ real_path: '/media/movies/B', scanned_at: 2 }])
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/sync/store.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Compléter `server/lib/sync/types.ts` et implémenter `store.ts`**

Ajouter à la fin de `server/lib/sync/types.ts` le bloc `StoreCounts` / `SyncDeps` donné dans **Interfaces** (avec l'import de type `InstanceSecret` en tête de fichier).

`server/lib/sync/store.ts` :

```ts
import type { PathMapping } from '#shared/paths'
import type { Db } from '../db'
import { tryReal } from '../paths'
import type { ArrItemRecord, HistoryRecord, MediaType, ServerItemRecord, StoreCounts } from './types'

interface Ids { type: MediaType; tmdbId: number | null; tvdbId: number | null; imdbId: string | null }

/** Clé stable d'un titre : identifiant externe d'abord, chemin en dernier recours. */
export function itemKey(r: Ids, fallback: string): string {
  if (r.type === 'movie') {
    if (r.tmdbId) return `movie:tmdb:${r.tmdbId}`
    if (r.imdbId) return `movie:imdb:${r.imdbId}`
  } else {
    if (r.tvdbId) return `series:tvdb:${r.tvdbId}`
    if (r.tmdbId) return `series:tmdb:${r.tmdbId}`
    if (r.imdbId) return `series:imdb:${r.imdbId}`
  }
  return `${r.type}:${fallback}`
}

function idCandidates(r: Ids): string[] {
  const keys = r.type === 'movie'
    ? [r.tmdbId && `tmdb:${r.tmdbId}`, r.imdbId && `imdb:${r.imdbId}`]
    : [r.tvdbId && `tvdb:${r.tvdbId}`, r.tmdbId && `tmdb:${r.tmdbId}`, r.imdbId && `imdb:${r.imdbId}`]
  return keys.filter((k): k is string => !!k).map(k => `${r.type}:${k}`)
}

const UPSERT_ARR_ITEM = `
  INSERT INTO items (item_key, type, title, year, tmdb_id, tvdb_id, imdb_id, original_language, genres, rating_tmdb, rating_imdb, added_at, updated_at)
  VALUES (@key, @type, @title, @year, @tmdbId, @tvdbId, @imdbId, @originalLanguage, @genres, @ratingTmdb, @ratingImdb, @addedAt, @now)
  ON CONFLICT(item_key) DO UPDATE SET
    title = excluded.title, year = excluded.year,
    tmdb_id = COALESCE(excluded.tmdb_id, items.tmdb_id), tvdb_id = COALESCE(excluded.tvdb_id, items.tvdb_id), imdb_id = COALESCE(excluded.imdb_id, items.imdb_id),
    original_language = COALESCE(excluded.original_language, items.original_language), genres = excluded.genres,
    rating_tmdb = COALESCE(excluded.rating_tmdb, items.rating_tmdb), rating_imdb = COALESCE(excluded.rating_imdb, items.rating_imdb),
    added_at = COALESCE(MIN(items.added_at, excluded.added_at), excluded.added_at, items.added_at),
    updated_at = excluded.updated_at
  RETURNING id`

const UPSERT_ORPHAN_ITEM = `
  INSERT INTO items (item_key, type, title, year, tmdb_id, tvdb_id, imdb_id, updated_at)
  VALUES (@key, @type, @title, @year, @tmdbId, @tvdbId, @imdbId, @now)
  ON CONFLICT(item_key) DO UPDATE SET updated_at = excluded.updated_at
  RETURNING id`

const INSERT_PRESENCE = `
  INSERT INTO presences (item_id, instance_id, external_id, library, root_folder, real_folder, monitored, has_file, size, tags, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const INSERT_FILE = `
  INSERT INTO files (item_id, instance_id, external_id, season, episode, real_path, size, resolution, video_codec, audio_languages, subtitle_languages, is_remux, runtime_seconds)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const UPSERT_HISTORY = `
  INSERT INTO watch_history (item_id, server_instance_id, user, last_watched_at, play_count) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(item_id, server_instance_id, user) DO UPDATE SET
    last_watched_at = NULLIF(MAX(COALESCE(watch_history.last_watched_at, 0), COALESCE(excluded.last_watched_at, 0)), 0),
    play_count = watch_history.play_count + excluded.play_count`

export function storeArrInstance(db: Db, instanceId: number, records: ArrItemRecord[], mappings: PathMapping[], now: number): StoreCounts {
  const counts: StoreCounts = { items: 0, files: 0, unmapped: 0 }
  const upsert = db.prepare(UPSERT_ARR_ITEM)
  const insertPresence = db.prepare(INSERT_PRESENCE)
  const insertFile = db.prepare(INSERT_FILE)
  db.transaction(() => {
    db.prepare('DELETE FROM files WHERE instance_id = ?').run(instanceId)
    db.prepare('DELETE FROM presences WHERE instance_id = ?').run(instanceId)
    for (const r of records) {
      const realFolder = tryReal(mappings, r.servicePath)
      if (realFolder === null) counts.unmapped++
      const { id } = upsert.get({
        key: itemKey(r, `path:${realFolder ?? `${instanceId}:${r.servicePath}`}`),
        type: r.type, title: r.title, year: r.year, tmdbId: r.tmdbId, tvdbId: r.tvdbId, imdbId: r.imdbId,
        originalLanguage: r.originalLanguage, genres: JSON.stringify(r.genres), ratingTmdb: r.ratingTmdb, ratingImdb: r.ratingImdb,
        addedAt: r.addedAt, now,
      }) as { id: number }
      insertPresence.run(id, instanceId, String(r.externalId), null, r.rootFolder, realFolder, r.monitored ? 1 : 0, r.hasFile ? 1 : 0, r.size, JSON.stringify(r.tags), now)
      for (const f of r.files) {
        insertFile.run(id, instanceId, f.externalId, f.season, f.episode, tryReal(mappings, f.servicePath), f.size, f.resolution, f.videoCodec,
          JSON.stringify(f.audioLanguages), JSON.stringify(f.subtitleLanguages), f.isRemux ? 1 : 0, f.runtimeSeconds)
        counts.files++
      }
      counts.items++
    }
  })()
  return counts
}

export function storeServerInstance(db: Db, instanceId: number, items: ServerItemRecord[], history: HistoryRecord[], mappings: PathMapping[], now: number): StoreCounts {
  const counts: StoreCounts = { items: 0, files: 0, unmapped: 0 }
  db.transaction(() => {
    db.prepare('DELETE FROM presences WHERE instance_id = ?').run(instanceId)
    db.prepare('DELETE FROM watch_history WHERE server_instance_id = ?').run(instanceId)

    const byFolder = new Map<string, number>()
    const folderRows = db.prepare(`SELECT p.real_folder AS folder, p.item_id AS itemId FROM presences p JOIN instances i ON i.id = p.instance_id
      WHERE i.kind IN ('radarr', 'sonarr') AND p.real_folder IS NOT NULL`).all() as { folder: string; itemId: number }[]
    for (const r of folderRows) byFolder.set(r.folder, r.itemId)

    const byId = new Map<string, number>()
    const idRows = db.prepare('SELECT id, type, tmdb_id, tvdb_id, imdb_id FROM items').all() as { id: number; type: MediaType; tmdb_id: number | null; tvdb_id: number | null; imdb_id: string | null }[]
    for (const r of idRows) {
      for (const key of idCandidates({ type: r.type, tmdbId: r.tmdb_id, tvdbId: r.tvdb_id, imdbId: r.imdb_id })) if (!byId.has(key)) byId.set(key, r.id)
    }

    const upsertOrphan = db.prepare(UPSERT_ORPHAN_ITEM)
    const insertPresence = db.prepare(INSERT_PRESENCE)
    const itemOf = new Map<string, number>()

    for (const it of items) {
      const folders = it.servicePaths.map(p => tryReal(mappings, p)).filter((p): p is string => p !== null)
      if (it.servicePaths.length > 0 && folders.length === 0) counts.unmapped++
      let itemId = folders.map(f => byFolder.get(f)).find((id): id is number => id !== undefined)
        ?? idCandidates(it).map(k => byId.get(k)).find((id): id is number => id !== undefined)
      if (itemId === undefined) {
        const fallback = folders[0] ? `path:${folders[0]}` : `server:${instanceId}:${it.externalId}`
        itemId = (upsertOrphan.get({ key: itemKey(it, fallback), type: it.type, title: it.title, year: it.year, tmdbId: it.tmdbId, tvdbId: it.tvdbId, imdbId: it.imdbId, now }) as { id: number }).id
        for (const key of idCandidates(it)) byId.set(key, itemId)
        for (const f of folders) byFolder.set(f, itemId)
      }
      insertPresence.run(itemId, instanceId, it.externalId, it.library, null, folders[0] ?? null, null, null, null, '[]', now)
      itemOf.set(it.externalId, itemId)
      counts.items++
    }

    const upsertHistory = db.prepare(UPSERT_HISTORY)
    for (const h of history) {
      const itemId = itemOf.get(h.externalId)
      if (itemId !== undefined) upsertHistory.run(itemId, instanceId, h.user, h.lastWatchedAt, h.playCount)
    }
  })()
  return counts
}

export function pruneItems(db: Db): number {
  return db.prepare('DELETE FROM items WHERE NOT EXISTS (SELECT 1 FROM presences p WHERE p.item_id = items.id)').run().changes
}

export function replaceDiskEntries(db: Db, entries: { realPath: string; parent: string }[], now: number): void {
  db.transaction(() => {
    db.prepare('DELETE FROM disk_entries').run()
    const insert = db.prepare('INSERT OR IGNORE INTO disk_entries (real_path, parent_real_path, scanned_at) VALUES (?, ?, ?)')
    for (const e of entries) insert.run(e.realPath, e.parent, now)
  })()
}
```

- [ ] **Step 4: Lancer les tests du stockage**

Run: `npx vitest run tests/unit/sync/store.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Écrire les tests du runner et du planificateur qui échouent**

Créer d'abord un module catalogue minimal, complété à la tâche 15 — `server/lib/catalog.ts` :

```ts
let version = 0

/** Appelé après chaque synchro : le catalogue en mémoire devra être recalculé. */
export function invalidateCatalog(): void {
  version++
}

export function catalogVersion(): number {
  return version
}
```

`tests/unit/sync/runner.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInstance, getInstance, updateInstance } from '../../../server/lib/instances'
import { getSyncState, resetSyncStateForTests, runSync, startSync } from '../../../server/lib/sync/runner'
import type { SyncDeps } from '../../../server/lib/sync/types'
import { catalogVersion } from '../../../server/lib/catalog'
import { useTestDb } from '../../helpers/db'

const db = useTestDb()
beforeEach(() => resetSyncStateForTests())

const record = { externalId: 1, type: 'movie' as const, title: 'Dune', year: 2021, tmdbId: 1, tvdbId: null, imdbId: null, originalLanguage: 'en', genres: [], ratingTmdb: null, ratingImdb: null, addedAt: null, servicePath: '/movies/Dune', rootFolder: '/movies', monitored: true, hasFile: true, size: 1, tags: [], files: [] }

function deps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    fetchArr: vi.fn(async () => ({ version: '6.4.4', records: [record] })),
    fetchServer: vi.fn(async () => ({ version: '1.41', items: [{ externalId: 'p1', type: 'movie' as const, title: 'Dune', year: 2021, tmdbId: 1, tvdbId: null, imdbId: null, servicePaths: [], library: 'Movies' }], history: [] })),
    listTopDirs: vi.fn(() => []),
    ...overrides,
  }
}

function setup() {
  createInstance({ kind: 'plex', name: 'Plex', url: 'http://p', apiKey: 'k', enabled: true })
  createInstance({ kind: 'radarr', name: 'Radarr', url: 'http://r', apiKey: 'k', enabled: true })
}

describe('runSync', () => {
  it('synchronise les *arr avant les serveurs et met les statuts à jour', async () => {
    setup()
    const order: string[] = []
    const d = deps({
      fetchArr: vi.fn(async (s) => { order.push(s.name); return { version: '6.4.4', records: [record] } }),
      fetchServer: vi.fn(async (s) => { order.push(s.name); return { version: '1.41', items: [], history: [] } }),
    })
    const before = catalogVersion()
    const state = await runSync(d, db(), () => 1000)
    expect(order).toEqual(['Radarr', 'Plex'])
    expect(state).toMatchObject({ running: false, startedAt: 1000, finishedAt: 1000 })
    expect(state.results.map(r => [r.name, r.ok, r.items])).toEqual([['Radarr', true, 1], ['Plex', true, 0]])
    expect(getInstance(2)).toMatchObject({ lastStatus: 'ok', version: '6.4.4', lastSyncAt: 1000 })
    expect(catalogVersion()).toBeGreaterThan(before)
  })

  it('marque « erreur » la première fois puis « périmée » en gardant les données', async () => {
    setup()
    const failing = deps({ fetchArr: vi.fn(async () => { throw new Error('Service injoignable') }) })
    await runSync(failing, db())
    expect(getInstance(2)).toMatchObject({ lastStatus: 'erreur', lastError: 'Service injoignable' })
    await runSync(deps(), db())
    await runSync(failing, db())
    expect(getInstance(2)!.lastStatus).toBe('perime')
    expect((db().prepare('SELECT COUNT(*) AS n FROM presences WHERE instance_id = 2').get() as { n: number }).n).toBe(1)
  })

  it('retire les données d\'une instance désactivée', async () => {
    setup()
    await runSync(deps(), db())
    updateInstance(2, { name: 'Radarr', url: 'http://r', enabled: false })
    const d = deps()
    await runSync(d, db())
    expect(d.fetchArr).not.toHaveBeenCalled()
    expect((db().prepare('SELECT COUNT(*) AS n FROM presences WHERE instance_id = 2').get() as { n: number }).n).toBe(0)
  })

  it('enregistre les dossiers vus sur le disque', async () => {
    setup()
    db().prepare("INSERT INTO path_mappings (instance_id, service_path, real_path, managed) VALUES (2, '/movies', '/media/movies', 1)").run()
    await runSync(deps({ listTopDirs: () => ['/media/movies/A', '/media/movies/B'] }), db())
    expect((db().prepare('SELECT COUNT(*) AS n FROM disk_entries').get() as { n: number }).n).toBe(2)
  })

  it('garde le dernier état après un redémarrage', async () => {
    setup()
    await runSync(deps(), db(), () => 42)
    resetSyncStateForTests()
    expect(getSyncState(db())).toMatchObject({ running: false, finishedAt: 42 })
  })
})

describe('startSync', () => {
  it('ne lance pas deux synchros en même temps', async () => {
    setup()
    let release!: () => void
    const blocked = new Promise<void>(r => { release = r })
    const d = deps({ fetchArr: vi.fn(async () => { await blocked; return { version: '1', records: [] } }) })
    const first = startSync(d)
    const second = startSync(d)
    expect(second).toBe(first)
    release()
    await first
    expect(d.fetchArr).toHaveBeenCalledTimes(1)
  })
})
```

`tests/unit/scheduler.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SYNC_CRON, getSyncCron, isValidCron } from '../../server/lib/scheduler'
import { setSetting } from '../../server/lib/settings'
import { useTestDb } from '../helpers/db'

useTestDb()

describe('scheduler', () => {
  it('valide les expressions cron', () => {
    expect(isValidCron('0 * * * *')).toBe(true)
    expect(isValidCron('0 */6 * * *')).toBe(true)
    expect(isValidCron('toutes les heures')).toBe(false)
  })

  it('lit le cron enregistré ou le défaut', () => {
    expect(getSyncCron()).toBe(DEFAULT_SYNC_CRON)
    setSetting('sync_cron', '0 4 * * *')
    expect(getSyncCron()).toBe('0 4 * * *')
  })
})
```

- [ ] **Step 6: Lancer les tests pour vérifier qu'ils échouent**

Run: `npx vitest run tests/unit/sync/runner.test.ts tests/unit/scheduler.test.ts`
Expected: FAIL — modules introuvables.

- [ ] **Step 7: Implémenter**

`shared/sync.ts` :

```ts
export interface SyncInstanceResult {
  instanceId: number
  name: string
  ok: boolean
  error: string | null
  items: number
  files: number
  unmapped: number
  durationMs: number
}

export interface SyncState {
  running: boolean
  startedAt: number | null
  finishedAt: number | null
  results: SyncInstanceResult[]
}

export type SyncStateDto = SyncState & { nextRunAt: number | null }
```

`server/lib/sync/fetchers.ts` :

```ts
import fs from 'node:fs'
import path from 'node:path'
import { arrStatus, arrTags, mapRadarrMovie, mapSonarrSeries, radarrMovies, sonarrEpisodeFiles, sonarrEpisodes, sonarrSeries } from '../../connectors/arr'
import { aggregateJellyfinPlayed, jellyfinInfo, jellyfinLibraries, jellyfinLibraryItems, jellyfinPlayed, jellyfinUsers, mapJellyfinItem } from '../../connectors/jellyfin'
import { aggregatePlexHistory, mapPlexItem, plexAccounts, plexHistory, plexIdentity, plexMetadata, plexSectionItems, plexSections } from '../../connectors/plex'
import { mapLimit } from '../concurrency'
import type { InstanceSecret } from '../instances'
import type { ServerItemRecord, SyncDeps } from './types'

export async function fetchArr(s: InstanceSecret) {
  const c = { url: s.url, apiKey: s.apiKey }
  const [status, tags] = await Promise.all([arrStatus(c), arrTags(c)])
  if (s.kind === 'radarr') {
    const movies = await radarrMovies(c)
    return { version: status.version, records: movies.map(m => mapRadarrMovie(m, tags)) }
  }
  const series = await sonarrSeries(c)
  const records = await mapLimit(series, 4, async (sr) => {
    const [episodes, files] = await Promise.all([sonarrEpisodes(c, sr.id), sonarrEpisodeFiles(c, sr.id)])
    return mapSonarrSeries(sr, episodes, files, tags)
  })
  return { version: status.version, records }
}

async function fetchPlex(s: InstanceSecret) {
  const c = { url: s.url, token: s.apiKey }
  const identity = await plexIdentity(c)
  const sections = (await plexSections(c)).filter(x => x.type === 'movie' || x.type === 'show')
  const items: ServerItemRecord[] = []
  for (const section of sections) {
    const metas = await plexSectionItems(c, section.key)
    // Le listing d'une section de séries ne donne pas toujours leur dossier : on le complète.
    const complete = await mapLimit(metas, 6, async m => (m.type === 'show' && !m.Location?.length ? (await plexMetadata(c, m.ratingKey)) ?? m : m))
    items.push(...complete.map(m => mapPlexItem(m, section.title)))
  }
  const [history, accounts] = await Promise.all([plexHistory(c), plexAccounts(c)])
  return { version: identity.version, items, history: aggregatePlexHistory(history, accounts) }
}

async function fetchJellyfin(s: InstanceSecret) {
  const c = { url: s.url, apiKey: s.apiKey }
  const info = await jellyfinInfo(c)
  const libraries = (await jellyfinLibraries(c)).filter(l => l.collectionType === 'movies' || l.collectionType === 'tvshows')
  const items: ServerItemRecord[] = []
  for (const library of libraries) {
    items.push(...(await jellyfinLibraryItems(c, library.id)).map(it => mapJellyfinItem(it, library.name)))
  }
  const users = await jellyfinUsers(c)
  const perUser = await mapLimit(users, 3, async u => ({ user: u.name, items: await jellyfinPlayed(c, u.id) }))
  return { version: info.version, items, history: aggregateJellyfinPlayed(perUser) }
}

export function fetchServer(s: InstanceSecret) {
  return s.kind === 'plex' ? fetchPlex(s) : fetchJellyfin(s)
}

/** Sous-dossiers directs (hors dossiers cachés), en chemins complets ; [] si illisible. */
export function listTopDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => path.posix.join(dir, d.name))
  } catch {
    return []
  }
}

export const defaultSyncDeps: SyncDeps = { fetchArr, fetchServer, listTopDirs }
```

`server/lib/sync/runner.ts` :

```ts
import { isArrKind, type InstanceDto } from '#shared/instances'
import type { SyncInstanceResult, SyncState } from '#shared/sync'
import { invalidateCatalog } from '../catalog'
import { getDb, type Db } from '../db'
import { getInstanceSecret, listInstances, setInstanceStatus } from '../instances'
import { listMappings } from '../paths'
import { getSetting, setSetting } from '../settings'
import { defaultSyncDeps } from './fetchers'
import { pruneItems, replaceDiskEntries, storeArrInstance, storeServerInstance } from './store'
import type { StoreCounts, SyncDeps } from './types'

const IDLE: SyncState = { running: false, startedAt: null, finishedAt: null, results: [] }

let state: SyncState = { ...IDLE }
let loaded = false
let current: Promise<SyncState> | null = null

export function getSyncState(db: Db = getDb()): SyncState {
  if (!loaded) {
    loaded = true
    const saved = getSetting('last_sync', db)
    if (saved) {
      try { state = { ...(JSON.parse(saved) as SyncState), running: false } } catch { /* état illisible : on repart de zéro */ }
    }
  }
  return state
}

export function resetSyncStateForTests(): void {
  state = { ...IDLE }
  loaded = false
  current = null
}

/** Lance une synchro, ou renvoie celle qui tourne déjà. */
export function startSync(deps: SyncDeps = defaultSyncDeps): Promise<SyncState> {
  current ??= runSync(deps)
    .catch((error) => {
      console.error('Sortarr : la synchro a échoué', error)
      state = { ...state, running: false, finishedAt: Date.now() }
      return state
    })
    .finally(() => { current = null })
  return current
}

async function syncOne(instance: InstanceDto, deps: SyncDeps, db: Db, clock: () => number): Promise<SyncInstanceResult> {
  const started = clock()
  const base = { instanceId: instance.id, name: instance.name }
  try {
    const secret = getInstanceSecret(instance.id, db)
    if (!secret) throw new Error('Instance introuvable.')
    const mappings = listMappings(instance.id, db)
    let counts: StoreCounts
    let version: string
    if (isArrKind(secret.kind)) {
      const r = await deps.fetchArr(secret)
      version = r.version
      counts = storeArrInstance(db, instance.id, r.records, mappings, clock())
    } else {
      const r = await deps.fetchServer(secret)
      version = r.version
      counts = storeServerInstance(db, instance.id, r.items, r.history, mappings, clock())
    }
    setInstanceStatus(instance.id, { status: 'ok', error: null, version, syncedAt: clock() }, db)
    return { ...base, ok: true, error: null, ...counts, durationMs: clock() - started }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setInstanceStatus(instance.id, { status: instance.lastSyncAt ? 'perime' : 'erreur', error: message }, db)
    return { ...base, ok: false, error: message, items: 0, files: 0, unmapped: 0, durationMs: clock() - started }
  }
}

function scanDisk(db: Db, deps: SyncDeps, now: number): void {
  const roots = db.prepare(`SELECT DISTINCT m.real_path AS realPath FROM path_mappings m JOIN instances i ON i.id = m.instance_id
    WHERE m.managed = 1 AND i.enabled = 1 AND i.kind IN ('radarr', 'sonarr')`).all() as { realPath: string }[]
  replaceDiskEntries(db, roots.flatMap(r => deps.listTopDirs(r.realPath).map(realPath => ({ realPath, parent: r.realPath }))), now)
}

export async function runSync(deps: SyncDeps, db: Db = getDb(), clock: () => number = Date.now): Promise<SyncState> {
  getSyncState(db)
  state = { running: true, startedAt: clock(), finishedAt: null, results: [] }
  const all = listInstances(db)

  db.transaction(() => {
    for (const i of all.filter(x => !x.enabled)) {
      db.prepare('DELETE FROM presences WHERE instance_id = ?').run(i.id)
      db.prepare('DELETE FROM files WHERE instance_id = ?').run(i.id)
      db.prepare('DELETE FROM watch_history WHERE server_instance_id = ?').run(i.id)
    }
  })()

  const enabled = all.filter(i => i.enabled)
  const ordered = [...enabled.filter(i => isArrKind(i.kind)), ...enabled.filter(i => !isArrKind(i.kind))]
  for (const instance of ordered) state.results.push(await syncOne(instance, deps, db, clock))

  pruneItems(db)
  scanDisk(db, deps, clock())
  invalidateCatalog()
  state = { ...state, running: false, finishedAt: clock() }
  setSetting('last_sync', JSON.stringify(state), db)
  return state
}
```

`server/lib/scheduler.ts` :

```ts
import { Cron } from 'croner'
import { getSetting } from './settings'
import { startSync } from './sync/runner'

export const DEFAULT_SYNC_CRON = '0 * * * *'

let job: Cron | null = null

export function schedulerEnabled(): boolean {
  return process.env.SORTARR_DISABLE_SCHEDULER !== '1'
}

export function isValidCron(expr: string): boolean {
  try {
    new Cron(expr, { paused: true }).stop()
    return true
  } catch {
    return false
  }
}

export function getSyncCron(): string {
  return getSetting('sync_cron') ?? DEFAULT_SYNC_CRON
}

/** (Re)programme la synchro selon le cron enregistré. */
export function scheduleSync(run: () => unknown = () => startSync()): void {
  job?.stop()
  job = new Cron(getSyncCron(), { protect: true, timezone: process.env.TZ || undefined }, () => { void run() })
}

export function stopScheduler(): void {
  job?.stop()
  job = null
}

export function nextSyncAt(): number | null {
  return job?.nextRun()?.getTime() ?? null
}
```

`server/plugins/scheduler.ts` :

```ts
import { scheduleSync, schedulerEnabled, stopScheduler } from '../lib/scheduler'

export default defineNitroPlugin((nitro) => {
  if (!schedulerEnabled()) return
  scheduleSync()
  nitro.hooks.hook('close', () => stopScheduler())
})
```

`server/api/sync/index.get.ts` :

```ts
import type { SyncStateDto } from '#shared/sync'
import { defineApiHandler } from '~~/server/lib/api'
import { nextSyncAt } from '~~/server/lib/scheduler'
import { getSyncState } from '~~/server/lib/sync/runner'

export default defineApiHandler((): SyncStateDto => ({ ...getSyncState(), nextRunAt: nextSyncAt() }))
```

`server/api/sync/index.post.ts` :

```ts
import { defineApiHandler } from '~~/server/lib/api'
import { startSync } from '~~/server/lib/sync/runner'

export default defineApiHandler(() => {
  void startSync()
  return { started: true }
})
```

`server/api/settings/general.get.ts` :

```ts
import { defineApiHandler } from '~~/server/lib/api'
import { configDir, mediaRoot } from '~~/server/lib/config'
import { getSyncCron, nextSyncAt } from '~~/server/lib/scheduler'

export default defineApiHandler(() => ({ mediaRoot: mediaRoot(), configDir: configDir(), syncCron: getSyncCron(), nextSyncAt: nextSyncAt() }))
```

`server/api/settings/sync.put.ts` :

```ts
import { z } from 'zod'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { configDir, mediaRoot } from '~~/server/lib/config'
import { AppError } from '~~/server/lib/errors'
import { getSyncCron, isValidCron, nextSyncAt, scheduleSync, schedulerEnabled } from '~~/server/lib/scheduler'
import { setSetting } from '~~/server/lib/settings'

const schema = z.object({ cron: z.string().trim().min(1, 'Expression cron obligatoire') })

export default defineApiHandler(async (event) => {
  const { cron } = parseOrThrow(schema, await readBody(event))
  if (!isValidCron(cron)) throw new AppError('Expression cron invalide (ex : 0 * * * * pour toutes les heures).')
  setSetting('sync_cron', cron)
  if (schedulerEnabled()) scheduleSync()
  return { mediaRoot: mediaRoot(), configDir: configDir(), syncCron: getSyncCron(), nextSyncAt: nextSyncAt() }
})
```

- [ ] **Step 8: Lancer tous les tests et le typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: synchronisation du catalogue et planification"
```

---

### Task 14: Moteur de filtres

**Files:**
- Create: `shared/filters.ts`
- Test: `tests/unit/filters.test.ts`

**Interfaces:**
- Produces:
  - `FIELD_KEYS` (tuple), `type FilterField`, `type FieldType = 'string' | 'number' | 'date' | 'list' | 'boolean' | 'enum'`.
  - `interface CatalogRow { id; type: 'movie' | 'series'; title; year; originalLanguage; genres; ratingTmdb; ratingImdb; addedAt; sizeGb; resolution; videoCodecs; audioLanguages; subtitleLanguages; isRemux; instances: string[] (ids *arr); servers: string[] (ids Plex/Jellyfin); libraries; rootFolders; tags; monitored; hasFile; neverWatched; lastWatchedAt; playCount }`.
  - `interface FieldDef { key: FilterField; label: string; type: FieldType; options?: { value: string; label: string }[]; dynamicOptions?: boolean; unit?: string }`, `FIELDS: FieldDef[]`, `FIELD_BY_KEY`.
  - `type Op`, `type ValueKind = 'none' | 'single' | 'pair' | 'multi' | 'days' | 'date'`, `OPERATORS: Record<FieldType, { op: Op; label: string; value: ValueKind }[]>`.
  - `type FilterValue = string | number | boolean | (string | number)[] | null | undefined`, `FilterCondition`, `FilterGroup`, `FilterNode`, `filterNodeSchema` (Zod, récursif), `emptyFilter(): FilterGroup`.
  - `validateFilter(node): string[]` (messages en français, vide si valide), `matches(row, node, now = Date.now()): boolean`, `defaultValue(field, kind)`, `defaultCondition(field)`.

Sémantique : groupe vide = vrai ; comparaisons de texte insensibles à la casse et aux accents ; une valeur absente (null) ne satisfait que « est vide / inconnu ». Langues audio et sous-titres d'une série = langues présentes dans **tous** ses fichiers (tâche 15).

- [ ] **Step 1: Écrire le test qui échoue**

`tests/unit/filters.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { defaultCondition, emptyFilter, FIELDS, FIELD_BY_KEY, filterNodeSchema, matches, OPERATORS, validateFilter, type CatalogRow, type FilterNode } from '#shared/filters'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 24)

const row: CatalogRow = {
  id: 1, type: 'movie', title: 'Le Fabuleux Destin d’Amélie Poulain', year: 2001, originalLanguage: 'fr', genres: ['Comédie', 'Romance'],
  ratingTmdb: 7.9, ratingImdb: 8.3, addedAt: NOW - 400 * DAY, sizeGb: 12.5, resolution: 1080, videoCodecs: ['h264'],
  audioLanguages: ['fr'], subtitleLanguages: [], isRemux: false, instances: ['1'], servers: ['3'], libraries: ['Movies'],
  rootFolders: ['/movies'], tags: [], monitored: true, hasFile: true, neverWatched: false, lastWatchedAt: NOW - 200 * DAY, playCount: 2,
}

const cond = (field: string, op: string, value?: unknown): FilterNode => ({ kind: 'cond', field, op, value } as FilterNode)
const and = (...children: FilterNode[]): FilterNode => ({ kind: 'group', mode: 'and', children })
const or = (...children: FilterNode[]): FilterNode => ({ kind: 'group', mode: 'or', children })
const m = (node: FilterNode) => matches(row, node, NOW)

describe('matches', () => {
  it('accepte tout avec un groupe vide', () => {
    expect(m(emptyFilter())).toBe(true)
  })

  it('compare le texte sans casse ni accents', () => {
    expect(m(cond('title', 'contains', 'amelie'))).toBe(true)
    expect(m(cond('title', 'not_contains', 'AMÉLIE'))).toBe(false)
    expect(m(cond('originalLanguage', 'eq', 'FR'))).toBe(true)
    expect(m(cond('originalLanguage', 'in', ['en', 'fr']))).toBe(true)
  })

  it('compare les nombres et ignore les valeurs absentes', () => {
    expect(m(cond('sizeGb', 'gt', 10))).toBe(true)
    expect(m(cond('resolution', 'lt', 1080))).toBe(false)
    expect(m(cond('year', 'between', [2000, 2005]))).toBe(true)
    expect(matches({ ...row, ratingImdb: null }, cond('ratingImdb', 'lt', 5), NOW)).toBe(false)
    expect(matches({ ...row, ratingImdb: null }, cond('ratingImdb', 'empty'), NOW)).toBe(true)
  })

  it('gère les dates relatives', () => {
    expect(m(cond('addedAt', 'older_than_days', 365))).toBe(true)
    expect(m(cond('lastWatchedAt', 'newer_than_days', 180))).toBe(false)
    expect(m(cond('addedAt', 'before', '2026-01-01'))).toBe(true)
    expect(matches({ ...row, lastWatchedAt: null }, cond('lastWatchedAt', 'older_than_days', 1), NOW)).toBe(false)
  })

  it('gère les listes', () => {
    expect(m(cond('genres', 'includes', 'romance'))).toBe(true)
    expect(m(cond('audioLanguages', 'excludes', 'en'))).toBe(true)
    expect(m(cond('genres', 'includes_all', ['Comédie', 'Drame']))).toBe(false)
    expect(m(cond('genres', 'includes_any', ['Comédie', 'Drame']))).toBe(true)
    expect(m(cond('subtitleLanguages', 'empty'))).toBe(true)
  })

  it('gère les booléens et les groupes imbriqués', () => {
    expect(m(cond('isRemux', 'is_false'))).toBe(true)
    expect(m(and(cond('type', 'eq', 'movie'), or(cond('sizeGb', 'gt', 50), cond('neverWatched', 'is_false'))))).toBe(true)
    expect(m(and(cond('type', 'eq', 'series'), cond('sizeGb', 'gt', 1)))).toBe(false)
  })
})

describe('validation', () => {
  it('accepte un filtre valide', () => {
    expect(validateFilter(and(cond('sizeGb', 'gt', 50), cond('lastWatchedAt', 'older_than_days', 365)))).toEqual([])
  })

  it('refuse un opérateur incompatible avec le champ', () => {
    expect(validateFilter(cond('sizeGb', 'contains', 'x'))).toEqual(['Taille : opérateur « contains » non disponible'])
  })

  it('refuse une valeur manquante ou mal formée', () => {
    expect(validateFilter(cond('sizeGb', 'gt', 'beaucoup'))).toEqual(['Taille : nombre attendu'])
    expect(validateFilter(cond('genres', 'includes_any', []))).toEqual(['Genres : choisis au moins une valeur'])
    expect(validateFilter(cond('year', 'between', [2000]))).toEqual(['Année : deux nombres attendus'])
    expect(validateFilter(cond('addedAt', 'before', 'hier'))).toEqual(["Date d'ajout : date invalide"])
  })

  it('limite la profondeur', () => {
    const deep = and(and(and(and(and(and(cond('year', 'gt', 1)))))))
    expect(validateFilter(deep)).toEqual(['Filtre trop imbriqué (5 niveaux maximum)'])
  })

  it('valide la forme avec Zod', () => {
    expect(filterNodeSchema.safeParse(and(cond('year', 'gt', 2000))).success).toBe(true)
    expect(filterNodeSchema.safeParse({ kind: 'cond', field: 'inconnu', op: 'eq', value: 1 }).success).toBe(false)
  })
})

describe('registre', () => {
  it('a un opérateur par défaut valide pour chaque champ', () => {
    for (const field of FIELDS) {
      expect(OPERATORS[field.type].length).toBeGreaterThan(0)
      // Texte libre et choix dynamiques : la valeur par défaut est vide, l'utilisateur doit la saisir.
      const needsInput = field.type === 'string' || field.dynamicOptions === true
      if (!needsInput) expect(validateFilter(defaultCondition(field))).toEqual([])
    }
    expect(FIELD_BY_KEY.sizeGb.unit).toBe('Go')
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/filters.test.ts`
Expected: FAIL — `Failed to resolve import "#shared/filters"`.

- [ ] **Step 3: Implémenter `shared/filters.ts`**

```ts
import { z } from 'zod'

export const FIELD_KEYS = [
  'type', 'title', 'year', 'originalLanguage', 'genres', 'ratingTmdb', 'ratingImdb', 'addedAt', 'sizeGb', 'resolution',
  'videoCodecs', 'audioLanguages', 'subtitleLanguages', 'isRemux', 'instances', 'servers', 'libraries', 'rootFolders', 'tags',
  'monitored', 'hasFile', 'neverWatched', 'lastWatchedAt', 'playCount',
] as const
export type FilterField = typeof FIELD_KEYS[number]

export type FieldType = 'string' | 'number' | 'date' | 'list' | 'boolean' | 'enum'

export interface CatalogRow {
  id: number
  type: 'movie' | 'series'
  title: string
  year: number | null
  originalLanguage: string | null
  genres: string[]
  ratingTmdb: number | null
  ratingImdb: number | null
  addedAt: number | null
  sizeGb: number
  resolution: number | null
  videoCodecs: string[]
  audioLanguages: string[]
  subtitleLanguages: string[]
  isRemux: boolean
  instances: string[]
  servers: string[]
  libraries: string[]
  rootFolders: string[]
  tags: string[]
  monitored: boolean
  hasFile: boolean
  neverWatched: boolean
  lastWatchedAt: number | null
  playCount: number
}

// Erreur de compilation si un champ filtrable manque dans CatalogRow.
type _RowHasEveryField = CatalogRow[FilterField]

export interface FieldDef {
  key: FilterField
  label: string
  type: FieldType
  options?: { value: string; label: string }[]
  dynamicOptions?: boolean
  unit?: string
}

export const FIELDS: FieldDef[] = [
  { key: 'type', label: 'Type', type: 'enum', options: [{ value: 'movie', label: 'Film' }, { value: 'series', label: 'Série' }] },
  { key: 'title', label: 'Titre', type: 'string' },
  { key: 'year', label: 'Année', type: 'number' },
  { key: 'originalLanguage', label: 'Langue originale', type: 'enum', dynamicOptions: true },
  { key: 'genres', label: 'Genres', type: 'list', dynamicOptions: true },
  { key: 'ratingTmdb', label: 'Note TMDB', type: 'number' },
  { key: 'ratingImdb', label: 'Note IMDb', type: 'number' },
  { key: 'addedAt', label: "Date d'ajout", type: 'date' },
  { key: 'sizeGb', label: 'Taille', type: 'number', unit: 'Go' },
  { key: 'resolution', label: 'Résolution (la plus basse)', type: 'number', options: [480, 720, 1080, 2160].map(r => ({ value: String(r), label: r === 2160 ? '4K' : `${r}p` })) },
  { key: 'videoCodecs', label: 'Codecs vidéo', type: 'list', dynamicOptions: true },
  { key: 'audioLanguages', label: 'Langues audio', type: 'list', dynamicOptions: true },
  { key: 'subtitleLanguages', label: 'Sous-titres', type: 'list', dynamicOptions: true },
  { key: 'isRemux', label: 'Remux', type: 'boolean' },
  { key: 'instances', label: 'Instance *arr', type: 'list', dynamicOptions: true },
  { key: 'servers', label: 'Serveur média', type: 'list', dynamicOptions: true },
  { key: 'libraries', label: 'Bibliothèque', type: 'list', dynamicOptions: true },
  { key: 'rootFolders', label: 'Dossier racine', type: 'list', dynamicOptions: true },
  { key: 'tags', label: 'Tags *arr', type: 'list', dynamicOptions: true },
  { key: 'monitored', label: 'Suivi', type: 'boolean' },
  { key: 'hasFile', label: 'A un fichier', type: 'boolean' },
  { key: 'neverWatched', label: 'Jamais vu', type: 'boolean' },
  { key: 'lastWatchedAt', label: 'Dernier visionnage', type: 'date' },
  { key: 'playCount', label: 'Nombre de lectures', type: 'number' },
]

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f])) as Record<FilterField, FieldDef>

export const ALL_OPS = [
  'eq', 'neq', 'contains', 'not_contains', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'between',
  'older_than_days', 'newer_than_days', 'before', 'after', 'includes', 'excludes', 'includes_any', 'includes_all',
  'is_true', 'is_false', 'empty', 'not_empty',
] as const
export type Op = typeof ALL_OPS[number]
export type ValueKind = 'none' | 'single' | 'pair' | 'multi' | 'days' | 'date'

const EMPTY_OPS = (emptyLabel: string, notEmptyLabel: string) => [
  { op: 'empty' as const, label: emptyLabel, value: 'none' as const },
  { op: 'not_empty' as const, label: notEmptyLabel, value: 'none' as const },
]

export const OPERATORS: Record<FieldType, { op: Op; label: string; value: ValueKind }[]> = {
  string: [
    { op: 'contains', label: 'contient', value: 'single' },
    { op: 'not_contains', label: 'ne contient pas', value: 'single' },
    { op: 'eq', label: 'est', value: 'single' },
    { op: 'neq', label: "n'est pas", value: 'single' },
    ...EMPTY_OPS('est vide', "n'est pas vide"),
  ],
  enum: [
    { op: 'eq', label: 'est', value: 'single' },
    { op: 'neq', label: "n'est pas", value: 'single' },
    { op: 'in', label: 'est parmi', value: 'multi' },
    { op: 'not_in', label: "n'est pas parmi", value: 'multi' },
    ...EMPTY_OPS('est inconnu', 'est connu'),
  ],
  number: [
    { op: 'gt', label: '>', value: 'single' },
    { op: 'gte', label: '≥', value: 'single' },
    { op: 'lt', label: '<', value: 'single' },
    { op: 'lte', label: '≤', value: 'single' },
    { op: 'eq', label: '=', value: 'single' },
    { op: 'neq', label: '≠', value: 'single' },
    { op: 'between', label: 'entre', value: 'pair' },
    ...EMPTY_OPS('est inconnu', 'est connu'),
  ],
  date: [
    { op: 'older_than_days', label: 'il y a plus de', value: 'days' },
    { op: 'newer_than_days', label: 'il y a moins de', value: 'days' },
    { op: 'before', label: 'avant le', value: 'date' },
    { op: 'after', label: 'après le', value: 'date' },
    ...EMPTY_OPS('jamais / inconnue', 'renseignée'),
  ],
  list: [
    { op: 'includes', label: 'contient', value: 'single' },
    { op: 'excludes', label: 'ne contient pas', value: 'single' },
    { op: 'includes_any', label: 'contient au moins un de', value: 'multi' },
    { op: 'includes_all', label: 'contient tous', value: 'multi' },
    ...EMPTY_OPS('est vide', "n'est pas vide"),
  ],
  boolean: [
    { op: 'is_true', label: 'oui', value: 'none' },
    { op: 'is_false', label: 'non', value: 'none' },
  ],
}

export type FilterValue = string | number | boolean | (string | number)[] | null | undefined
export interface FilterCondition { kind: 'cond'; field: FilterField; op: Op; value?: FilterValue }
export interface FilterGroup { kind: 'group'; mode: 'and' | 'or'; children: FilterNode[] }
export type FilterNode = FilterCondition | FilterGroup

const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])), z.null()]).optional()

export const filterNodeSchema: z.ZodType<FilterNode> = z.lazy(() => z.union([
  z.object({ kind: z.literal('cond'), field: z.enum(FIELD_KEYS), op: z.enum(ALL_OPS), value: valueSchema }),
  z.object({ kind: z.literal('group'), mode: z.enum(['and', 'or']), children: z.array(filterNodeSchema).max(50) }),
]))

export function emptyFilter(): FilterGroup {
  return { kind: 'group', mode: 'and', children: [] }
}

const MAX_DEPTH = 5

export function validateFilter(node: FilterNode, depth = 0): string[] {
  if (node.kind === 'group') {
    if (depth >= MAX_DEPTH) return [`Filtre trop imbriqué (${MAX_DEPTH} niveaux maximum)`]
    return node.children.flatMap(c => validateFilter(c, depth + 1))
  }
  const field = FIELD_BY_KEY[node.field]
  if (!field) return [`Champ inconnu : ${node.field}`]
  const def = OPERATORS[field.type].find(o => o.op === node.op)
  if (!def) return [`${field.label} : opérateur « ${node.op} » non disponible`]
  const v = node.value
  const isNumber = (x: unknown) => typeof x === 'number' && Number.isFinite(x)
  switch (def.value) {
    case 'none':
      return []
    case 'single':
      if (field.type === 'number') return isNumber(v) ? [] : [`${field.label} : nombre attendu`]
      return typeof v === 'string' && v.trim() ? [] : [`${field.label} : valeur attendue`]
    case 'pair':
      return Array.isArray(v) && v.length === 2 && v.every(isNumber) ? [] : [`${field.label} : deux nombres attendus`]
    case 'multi':
      return Array.isArray(v) && v.length > 0 ? [] : [`${field.label} : choisis au moins une valeur`]
    case 'days':
      return isNumber(v) && (v as number) >= 0 ? [] : [`${field.label} : nombre de jours attendu`]
    case 'date':
      return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? [] : [`${field.label} : date invalide`]
  }
}

const DAY_MS = 86_400_000

function fold(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function asList(value: FilterValue): string[] {
  return (Array.isArray(value) ? value : [value]).map(fold)
}

function matchCondition(row: CatalogRow, c: FilterCondition, now: number): boolean {
  const field = FIELD_BY_KEY[c.field]
  const raw = row[c.field] as unknown
  const isEmpty = raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)
  if (c.op === 'empty') return isEmpty
  if (c.op === 'not_empty') return !isEmpty

  switch (field.type) {
    case 'string':
    case 'enum': {
      const value = fold(raw)
      if (c.op === 'eq') return !isEmpty && value === fold(c.value)
      if (c.op === 'neq') return value !== fold(c.value)
      if (c.op === 'contains') return !isEmpty && value.includes(fold(c.value))
      if (c.op === 'not_contains') return !value.includes(fold(c.value))
      if (c.op === 'in') return !isEmpty && asList(c.value).includes(value)
      if (c.op === 'not_in') return !asList(c.value).includes(value)
      return false
    }
    case 'number': {
      if (typeof raw !== 'number') return false
      const v = Number(c.value)
      if (c.op === 'eq') return raw === v
      if (c.op === 'neq') return raw !== v
      if (c.op === 'gt') return raw > v
      if (c.op === 'gte') return raw >= v
      if (c.op === 'lt') return raw < v
      if (c.op === 'lte') return raw <= v
      if (c.op === 'between' && Array.isArray(c.value)) {
        const [a, b] = c.value.map(Number) as [number, number]
        return raw >= Math.min(a, b) && raw <= Math.max(a, b)
      }
      return false
    }
    case 'date': {
      if (typeof raw !== 'number') return false
      if (c.op === 'older_than_days') return raw < now - Number(c.value) * DAY_MS
      if (c.op === 'newer_than_days') return raw >= now - Number(c.value) * DAY_MS
      if (c.op === 'before') return raw < Date.parse(String(c.value))
      if (c.op === 'after') return raw > Date.parse(String(c.value))
      return false
    }
    case 'list': {
      const values = (raw as string[]).map(fold)
      if (c.op === 'includes') return values.includes(fold(c.value))
      if (c.op === 'excludes') return !values.includes(fold(c.value))
      if (c.op === 'includes_any') return asList(c.value).some(v => values.includes(v))
      if (c.op === 'includes_all') return asList(c.value).every(v => values.includes(v))
      return false
    }
    case 'boolean':
      return c.op === 'is_true' ? raw === true : raw === false
  }
}

export function matches(row: CatalogRow, node: FilterNode, now: number = Date.now()): boolean {
  if (node.kind === 'group') {
    if (node.children.length === 0) return true
    return node.mode === 'and'
      ? node.children.every(c => matches(row, c, now))
      : node.children.some(c => matches(row, c, now))
  }
  return matchCondition(row, node, now)
}

export function defaultValue(field: FieldDef, kind: ValueKind): FilterValue {
  switch (kind) {
    case 'none': return undefined
    case 'single': return field.type === 'number' ? Number(field.options?.[0]?.value ?? 0) : (field.options?.[0]?.value ?? '')
    case 'pair': return [0, 0]
    case 'multi': return []
    case 'days': return 30
    case 'date': return new Date().toISOString().slice(0, 10)
  }
}

export function defaultCondition(field: FieldDef): FilterCondition {
  const first = OPERATORS[field.type][0]!
  return { kind: 'cond', field: field.key, op: first.op, value: defaultValue(field, first.value) }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npx vitest run tests/unit/filters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/filters.ts tests/unit/filters.test.ts
git commit -m "feat: moteur de filtres partagé"
```

---

### Task 15: Catalogue — agrégation, requêtes, fiche détaillée, tableau de bord

**Files:**
- Create: `shared/catalog.ts`, `server/api/catalog/query.post.ts`, `server/api/catalog/fields.get.ts`, `server/api/catalog/items/[id].get.ts`, `server/api/dashboard.get.ts`
- Modify: `server/lib/catalog.ts` (remplace le module minimal de la tâche 13), `tests/e2e/api.test.ts`
- Test: `tests/unit/catalog.test.ts`

**Interfaces:**
- Consumes: `CatalogRow`, `FIELDS`, `matches`, `validateFilter`, `filterNodeSchema`, `listInstances`, `getSyncState`, `languageLabel`.
- Produces (`shared/catalog.ts`) : `SORT_FIELDS`, `type SortField`, `catalogQuerySchema` (`{ filter?, search?, sort?, page = 1, pageSize = 50 (≤ 500) }`), `interface CatalogResult { rows: CatalogRow[]; total: number; totalSizeGb: number }`, `interface ItemDetail { item; presences; files; history }`, `interface DashboardDto { movies; series; totalSizeGb; neverWatched; instances: InstanceDto[]; sync: SyncStateDto }`.
- Produces (`server/lib/catalog.ts`) : `invalidateCatalog()`, `catalogVersion()`, `loadCatalogRows(db?): CatalogRow[]` (mis en cache jusqu'à invalidation), `queryCatalog(query, now?): CatalogResult` (lève `AppError` si le filtre est invalide), `getItemDetail(id, db?): ItemDetail | null`, `fieldOptions(rows?): FieldDef[]` (champs avec options remplies).
- Routes : `POST /api/catalog/query → CatalogResult`, `GET /api/catalog/fields → { fields: FieldDef[] }`, `GET /api/catalog/items/:id → ItemDetail` (404 sinon), `GET /api/dashboard → DashboardDto`.

Agrégation d'une ligne : `sizeGb` = somme des fichiers (sinon la plus grande taille de présence *arr), arrondie à 0,01 ; `resolution` = la plus basse des fichiers ; `videoCodecs` = union ; `audioLanguages`/`subtitleLanguages` = intersection sur les fichiers qui déclarent des langues ; `isRemux` = au moins un fichier ; `instances` = ids des présences *arr ; `servers` = ids des présences Plex/Jellyfin ; `libraries` = bibliothèques des serveurs ; `monitored`/`hasFile` = au moins une présence *arr ; `lastWatchedAt` = max ; `playCount` = somme ; `neverWatched = playCount === 0`.

- [ ] **Step 1: Écrire le test qui échoue**

`tests/unit/catalog.test.ts` :

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { fieldOptions, getItemDetail, invalidateCatalog, loadCatalogRows, queryCatalog } from '../../server/lib/catalog'
import { storeArrInstance, storeServerInstance } from '../../server/lib/sync/store'
import type { ArrItemRecord } from '../../server/lib/sync/types'
import { useTestDb } from '../helpers/db'

const db = useTestDb()
beforeEach(() => invalidateCatalog())

const GB = 1024 ** 3

function file(n: number, size: number, audio: string[], resolution: number) {
  return { externalId: n, season: 1, episode: n, servicePath: `/series/S/e${n}.mkv`, size, resolution, videoCodec: 'h264', audioLanguages: audio, subtitleLanguages: [], isRemux: false, runtimeSeconds: 2400 }
}

function seed() {
  const ins = db().prepare("INSERT INTO instances (kind, name, url, api_key_enc, created_at) VALUES (?, ?, 'http://x', 'k', 0)")
  ins.run('radarr', 'Radarr'); ins.run('sonarr', 'Sonarr'); ins.run('plex', 'Plex')
  const base: Omit<ArrItemRecord, 'externalId' | 'title' | 'type' | 'servicePath' | 'files'> = {
    year: 2020, tmdbId: null, tvdbId: null, imdbId: null, originalLanguage: 'en', genres: ['Drama'], ratingTmdb: 7, ratingImdb: null,
    addedAt: 1000, rootFolder: '/x', monitored: true, hasFile: true, size: 0, tags: [],
  }
  storeArrInstance(db(), 1, [
    { ...base, externalId: 1, type: 'movie', title: 'Zodiac', tmdbId: 1, servicePath: '/movies/Zodiac', files: [{ ...file(9, 20 * GB, ['en', 'fr'], 2160), season: null, episode: null }] },
    { ...base, externalId: 2, type: 'movie', title: 'Amélie', tmdbId: 2, originalLanguage: 'fr', servicePath: '/movies/Amelie', files: [] , size: 3 * GB },
  ], [], 5)
  storeArrInstance(db(), 2, [
    { ...base, externalId: 3, type: 'series', title: 'Show', tvdbId: 3, servicePath: '/series/S', files: [file(1, GB, ['en', 'fr'], 1080), file(2, GB, ['en'], 720), file(3, GB, [], 1080)] },
  ], [], 5)
  storeServerInstance(db(), 3, [{ externalId: 'p1', type: 'movie', title: 'Zodiac', year: 2007, tmdbId: 1, tvdbId: null, imdbId: null, servicePaths: [], library: 'Movies' }],
    [{ externalId: 'p1', user: 'alice', lastWatchedAt: 500, playCount: 2 }], [], 6)
}

describe('loadCatalogRows', () => {
  it('agrège fichiers, présences et visionnage', () => {
    seed()
    const rows = loadCatalogRows()
    const zodiac = rows.find(r => r.title === 'Zodiac')!
    expect(zodiac).toMatchObject({ sizeGb: 20, resolution: 2160, audioLanguages: ['en', 'fr'], instances: ['1'], servers: ['3'], libraries: ['Movies'], playCount: 2, lastWatchedAt: 500, neverWatched: false })
    const show = rows.find(r => r.title === 'Show')!
    expect(show).toMatchObject({ type: 'series', sizeGb: 3, resolution: 720, audioLanguages: ['en'], neverWatched: true, instances: ['2'] })
    expect(rows.find(r => r.title === 'Amélie')!.sizeGb).toBe(3)
  })
})

describe('queryCatalog', () => {
  it('filtre, recherche, trie et pagine', () => {
    seed()
    const all = queryCatalog({ page: 1, pageSize: 50, sort: { field: 'sizeGb', dir: 'desc' } })
    expect(all.rows.map(r => r.title)).toEqual(['Zodiac', 'Amélie', 'Show'])
    expect(all.totalSizeGb).toBe(26)
    expect(queryCatalog({ page: 1, pageSize: 50, search: 'amelie' }).rows.map(r => r.title)).toEqual(['Amélie'])
    const filtered = queryCatalog({ page: 1, pageSize: 50, filter: { kind: 'group', mode: 'and', children: [{ kind: 'cond', field: 'type', op: 'eq', value: 'movie' }] } })
    expect(filtered.total).toBe(2)
    const page2 = queryCatalog({ page: 2, pageSize: 2, sort: { field: 'title', dir: 'asc' } })
    expect(page2.rows.map(r => r.title)).toEqual(['Zodiac'])
    expect(page2.total).toBe(3)
  })

  it('met les valeurs absentes en dernier quel que soit le sens', () => {
    seed()
    const asc = queryCatalog({ page: 1, pageSize: 50, sort: { field: 'lastWatchedAt', dir: 'asc' } })
    expect(asc.rows[0]!.title).toBe('Zodiac')
  })

  it('refuse un filtre invalide', () => {
    expect(() => queryCatalog({ page: 1, pageSize: 50, filter: { kind: 'cond', field: 'sizeGb', op: 'gt', value: 'x' } })).toThrow('Filtre invalide.')
  })
})

describe('détail et options', () => {
  it('renvoie la fiche détaillée', () => {
    seed()
    const id = loadCatalogRows().find(r => r.title === 'Zodiac')!.id
    const detail = getItemDetail(id)!
    expect(detail.item).toMatchObject({ title: 'Zodiac', tmdbId: 1, genres: ['Drama'] })
    expect(detail.presences.map(p => [p.instanceName, p.kind])).toEqual([['Radarr', 'radarr'], ['Plex', 'plex']])
    expect(detail.history).toEqual([{ serverName: 'Plex', user: 'alice', lastWatchedAt: 500, playCount: 2 }])
    expect(getItemDetail(999)).toBeNull()
  })

  it('remplit les options des champs dynamiques', () => {
    seed()
    const fields = fieldOptions()
    expect(fields.find(f => f.key === 'instances')!.options).toEqual([{ value: '1', label: 'Radarr' }, { value: '2', label: 'Sonarr' }])
    expect(fields.find(f => f.key === 'servers')!.options).toEqual([{ value: '3', label: 'Plex' }])
    expect(fields.find(f => f.key === 'originalLanguage')!.options).toEqual([{ value: 'en', label: 'Anglais' }, { value: 'fr', label: 'Français' }])
  })
})
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest run tests/unit/catalog.test.ts`
Expected: FAIL — `loadCatalogRows` n'est pas exporté.

- [ ] **Step 3: Implémenter `shared/catalog.ts`**

```ts
import { z } from 'zod'
import { filterNodeSchema, type CatalogRow } from './filters'
import type { InstanceDto, InstanceKind } from './instances'
import type { SyncStateDto } from './sync'

export const SORT_FIELDS = ['title', 'year', 'addedAt', 'sizeGb', 'resolution', 'lastWatchedAt', 'playCount', 'ratingTmdb', 'ratingImdb'] as const
export type SortField = typeof SORT_FIELDS[number]

export const catalogQuerySchema = z.object({
  filter: filterNodeSchema.optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.object({ field: z.enum(SORT_FIELDS), dir: z.enum(['asc', 'desc']) }).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(50),
})
export type CatalogQuery = z.input<typeof catalogQuerySchema>

export interface CatalogResult { rows: CatalogRow[]; total: number; totalSizeGb: number }

export interface ItemDetail {
  item: {
    id: number; type: 'movie' | 'series'; title: string; year: number | null; tmdbId: number | null; tvdbId: number | null; imdbId: string | null
    originalLanguage: string | null; genres: string[]; ratingTmdb: number | null; ratingImdb: number | null; addedAt: number | null
  }
  presences: {
    instanceId: number; instanceName: string; kind: InstanceKind; externalId: string; library: string | null; rootFolder: string | null
    realFolder: string | null; monitored: boolean | null; hasFile: boolean | null; size: number | null; tags: string[]; syncedAt: number
  }[]
  files: {
    instanceName: string; season: number | null; episode: number | null; realPath: string | null; size: number; resolution: number | null
    videoCodec: string | null; audioLanguages: string[]; subtitleLanguages: string[]; isRemux: boolean
  }[]
  history: { serverName: string; user: string; lastWatchedAt: number | null; playCount: number }[]
}

export interface DashboardDto {
  movies: number
  series: number
  totalSizeGb: number
  neverWatched: number
  instances: InstanceDto[]
  sync: SyncStateDto
}
```

- [ ] **Step 4: Remplacer `server/lib/catalog.ts`**

```ts
import { FIELDS, matches, validateFilter, type CatalogRow, type FieldDef, type FilterField } from '#shared/filters'
import { catalogQuerySchema, type CatalogQuery, type CatalogResult, type ItemDetail, type SortField } from '#shared/catalog'
import { isArrKind, type InstanceKind } from '#shared/instances'
import { languageLabel } from '#shared/media'
import { getDb, type Db } from './db'
import { AppError } from './errors'
import { listInstances } from './instances'

let version = 0
let cache: { version: number; rows: CatalogRow[] } | null = null

export function invalidateCatalog(): void {
  version++
  cache = null
}

export function catalogVersion(): number {
  return version
}

const GB = 1024 ** 3
const parseList = (json: string): string[] => JSON.parse(json) as string[]
const round2 = (n: number) => Math.round(n * 100) / 100

interface ItemRow { id: number; type: 'movie' | 'series'; title: string; year: number | null; tmdb_id: number | null; tvdb_id: number | null; imdb_id: string | null; original_language: string | null; genres: string; rating_tmdb: number | null; rating_imdb: number | null; added_at: number | null }
interface PresenceRow { item_id: number; instance_id: number; kind: InstanceKind; name: string; external_id: string; library: string | null; root_folder: string | null; real_folder: string | null; monitored: number | null; has_file: number | null; size: number | null; tags: string; synced_at: number }
interface FileRow { item_id: number; instance_name: string; season: number | null; episode: number | null; real_path: string | null; size: number; resolution: number | null; video_codec: string | null; audio_languages: string; subtitle_languages: string; is_remux: number }
interface HistoryRow { item_id: number; server_name: string; user: string; last_watched_at: number | null; play_count: number }

function groupBy<T extends { item_id: number }>(rows: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>()
  for (const r of rows) {
    const list = out.get(r.item_id)
    if (list) list.push(r)
    else out.set(r.item_id, [r])
  }
  return out
}

function intersection(lists: string[][]): string[] {
  const declared = lists.filter(l => l.length > 0)
  if (declared.length === 0) return []
  return declared[0]!.filter(v => declared.every(l => l.includes(v)))
}

const unique = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))]

const PRESENCES_SQL = `SELECT p.*, i.kind, i.name FROM presences p JOIN instances i ON i.id = p.instance_id ORDER BY i.kind = 'plex', i.kind = 'jellyfin', i.name`
const FILES_SQL = `SELECT f.*, i.name AS instance_name FROM files f JOIN instances i ON i.id = f.instance_id ORDER BY f.season, f.episode, f.real_path`
const HISTORY_SQL = `SELECT h.*, i.name AS server_name FROM watch_history h JOIN instances i ON i.id = h.server_instance_id ORDER BY h.last_watched_at DESC`

export function loadCatalogRows(db: Db = getDb()): CatalogRow[] {
  if (cache && cache.version === version) return cache.rows
  const items = db.prepare('SELECT * FROM items ORDER BY title COLLATE NOCASE').all() as ItemRow[]
  const presences = groupBy(db.prepare(PRESENCES_SQL).all() as PresenceRow[])
  const files = groupBy(db.prepare(FILES_SQL).all() as FileRow[])
  const history = groupBy(db.prepare(HISTORY_SQL).all() as HistoryRow[])

  const rows = items.map((it): CatalogRow => {
    const pres = presences.get(it.id) ?? []
    const arr = pres.filter(p => isArrKind(p.kind))
    const servers = pres.filter(p => !isArrKind(p.kind))
    const fs = files.get(it.id) ?? []
    const hs = history.get(it.id) ?? []
    const fileBytes = fs.reduce((n, f) => n + f.size, 0)
    const bytes = fileBytes > 0 ? fileBytes : Math.max(0, ...arr.map(p => p.size ?? 0))
    const resolutions = fs.map(f => f.resolution).filter((r): r is number => r !== null)
    const playCount = hs.reduce((n, h) => n + h.play_count, 0)
    const watched = hs.map(h => h.last_watched_at).filter((t): t is number => t !== null)
    return {
      id: it.id,
      type: it.type,
      title: it.title,
      year: it.year,
      originalLanguage: it.original_language,
      genres: parseList(it.genres),
      ratingTmdb: it.rating_tmdb,
      ratingImdb: it.rating_imdb,
      addedAt: it.added_at,
      sizeGb: round2(bytes / GB),
      resolution: resolutions.length ? Math.min(...resolutions) : null,
      videoCodecs: unique(fs.map(f => f.video_codec)),
      audioLanguages: intersection(fs.map(f => parseList(f.audio_languages))),
      subtitleLanguages: intersection(fs.map(f => parseList(f.subtitle_languages))),
      isRemux: fs.some(f => f.is_remux === 1),
      instances: unique(arr.map(p => String(p.instance_id))),
      servers: unique(servers.map(p => String(p.instance_id))),
      libraries: unique(servers.map(p => p.library)),
      rootFolders: unique(arr.map(p => p.root_folder)),
      tags: unique(arr.flatMap(p => parseList(p.tags))),
      monitored: arr.some(p => p.monitored === 1),
      hasFile: arr.some(p => p.has_file === 1),
      neverWatched: playCount === 0,
      lastWatchedAt: watched.length ? Math.max(...watched) : null,
      playCount,
    }
  })
  cache = { version, rows }
  return rows
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function compare(a: CatalogRow, b: CatalogRow, field: SortField, dir: 'asc' | 'desc'): number {
  const x = a[field]
  const y = b[field]
  if (x === null && y === null) return 0
  if (x === null) return 1
  if (y === null) return -1
  const order = typeof x === 'string' ? fold(x).localeCompare(fold(String(y)), 'fr') : (x as number) - (y as number)
  return dir === 'asc' ? order : -order
}

export function queryCatalog(input: CatalogQuery, now: number = Date.now()): CatalogResult {
  const q = catalogQuerySchema.parse(input)
  if (q.filter) {
    const errors = validateFilter(q.filter)
    if (errors.length) throw new AppError('Filtre invalide.', 400, errors)
  }
  const search = q.search ? fold(q.search) : null
  let rows = loadCatalogRows().filter(r => (!search || fold(r.title).includes(search)) && (!q.filter || matches(r, q.filter, now)))
  if (q.sort) {
    const { field, dir } = q.sort
    rows = [...rows].sort((a, b) => compare(a, b, field, dir) || a.title.localeCompare(b.title, 'fr'))
  }
  const start = (q.page - 1) * q.pageSize
  return {
    rows: rows.slice(start, start + q.pageSize),
    total: rows.length,
    totalSizeGb: round2(rows.reduce((n, r) => n + r.sizeGb, 0)),
  }
}

export function getItemDetail(id: number, db: Db = getDb()): ItemDetail | null {
  const it = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined
  if (!it) return null
  const presences = (db.prepare(PRESENCES_SQL.replace('ORDER BY', 'WHERE p.item_id = ? ORDER BY')).all(id) as PresenceRow[])
  const files = (db.prepare(FILES_SQL.replace('ORDER BY', 'WHERE f.item_id = ? ORDER BY')).all(id) as FileRow[])
  const history = (db.prepare(HISTORY_SQL.replace('ORDER BY', 'WHERE h.item_id = ? ORDER BY')).all(id) as HistoryRow[])
  const bool = (v: number | null) => (v === null ? null : v === 1)
  return {
    item: {
      id: it.id, type: it.type, title: it.title, year: it.year, tmdbId: it.tmdb_id, tvdbId: it.tvdb_id, imdbId: it.imdb_id,
      originalLanguage: it.original_language, genres: parseList(it.genres), ratingTmdb: it.rating_tmdb, ratingImdb: it.rating_imdb, addedAt: it.added_at,
    },
    presences: presences.map(p => ({
      instanceId: p.instance_id, instanceName: p.name, kind: p.kind, externalId: p.external_id, library: p.library, rootFolder: p.root_folder,
      realFolder: p.real_folder, monitored: bool(p.monitored), hasFile: bool(p.has_file), size: p.size, tags: parseList(p.tags), syncedAt: p.synced_at,
    })),
    files: files.map(f => ({
      instanceName: f.instance_name, season: f.season, episode: f.episode, realPath: f.real_path, size: f.size, resolution: f.resolution,
      videoCodec: f.video_codec, audioLanguages: parseList(f.audio_languages), subtitleLanguages: parseList(f.subtitle_languages), isRemux: f.is_remux === 1,
    })),
    history: history.map(h => ({ serverName: h.server_name, user: h.user, lastWatchedAt: h.last_watched_at, playCount: h.play_count })),
  }
}

function valuesOf(rows: CatalogRow[], key: FilterField): string[] {
  const set = new Set<string>()
  for (const r of rows) {
    const v = r[key]
    if (Array.isArray(v)) v.forEach(x => set.add(String(x)))
    else if (v !== null && v !== undefined && v !== '') set.add(String(v))
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'))
}

const LANGUAGE_FIELDS = new Set<FilterField>(['originalLanguage', 'audioLanguages', 'subtitleLanguages'])

/** Les champs filtrables avec leurs choix possibles, calculés sur le catalogue. */
export function fieldOptions(rows: CatalogRow[] = loadCatalogRows()): FieldDef[] {
  const instances = listInstances()
  return FIELDS.map((field) => {
    if (!field.dynamicOptions) return field
    if (field.key === 'instances' || field.key === 'servers') {
      const wantArr = field.key === 'instances'
      return { ...field, options: instances.filter(i => isArrKind(i.kind) === wantArr).map(i => ({ value: String(i.id), label: i.name })) }
    }
    const label = LANGUAGE_FIELDS.has(field.key) ? languageLabel : (v: string) => v
    return { ...field, options: valuesOf(rows, field.key).map(v => ({ value: v, label: label(v) })) }
  })
}
```

> Dans le test « remplit les options », la langue originale « fr » vient d'Amélie et « en » des deux autres titres : les options triées sont `en`, `fr`.

- [ ] **Step 5: Lancer les tests unitaires**

Run: `npx vitest run tests/unit/catalog.test.ts tests/unit/sync`
Expected: PASS.

- [ ] **Step 6: Écrire les routes**

`server/api/catalog/query.post.ts` :

```ts
import { catalogQuerySchema } from '#shared/catalog'
import { defineApiHandler, parseOrThrow } from '~~/server/lib/api'
import { queryCatalog } from '~~/server/lib/catalog'

export default defineApiHandler(async event => queryCatalog(parseOrThrow(catalogQuerySchema, await readBody(event))))
```

`server/api/catalog/fields.get.ts` :

```ts
import { defineApiHandler } from '~~/server/lib/api'
import { fieldOptions } from '~~/server/lib/catalog'

export default defineApiHandler(() => ({ fields: fieldOptions() }))
```

`server/api/catalog/items/[id].get.ts` :

```ts
import { defineApiHandler, parseId } from '~~/server/lib/api'
import { getItemDetail } from '~~/server/lib/catalog'
import { AppError } from '~~/server/lib/errors'

export default defineApiHandler((event) => {
  const detail = getItemDetail(parseId(event))
  if (!detail) throw new AppError('Titre introuvable.', 404)
  return detail
})
```

`server/api/dashboard.get.ts` :

```ts
import type { DashboardDto } from '#shared/catalog'
import { defineApiHandler } from '~~/server/lib/api'
import { loadCatalogRows } from '~~/server/lib/catalog'
import { listInstances } from '~~/server/lib/instances'
import { nextSyncAt } from '~~/server/lib/scheduler'
import { getSyncState } from '~~/server/lib/sync/runner'

export default defineApiHandler((): DashboardDto => {
  const rows = loadCatalogRows()
  return {
    movies: rows.filter(r => r.type === 'movie').length,
    series: rows.filter(r => r.type === 'series').length,
    totalSizeGb: Math.round(rows.reduce((n, r) => n + r.sizeGb, 0) * 100) / 100,
    neverWatched: rows.filter(r => r.neverWatched).length,
    instances: listInstances(),
    sync: { ...getSyncState(), nextRunAt: nextSyncAt() },
  }
})
```

- [ ] **Step 7: Compléter le test de bout en bout**

Ajouter à la fin du `describe('API', …)` de `tests/e2e/api.test.ts` :

```ts
  it('interroge le catalogue vide et refuse un filtre invalide', async () => {
    const ok = await fetch('/api/catalog/query', post({ page: 1, pageSize: 10 }, cookie))
    expect(await ok.json()).toEqual({ rows: [], total: 0, totalSizeGb: 0 })
    const bad = await fetch('/api/catalog/query', post({ filter: { kind: 'cond', field: 'sizeGb', op: 'gt', value: 'x' } }, cookie))
    expect(bad.status).toBe(400)
    expect((await bad.json()).data.details).toEqual(['Taille : nombre attendu'])
  })

  it('renvoie les champs filtrables et le tableau de bord', async () => {
    const fields = await (await fetch('/api/catalog/fields', { headers: { cookie } })).json()
    expect(fields.fields.find((f: { key: string }) => f.key === 'instances').options).toEqual([{ value: '1', label: 'Radarr' }])
    const dash = await (await fetch('/api/dashboard', { headers: { cookie } })).json()
    expect(dash).toMatchObject({ movies: 0, series: 0, instances: [{ name: 'Radarr' }] })
  })
```

- [ ] **Step 8: Lancer tous les tests et le typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: catalogue, fiche détaillée et tableau de bord côté serveur"
```

---

### Task 16: Interface — structure, connexion et barre d'état

**Files:**
- Create: `app/composables/useApi.ts`, `app/composables/useSync.ts`, `app/middleware/auth.global.ts`, `app/layouts/default.vue`, `app/layouts/auth.vue`, `app/components/AppPage.vue`, `app/components/AppStatusBar.vue`, `app/pages/login.vue`, `app/pages/setup.vue`
- Modify: `app/pages/index.vue`

**Interfaces:**
- Consumes: routes `/api/auth/*`, `/api/instances`, `/api/sync` ; `loginSchema`, `setupSchema`, `STATUS_LABELS`, `STATUS_DOT`, `SyncStateDto`.
- Produces (auto-importés par Nuxt dans `app/`) :
  - `useApi()` : instance `$fetch` qui ajoute `x-sortarr: 1` et renvoie vers `/login` sur 401.
  - `errorMessage(e: unknown): string` : `error.data.message` + `details` éventuels.
  - `useSyncState() → { state: Ref<SyncStateDto | null>, refresh(), start() }` (interroge `/api/sync` toutes les 2 s tant qu'une synchro tourne).
  - `onSyncFinished(cb)` : rappelle `cb` à la fin de chaque synchro.
  - État partagé `useState<InstanceDto[]>('instances')`, rafraîchi par `AppStatusBar` toutes les 30 s.
  - `<AppPage title="…">` : panneau avec barre de titre et barre d'état ; contenu dans le slot par défaut.

Cette tâche est de l'interface : pas de test unitaire, la vérification passe par le typecheck et un essai dans le navigateur.

- [ ] **Step 1: Écrire les composables**

`app/composables/useApi.ts` :

```ts
export function useApi() {
  return $fetch.create({
    headers: { 'x-sortarr': '1' },
    onResponseError({ response }) {
      if (response.status === 401 && !['/login', '/setup'].includes(window.location.pathname)) {
        void navigateTo('/login')
      }
    },
  })
}

/** Message lisible d'une erreur renvoyée par l'API (ou d'une erreur réseau). */
export function errorMessage(error: unknown): string {
  const e = error as { data?: { message?: string; data?: { details?: string[] } }; message?: string }
  const details = e?.data?.data?.details?.length ? ` (${e.data.data.details.join(' ; ')})` : ''
  return `${e?.data?.message ?? e?.message ?? 'Erreur inconnue'}${details}`
}
```

`app/composables/useSync.ts` :

```ts
import type { SyncStateDto } from '#shared/sync'

let pollTimer: ReturnType<typeof setTimeout> | null = null

export function useSyncState() {
  const api = useApi()
  const state = useState<SyncStateDto | null>('sync', () => null)

  async function refresh(): Promise<void> {
    state.value = await api<SyncStateDto>('/api/sync')
    if (state.value.running && !pollTimer) {
      pollTimer = setTimeout(() => {
        pollTimer = null
        void refresh()
      }, 2000)
    }
  }

  async function start(): Promise<void> {
    await api('/api/sync', { method: 'POST' })
    await refresh()
  }

  return { state, refresh, start }
}

/** Rappelle `callback` chaque fois qu'une synchro se termine. */
export function onSyncFinished(callback: () => void): void {
  const state = useState<SyncStateDto | null>('sync', () => null)
  watch(() => state.value?.finishedAt, (next, previous) => {
    if (next && previous !== undefined && next !== previous) callback()
  })
}
```

- [ ] **Step 2: Écrire le middleware de navigation et les layouts**

`app/middleware/auth.global.ts` :

```ts
export default defineNuxtRouteMiddleware(async (to) => {
  const status = await $fetch<{ hasAdmin: boolean; authenticated: boolean }>('/api/auth/status')
  if (!status.hasAdmin) return to.path === '/setup' ? undefined : navigateTo('/setup')
  if (!status.authenticated) return to.path === '/login' ? undefined : navigateTo('/login')
  if (to.path === '/login' || to.path === '/setup') return navigateTo('/')
})
```

`app/layouts/auth.vue` :

```vue
<template>
  <div class="min-h-screen flex items-center justify-center p-4 bg-muted">
    <slot />
  </div>
</template>
```

`app/layouts/default.vue` :

```vue
<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const api = useApi()

const main: NavigationMenuItem[] = [
  { label: 'Tableau de bord', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Catalogue', icon: 'i-lucide-film', to: '/catalogue' },
]
const settings: NavigationMenuItem[] = [
  { label: 'Instances', icon: 'i-lucide-server', to: '/reglages/instances' },
  { label: 'Chemins', icon: 'i-lucide-folder-tree', to: '/reglages/chemins' },
  { label: 'Général', icon: 'i-lucide-settings', to: '/reglages/general' },
]

async function logout() {
  await api('/api/auth/logout', { method: 'POST' })
  await navigateTo('/login')
}
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible resizable>
      <template #header="{ collapsed }">
        <div class="flex items-center gap-2 font-semibold">
          <UIcon name="i-lucide-clapperboard" class="size-5 text-primary" />
          <span v-if="!collapsed">Sortarr</span>
        </div>
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu :collapsed="collapsed" :items="main" orientation="vertical" />
        <USeparator class="my-2" />
        <p v-if="!collapsed" class="px-2.5 pb-1 text-xs font-medium text-muted">Réglages</p>
        <UNavigationMenu :collapsed="collapsed" :items="settings" orientation="vertical" />
      </template>

      <template #footer="{ collapsed }">
        <UButton :label="collapsed ? undefined : 'Déconnexion'" icon="i-lucide-log-out" color="neutral" variant="ghost" block @click="logout" />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
```

- [ ] **Step 3: Écrire AppPage et AppStatusBar**

`app/components/AppPage.vue` :

```vue
<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <UDashboardPanel :id="title">
    <template #header>
      <UDashboardNavbar :title="title">
        <template #right>
          <AppStatusBar />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <slot />
    </template>
  </UDashboardPanel>
</template>
```

`app/components/AppStatusBar.vue` :

```vue
<script setup lang="ts">
import { STATUS_DOT, STATUS_LABELS, type InstanceDto } from '#shared/instances'

const api = useApi()
const toast = useToast()
const instances = useState<InstanceDto[]>('instances', () => [])
const { state: sync, refresh: refreshSync, start } = useSyncState()

async function refreshInstances() {
  try {
    instances.value = await api<InstanceDto[]>('/api/instances')
  } catch {
    // La page affiche déjà l'erreur ; la barre d'état réessaiera dans 30 s.
  }
}

async function startSync() {
  try {
    await start()
  } catch (e) {
    toast.add({ title: 'Synchro impossible', description: errorMessage(e), color: 'error' })
  }
}

function tooltip(i: InstanceDto) {
  return `${i.name} : ${STATUS_LABELS[i.lastStatus]}${i.lastError ? ` — ${i.lastError}` : ''}`
}

let interval: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void refreshInstances()
  void refreshSync()
  interval = setInterval(refreshInstances, 30_000)
})
onBeforeUnmount(() => clearInterval(interval))
onSyncFinished(refreshInstances)

const enabled = computed(() => instances.value.filter(i => i.enabled))
</script>

<template>
  <div class="flex items-center gap-3">
    <div class="hidden sm:flex items-center gap-1.5">
      <UTooltip v-for="i in enabled" :key="i.id" :text="tooltip(i)">
        <span class="block size-2.5 rounded-full" :class="STATUS_DOT[i.lastStatus]" />
      </UTooltip>
    </div>
    <UButton
      :loading="sync?.running"
      icon="i-lucide-refresh-cw"
      :label="sync?.running ? 'Synchro en cours…' : 'Synchroniser'"
      size="sm"
      variant="soft"
      @click="startSync"
    />
  </div>
</template>
```

- [ ] **Step 4: Écrire les pages de connexion et de création du compte**

`app/pages/login.vue` :

```vue
<script setup lang="ts">
import { loginSchema } from '#shared/auth'

definePageMeta({ layout: 'auth' })

const api = useApi()
const toast = useToast()
const state = reactive({ username: '', password: '' })
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    await api('/api/auth/login', { method: 'POST', body: state })
    await navigateTo('/')
  } catch (e) {
    toast.add({ title: 'Connexion impossible', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard class="w-full max-w-sm">
    <template #header>
      <h1 class="text-lg font-semibold">Connexion à Sortarr</h1>
    </template>
    <UForm :schema="loginSchema" :state="state" class="space-y-4" @submit="submit">
      <UFormField label="Nom d'utilisateur" name="username">
        <UInput v-model="state.username" autocomplete="username" class="w-full" />
      </UFormField>
      <UFormField label="Mot de passe" name="password">
        <UInput v-model="state.password" type="password" autocomplete="current-password" class="w-full" />
      </UFormField>
      <UButton type="submit" label="Se connecter" block :loading="loading" />
    </UForm>
  </UCard>
</template>
```

`app/pages/setup.vue` :

```vue
<script setup lang="ts">
import { setupSchema } from '#shared/auth'

definePageMeta({ layout: 'auth' })

const api = useApi()
const toast = useToast()
const state = reactive({ username: 'admin', password: '', confirm: '' })
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    await api('/api/auth/setup', { method: 'POST', body: state })
    await navigateTo('/reglages/instances')
  } catch (e) {
    toast.add({ title: 'Création impossible', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard class="w-full max-w-sm">
    <template #header>
      <h1 class="text-lg font-semibold">Bienvenue dans Sortarr</h1>
      <p class="text-sm text-muted mt-1">Crée le compte administrateur. Tu ajouteras ensuite tes instances.</p>
    </template>
    <UForm :schema="setupSchema" :state="state" class="space-y-4" @submit="submit">
      <UFormField label="Nom d'utilisateur" name="username">
        <UInput v-model="state.username" autocomplete="username" class="w-full" />
      </UFormField>
      <UFormField label="Mot de passe" name="password" description="8 caractères minimum">
        <UInput v-model="state.password" type="password" autocomplete="new-password" class="w-full" />
      </UFormField>
      <UFormField label="Confirmation" name="confirm">
        <UInput v-model="state.confirm" type="password" autocomplete="new-password" class="w-full" />
      </UFormField>
      <UButton type="submit" label="Créer le compte" block :loading="loading" />
    </UForm>
  </UCard>
</template>
```

Remplacer `app/pages/index.vue` (contenu définitif à la tâche 20) :

```vue
<template>
  <AppPage title="Tableau de bord">
    <p class="text-muted">Le tableau de bord arrive à la tâche 20.</p>
  </AppPage>
</template>
```

- [ ] **Step 5: Vérifier**

Run: `npm run typecheck`
Expected: aucune erreur.

Run: `SORTARR_CONFIG_DIR=./config SORTARR_MEDIA_ROOT=/tmp npm run dev`, puis ouvrir http://localhost:3000 :
- redirection vers `/setup` ; créer le compte → arrivée sur `/reglages/instances` (page 404 Nuxt pour l'instant, normal) ;
- revenir sur `/` : barre latérale, bouton « Synchroniser » ; un clic lance une synchro vide et le bouton repasse à « Synchroniser » ;
- « Déconnexion » → `/login` ; un mauvais mot de passe affiche « Identifiants incorrects. ».

Supprimer ensuite le dossier `./config` de test (`rm -rf ./config`).

- [ ] **Step 6: Commit**

```bash
git add app
git commit -m "feat(ui): structure, connexion et barre d'état"
```

---

### Task 17: Interface — page Instances

**Files:**
- Create: `app/components/InstanceForm.vue`, `app/components/DiscoveryResult.vue`, `app/pages/reglages/instances.vue`

**Interfaces:**
- Consumes: `GET/POST /api/instances`, `PUT/DELETE /api/instances/:id`, `POST /api/instances/test`, `GET/POST /api/instances/import` ; `INSTANCE_KINDS`, `KIND_LABELS`, `STATUS_LABELS`, `STATUS_DOT`, `instanceCreateSchema`, `instanceUpdateSchema`, `InstanceDto`, `TestResult`, `Discovery`, `ImportPreview` ; `formatDateTime`.
- Produces: `<InstanceForm :instance="InstanceDto | null" @saved="(dto, created) => …" @cancel>` et `<DiscoveryResult :discovery="Discovery">`.

- [ ] **Step 1: Écrire DiscoveryResult**

`app/components/DiscoveryResult.vue` :

```vue
<script setup lang="ts">
import type { Discovery } from '#shared/instances'

defineProps<{ discovery: Discovery }>()
</script>

<template>
  <UAlert color="success" variant="subtle" icon="i-lucide-circle-check" :title="`Connexion réussie — version ${discovery.version}`">
    <template #description>
      <div class="space-y-2 mt-1 text-sm">
        <div v-if="discovery.libraries.length">
          <p class="font-medium">Bibliothèques</p>
          <ul class="list-disc pl-5">
            <li v-for="l in discovery.libraries" :key="l.id">{{ l.name }} — {{ l.locations.join(', ') }}</li>
          </ul>
        </div>
        <div v-else-if="discovery.roots.length">
          <p class="font-medium">Dossiers racines</p>
          <ul class="list-disc pl-5">
            <li v-for="r in discovery.roots" :key="r.path">{{ r.path }}</li>
          </ul>
        </div>
        <p v-if="discovery.qualityProfiles.length">
          <span class="font-medium">Profils de qualité :</span> {{ discovery.qualityProfiles.join(', ') }}
        </p>
      </div>
    </template>
  </UAlert>
</template>
```

- [ ] **Step 2: Écrire InstanceForm**

`app/components/InstanceForm.vue` :

```vue
<script setup lang="ts">
import { INSTANCE_KINDS, KIND_LABELS, instanceCreateSchema, instanceUpdateSchema, type InstanceDto, type InstanceKind, type TestResult } from '#shared/instances'

const props = defineProps<{ instance: InstanceDto | null }>()
const emit = defineEmits<{ saved: [instance: InstanceDto, created: boolean]; cancel: [] }>()

const api = useApi()
const toast = useToast()

const PLACEHOLDERS: Record<InstanceKind, string> = {
  radarr: 'http://192.168.1.10:7878',
  sonarr: 'http://192.168.1.10:8989',
  plex: 'http://192.168.1.10:32400',
  jellyfin: 'http://192.168.1.10:8096',
}
const KEY_HELP: Record<InstanceKind, string> = {
  radarr: 'Radarr › Settings › General › Security › API Key',
  sonarr: 'Sonarr › Settings › General › Security › API Key',
  plex: 'Jeton X-Plex-Token du compte admin (support.plex.tv/articles/204059436)',
  jellyfin: 'Jellyfin › Tableau de bord › Clés API › +',
}

const isEdit = computed(() => props.instance !== null)
const state = reactive({
  kind: (props.instance?.kind ?? 'radarr') as InstanceKind,
  name: props.instance?.name ?? '',
  url: props.instance?.url ?? '',
  apiKey: '',
  enabled: props.instance?.enabled ?? true,
})
const replaceKey = ref(!isEdit.value)
const schema = computed(() => (isEdit.value ? instanceUpdateSchema : instanceCreateSchema))
const kindItems = INSTANCE_KINDS.map(k => ({ label: KIND_LABELS[k], value: k }))
const saving = ref(false)
const testing = ref(false)
const testResult = ref<TestResult | null>(null)

async function runTest() {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await api<TestResult>('/api/instances/test', {
      method: 'POST',
      body: { id: props.instance?.id, kind: state.kind, url: state.url, apiKey: state.apiKey || undefined },
    })
  } catch (e) {
    testResult.value = { ok: false, error: errorMessage(e) }
  } finally {
    testing.value = false
  }
}

async function submit() {
  saving.value = true
  try {
    const body = { ...state, apiKey: replaceKey.value && state.apiKey ? state.apiKey : undefined }
    const saved = props.instance
      ? await api<InstanceDto>(`/api/instances/${props.instance.id}`, { method: 'PUT', body })
      : await api<InstanceDto>('/api/instances', { method: 'POST', body })
    emit('saved', saved, !props.instance)
  } catch (e) {
    toast.add({ title: 'Enregistrement impossible', description: errorMessage(e), color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UForm :schema="schema" :state="state" class="space-y-4" @submit="submit">
    <UFormField label="Type" name="kind">
      <USelect v-model="state.kind" :items="kindItems" :disabled="isEdit" class="w-full" />
    </UFormField>
    <UFormField label="Nom" name="name" description="Affiché partout dans Sortarr, par exemple « Radarr 4K ».">
      <UInput v-model="state.name" class="w-full" />
    </UFormField>
    <UFormField label="URL" name="url">
      <UInput v-model="state.url" :placeholder="PLACEHOLDERS[state.kind]" class="w-full" />
    </UFormField>
    <UFormField label="Clé API" name="apiKey" :description="KEY_HELP[state.kind]">
      <UInput v-if="replaceKey" v-model="state.apiKey" type="password" autocomplete="off" class="w-full" />
      <div v-else class="flex items-center gap-2">
        <span class="text-sm text-muted">•••••••• enregistrée</span>
        <UButton size="xs" variant="soft" label="Remplacer la clé" @click="replaceKey = true" />
      </div>
    </UFormField>
    <UFormField name="enabled">
      <USwitch v-model="state.enabled" label="Activée (incluse dans la synchro)" />
    </UFormField>

    <div class="flex flex-wrap gap-2">
      <UButton label="Tester la connexion" icon="i-lucide-plug-zap" variant="soft" :loading="testing" @click="runTest" />
      <UButton type="submit" label="Enregistrer" :loading="saving" />
      <UButton label="Annuler" color="neutral" variant="ghost" @click="emit('cancel')" />
    </div>

    <UAlert v-if="testResult && !testResult.ok" color="error" variant="subtle" icon="i-lucide-circle-x" title="Connexion impossible" :description="testResult.error" />
    <DiscoveryResult v-if="testResult && testResult.ok" :discovery="testResult.discovery" />
  </UForm>
</template>
```

- [ ] **Step 3: Écrire la page**

`app/pages/reglages/instances.vue` :

```vue
<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { KIND_LABELS, STATUS_DOT, STATUS_LABELS, type ImportPreview, type InstanceDto, type TestResult } from '#shared/instances'
import { formatDateTime } from '#shared/format'

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const UDropdownMenu = resolveComponent('UDropdownMenu')

const api = useApi()
const toast = useToast()
const instances = useState<InstanceDto[]>('instances', () => [])
const loading = ref(true)

async function refresh() {
  loading.value = true
  try {
    instances.value = await api<InstanceDto[]>('/api/instances')
  } catch (e) {
    toast.add({ title: 'Instances indisponibles', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}

// Formulaire d'ajout / édition
const formOpen = ref(false)
const editing = ref<InstanceDto | null>(null)
const formKey = ref(0)
function openForm(instance: InstanceDto | null) {
  editing.value = instance
  formKey.value++
  formOpen.value = true
}
async function onSaved(instance: InstanceDto, created: boolean) {
  formOpen.value = false
  await refresh()
  toast.add(created
    ? { title: `${instance.name} ajoutée`, description: 'Configure maintenant la correspondance des chemins.', color: 'success', actions: [{ label: 'Configurer les chemins', to: `/reglages/chemins?instance=${instance.id}` }] }
    : { title: `${instance.name} enregistrée`, color: 'success' })
}

async function test(instance: InstanceDto) {
  try {
    const r = await api<TestResult>('/api/instances/test', { method: 'POST', body: { id: instance.id, kind: instance.kind, url: instance.url } })
    toast.add(r.ok
      ? { title: `${instance.name} : connexion réussie`, description: `Version ${r.discovery.version}`, color: 'success' }
      : { title: `${instance.name} : connexion impossible`, description: r.error, color: 'error' })
  } catch (e) {
    toast.add({ title: 'Test impossible', description: errorMessage(e), color: 'error' })
  }
  await refresh()
}

async function toggle(instance: InstanceDto) {
  try {
    await api(`/api/instances/${instance.id}`, { method: 'PUT', body: { name: instance.name, url: instance.url, enabled: !instance.enabled } })
    await refresh()
  } catch (e) {
    toast.add({ title: 'Modification impossible', description: errorMessage(e), color: 'error' })
  }
}

// Suppression
const toDelete = ref<InstanceDto | null>(null)
const deleting = ref(false)
async function confirmDelete() {
  if (!toDelete.value) return
  deleting.value = true
  try {
    await api(`/api/instances/${toDelete.value.id}`, { method: 'DELETE' })
    toast.add({ title: `${toDelete.value.name} supprimée`, color: 'success' })
    toDelete.value = null
    await refresh()
  } catch (e) {
    toast.add({ title: 'Suppression impossible', description: errorMessage(e), color: 'error' })
  } finally {
    deleting.value = false
  }
}

// Import de media.env
const importPreview = ref<ImportPreview | null>(null)
const importOpen = ref(false)
const importSelected = ref<string[]>([])
const importable = computed(() => importPreview.value?.proposals.filter(p => !p.exists) ?? [])
async function loadImport() {
  try {
    importPreview.value = await api<ImportPreview>('/api/instances/import')
    importSelected.value = importable.value.map(p => p.name)
  } catch {
    importPreview.value = null
  }
}
function toggleImport(name: string, checked: boolean) {
  importSelected.value = checked ? [...importSelected.value, name] : importSelected.value.filter(n => n !== name)
}
async function runImport() {
  try {
    const created = await api<InstanceDto[]>('/api/instances/import', { method: 'POST', body: { names: importSelected.value } })
    importOpen.value = false
    toast.add({ title: `${created.length} instance(s) importée(s)`, description: 'Teste-les puis configure leurs chemins.', color: 'success' })
    await Promise.all([refresh(), loadImport()])
  } catch (e) {
    toast.add({ title: 'Import impossible', description: errorMessage(e), color: 'error' })
  }
}

onMounted(() => Promise.all([refresh(), loadImport()]))
onSyncFinished(refresh)

const columns: TableColumn<InstanceDto>[] = [
  {
    accessorKey: 'name',
    header: 'Instance',
    cell: ({ row }) => h('div', [
      h('p', { class: 'font-medium' }, row.original.name),
      h('p', { class: 'text-xs text-muted' }, row.original.url),
    ]),
  },
  {
    accessorKey: 'kind',
    header: 'Type',
    cell: ({ row }) => h(UBadge, { variant: 'subtle', color: 'neutral' }, () => KIND_LABELS[row.original.kind]),
  },
  {
    accessorKey: 'lastStatus',
    header: 'État',
    cell: ({ row }) => h('div', { class: 'flex items-center gap-2 max-w-80' }, [
      h('span', { class: ['block size-2.5 shrink-0 rounded-full', row.original.enabled ? STATUS_DOT[row.original.lastStatus] : 'bg-neutral-300'] }),
      h('span', { class: 'text-sm' }, row.original.enabled ? STATUS_LABELS[row.original.lastStatus] : 'désactivée'),
      row.original.lastError ? h('span', { class: 'text-xs text-error truncate', title: row.original.lastError }, row.original.lastError) : null,
    ]),
  },
  { accessorKey: 'version', header: 'Version', cell: ({ row }) => row.original.version ?? '—' },
  { accessorKey: 'lastSyncAt', header: 'Dernière synchro', cell: ({ row }) => formatDateTime(row.original.lastSyncAt) },
  {
    id: 'actions',
    meta: { class: { td: 'text-right' } },
    cell: ({ row }) => h(UDropdownMenu, {
      content: { align: 'end' },
      items: [
        [
          { label: 'Modifier', icon: 'i-lucide-pencil', onSelect: () => openForm(row.original) },
          { label: 'Tester la connexion', icon: 'i-lucide-plug-zap', onSelect: () => test(row.original) },
          { label: 'Chemins', icon: 'i-lucide-folder-tree', to: `/reglages/chemins?instance=${row.original.id}` },
          { label: row.original.enabled ? 'Désactiver' : 'Activer', icon: 'i-lucide-power', onSelect: () => toggle(row.original) },
        ],
        [{ label: 'Supprimer', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => { toDelete.value = row.original } }],
      ],
    }, () => h(UButton, { icon: 'i-lucide-ellipsis-vertical', color: 'neutral', variant: 'ghost', 'aria-label': 'Actions' })),
  },
]
</script>

<template>
  <AppPage title="Instances">
    <div class="space-y-4">
      <UAlert
        v-if="importable.length"
        color="info"
        variant="subtle"
        icon="i-lucide-file-down"
        title="Fichier media.env trouvé"
        :description="`${importable.length} instance(s) peuvent être importées depuis le dossier de configuration.`"
        :actions="[{ label: 'Importer', onClick: () => { importOpen = true } }]"
      />

      <div class="flex justify-between items-center">
        <p class="text-sm text-muted">Radarr, Sonarr, Plex et Jellyfin : ajoute autant d'instances que nécessaire.</p>
        <UButton icon="i-lucide-plus" label="Ajouter une instance" @click="openForm(null)" />
      </div>

      <UTable :data="instances" :columns="columns" :loading="loading" />
      <p v-if="!loading && !instances.length" class="text-center text-muted py-8">Aucune instance pour l'instant.</p>
    </div>

    <USlideover v-model:open="formOpen" :title="editing ? `Modifier ${editing.name}` : 'Ajouter une instance'">
      <template #body>
        <InstanceForm :key="formKey" :instance="editing" @saved="onSaved" @cancel="formOpen = false" />
      </template>
    </USlideover>

    <UModal :open="toDelete !== null" title="Supprimer l'instance ?" @update:open="(open: boolean) => { if (!open) toDelete = null }">
      <template #body>
        <p>
          « {{ toDelete?.name }} » sera retirée de Sortarr, avec ses correspondances de chemins et ses données synchronisées.
          Rien n'est modifié dans {{ toDelete ? KIND_LABELS[toDelete.kind] : '' }}.
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Annuler" color="neutral" variant="ghost" @click="toDelete = null" />
          <UButton label="Supprimer" color="error" :loading="deleting" @click="confirmDelete" />
        </div>
      </template>
    </UModal>

    <UModal v-model:open="importOpen" title="Importer depuis media.env">
      <template #body>
        <div class="space-y-2">
          <UCheckbox
            v-for="p in importable"
            :key="p.name"
            :model-value="importSelected.includes(p.name)"
            :label="`${p.name} (${KIND_LABELS[p.kind]}) — ${p.url}`"
            @update:model-value="(v: boolean | 'indeterminate') => toggleImport(p.name, v === true)"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton label="Annuler" color="neutral" variant="ghost" @click="importOpen = false" />
          <UButton label="Importer" :disabled="!importSelected.length" @click="runImport" />
        </div>
      </template>
    </UModal>
  </AppPage>
</template>
```

- [ ] **Step 4: Vérifier**

Run: `npm run typecheck`
Expected: aucune erreur.

Run: `mkdir -p config && cp media.env config/media.env && SORTARR_CONFIG_DIR=./config SORTARR_MEDIA_ROOT=/tmp npm run dev`, se connecter, ouvrir `/reglages/instances` :
- le bandeau « Fichier media.env trouvé » propose les 6 instances ; importer → elles apparaissent ;
- menu ⋮ › « Tester la connexion » sur Radarr → toast « connexion réussie — version 6.4.4 », pastille verte ;
- « Modifier » : la clé n'est pas affichée ; « Tester » sans remplacer la clé fonctionne ;
- ajouter une instance avec une mauvaise URL → l'enregistrement marche, le test affiche « Service injoignable » ;
- « Désactiver » grise la pastille ; « Supprimer » demande confirmation.

- [ ] **Step 5: Commit**

```bash
git add app
git commit -m "feat(ui): page Instances avec test de connexion et import"
```

---

### Task 18: Interface — page Chemins

**Files:**
- Create: `app/pages/reglages/chemins.vue`

**Interfaces:**
- Consumes: `GET/PUT /api/instances/:id/paths`, `POST /api/instances/:id/paths/suggest`, `POST /api/instances/:id/paths/verify`, `GET /api/settings/general` ; `PathMapping`, `PathSuggestion`, `PathCheck`, `InstanceDto`, `KIND_LABELS`.
- Produces: page `/reglages/chemins?instance=<id>`.

- [ ] **Step 1: Écrire la page**

`app/pages/reglages/chemins.vue` :

```vue
<script setup lang="ts">
import { KIND_LABELS, type InstanceDto } from '#shared/instances'
import type { PathCheck, PathMapping, PathSuggestion } from '#shared/paths'

interface Row { servicePath: string; realPath: string; managed: boolean; label?: string }

const route = useRoute()
const api = useApi()
const toast = useToast()
const instances = useState<InstanceDto[]>('instances', () => [])
const selectedId = ref<number | undefined>(route.query.instance ? Number(route.query.instance) : undefined)
const rows = ref<Row[]>([])
const mediaRootDir = ref('')
const checks = ref<PathCheck[] | null>(null)
const busy = ref<'load' | 'suggest' | 'save' | 'verify' | null>(null)

const instanceItems = computed(() => instances.value.map(i => ({ label: `${i.name} (${KIND_LABELS[i.kind]})`, value: i.id })))
const selected = computed(() => instances.value.find(i => i.id === selectedId.value) ?? null)

async function load() {
  if (!selectedId.value) return
  busy.value = 'load'
  checks.value = null
  try {
    const mappings = await api<PathMapping[]>(`/api/instances/${selectedId.value}/paths`)
    rows.value = mappings.map(m => ({ servicePath: m.servicePath, realPath: m.realPath, managed: m.managed }))
  } catch (e) {
    toast.add({ title: 'Chemins indisponibles', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = null
  }
}

async function suggest() {
  if (!selectedId.value) return
  busy.value = 'suggest'
  try {
    const r = await api<{ mediaRoot: string; suggestions: PathSuggestion[] }>(`/api/instances/${selectedId.value}/paths/suggest`, { method: 'POST' })
    for (const s of r.suggestions) {
      const row = rows.value.find(x => x.servicePath === s.servicePath)
      if (row) {
        row.label = s.label
        if (!row.realPath && s.realPath) row.realPath = s.realPath
      } else {
        rows.value.push({ servicePath: s.servicePath, realPath: s.realPath ?? '', managed: s.managed, label: s.label })
      }
    }
    const missing = r.suggestions.filter(s => !s.realPath).length
    toast.add(missing
      ? { title: `${missing} chemin(s) sans suggestion`, description: `Complète-les à la main avec un dossier sous ${r.mediaRoot}.`, color: 'warning' }
      : { title: 'Suggestions ajoutées', description: 'Vérifie-les puis enregistre.', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Suggestions impossibles', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = null
  }
}

async function save() {
  if (!selectedId.value) return
  const filled = rows.value.filter(r => r.servicePath.trim() || r.realPath.trim())
  if (filled.some(r => !r.servicePath.trim() || !r.realPath.trim())) {
    toast.add({ title: 'Lignes incomplètes', description: 'Chaque ligne doit avoir un chemin de service et un chemin réel.', color: 'warning' })
    return
  }
  busy.value = 'save'
  try {
    const saved = await api<PathMapping[]>(`/api/instances/${selectedId.value}/paths`, {
      method: 'PUT',
      body: { mappings: filled.map(r => ({ servicePath: r.servicePath, realPath: r.realPath, managed: r.managed })) },
    })
    rows.value = saved.map(m => ({ servicePath: m.servicePath, realPath: m.realPath, managed: m.managed, label: rows.value.find(r => r.servicePath === m.servicePath)?.label }))
    toast.add({ title: 'Chemins enregistrés', description: 'Ils seront utilisés à la prochaine synchro.', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Enregistrement impossible', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = null
  }
}

async function verify() {
  if (!selectedId.value) return
  busy.value = 'verify'
  try {
    checks.value = (await api<{ ok: boolean; checks: PathCheck[] }>(`/api/instances/${selectedId.value}/paths/verify`, { method: 'POST' })).checks
  } catch (e) {
    toast.add({ title: 'Vérification impossible', description: errorMessage(e), color: 'error' })
  } finally {
    busy.value = null
  }
}

function addRow() {
  rows.value.push({ servicePath: '', realPath: '', managed: true })
}

function removeRow(index: number) {
  rows.value.splice(index, 1)
}

watch(selectedId, (id) => {
  void navigateTo({ query: id ? { instance: String(id) } : {} }, { replace: true })
  void load()
})

onMounted(async () => {
  try {
    if (!instances.value.length) instances.value = await api<InstanceDto[]>('/api/instances')
    mediaRootDir.value = (await api<{ mediaRoot: string }>('/api/settings/general')).mediaRoot
  } catch (e) {
    toast.add({ title: 'Chargement impossible', description: errorMessage(e), color: 'error' })
  }
  if (!selectedId.value && instances.value[0]) selectedId.value = instances.value[0].id
  else void load()
})
</script>

<template>
  <AppPage title="Chemins">
    <div class="space-y-4 max-w-5xl">
      <p class="text-sm text-muted">
        Chaque service voit les dossiers sous un chemin différent. Indique à quel dossier de
        <code>{{ mediaRootDir }}</code> (la racine médias montée dans Sortarr) correspond chaque chemin du service.
      </p>

      <div class="flex flex-wrap items-center gap-2">
        <USelect v-model="selectedId" :items="instanceItems" placeholder="Choisis une instance" class="w-72" />
        <UButton icon="i-lucide-wand-sparkles" label="Suggérer" variant="soft" :loading="busy === 'suggest'" :disabled="!selected" @click="suggest" />
        <UButton icon="i-lucide-plus" label="Ajouter une ligne" variant="ghost" :disabled="!selected" @click="addRow" />
        <div class="ml-auto flex gap-2">
          <UButton icon="i-lucide-search-check" label="Vérifier" variant="outline" :loading="busy === 'verify'" :disabled="!selected" @click="verify" />
          <UButton icon="i-lucide-save" label="Enregistrer" :loading="busy === 'save'" :disabled="!selected" @click="save" />
        </div>
      </div>

      <UCard v-if="selected">
        <div class="grid grid-cols-[1fr_1fr_auto_auto] gap-x-3 gap-y-2 items-center">
          <span class="text-xs font-medium text-muted">Chemin vu par {{ selected.name }}</span>
          <span class="text-xs font-medium text-muted">Chemin réel sous {{ mediaRootDir }}</span>
          <span class="text-xs font-medium text-muted">Géré</span>
          <span />
          <template v-for="(row, index) in rows" :key="index">
            <div>
              <UInput v-model="row.servicePath" placeholder="/movies" class="w-full" />
              <p v-if="row.label && row.label !== row.servicePath" class="text-xs text-muted mt-0.5">{{ row.label }}</p>
            </div>
            <UInput v-model="row.realPath" :placeholder="`${mediaRootDir}/movies`" class="w-full" :color="row.realPath ? undefined : 'warning'" />
            <UTooltip text="Décoché : dossier volontairement non géré par un *arr (exclu des orphelins).">
              <USwitch v-model="row.managed" />
            </UTooltip>
            <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" aria-label="Supprimer la ligne" @click="removeRow(index)" />
          </template>
        </div>
        <p v-if="!rows.length" class="text-sm text-muted py-4 text-center">
          Aucune correspondance. Clique sur « Suggérer » pour partir des dossiers découverts.
        </p>
      </UCard>

      <UCard v-if="checks">
        <template #header><h2 class="font-medium">Résultat de la vérification</h2></template>
        <ul class="space-y-1 text-sm">
          <li v-for="c in checks" :key="c.servicePath" class="flex items-start gap-2">
            <UIcon :name="c.exists ? 'i-lucide-circle-check' : 'i-lucide-circle-x'" :class="c.exists ? 'text-success' : 'text-error'" class="size-4 mt-0.5 shrink-0" />
            <span><code>{{ c.servicePath }}</code> → <code>{{ c.realPath ?? '?' }}</code> — {{ c.message }}</span>
          </li>
        </ul>
        <p v-if="!checks.length" class="text-sm text-muted">Rien à vérifier : enregistre d'abord des correspondances.</p>
      </UCard>
    </div>
  </AppPage>
</template>
```

> La vérification lit les correspondances **enregistrées** : enregistre avant de vérifier.

- [ ] **Step 2: Vérifier**

Run: `npm run typecheck`
Expected: aucune erreur.

Avec le serveur de dev (instances importées à la tâche 17) et `SORTARR_MEDIA_ROOT` pointant vers un dossier contenant `movies/` et `movies-4k/` (ex : `mkdir -p /tmp/nas/{movies,movies-4k,series} && SORTARR_MEDIA_ROOT=/tmp/nas npm run dev`) :
- sélectionner Radarr 4K › « Suggérer » : `/movies` est proposé vers `/tmp/nas/movies` → le corriger en `/tmp/nas/movies-4k` ;
- Jellyfin : `/data/tvshows` n'a pas de suggestion (toast orange) → saisir `/tmp/nas/series` ;
- « Enregistrer », puis « Vérifier » : chaque ligne affiche OK ou « Dossier introuvable » ;
- un chemin réel hors de la racine (ex : `/etc`) est refusé avec un message clair.

- [ ] **Step 3: Commit**

```bash
git add app
git commit -m "feat(ui): page Chemins avec suggestions et vérification"
```

---

### Task 19: Interface — Catalogue, éditeur de filtres et fiche détaillée

**Files:**
- Create: `app/components/FilterBuilder.vue`, `app/components/FilterConditionRow.vue`, `app/components/ItemDetail.vue`, `app/pages/catalogue.vue`

**Interfaces:**
- Consumes: `POST /api/catalog/query`, `GET /api/catalog/fields`, `GET /api/catalog/items/:id` ; `OPERATORS`, `defaultCondition`, `defaultValue`, `emptyFilter`, `validateFilter`, types `FieldDef`, `FilterGroup`, `FilterCondition`, `FilterNode`, `FilterField`, `Op`, `FilterValue`, `CatalogRow`, `CatalogResult`, `SortField`, `ItemDetail` ; `languageLabel`, `resolutionLabel`, `formatSize`, `formatDate`, `formatDateTime`.
- Produces:
  - `<FilterBuilder v-model="FilterGroup" :fields="FieldDef[]" :depth?="number" @remove>` — récursif, jamais de mutation de la prop (émet un nouvel objet). Le même composant servira à l'éditeur de règles en phase 2.
  - `<FilterConditionRow v-model="FilterCondition" :fields @remove>`.
  - `<ItemDetail v-model:id="number | null">` — panneau latéral.

- [ ] **Step 1: Écrire FilterConditionRow**

`app/components/FilterConditionRow.vue` :

```vue
<script setup lang="ts">
import { OPERATORS, defaultCondition, defaultValue, type FieldDef, type FilterCondition, type FilterField, type FilterValue, type Op } from '#shared/filters'

const props = defineProps<{ modelValue: FilterCondition; fields: FieldDef[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: FilterCondition]; remove: [] }>()

const field = computed(() => props.fields.find(f => f.key === props.modelValue.field) ?? props.fields[0]!)
const ops = computed(() => OPERATORS[field.value.type])
const opDef = computed(() => ops.value.find(o => o.op === props.modelValue.op) ?? ops.value[0]!)
const fieldItems = computed(() => props.fields.map(f => ({ label: f.label, value: f.key })))
const opItems = computed(() => ops.value.map(o => ({ label: o.label, value: o.op })))
const optionItems = computed(() => (field.value.options ?? []).map(o => ({ label: o.label, value: o.value })))
const isNumber = computed(() => field.value.type === 'number')

function setField(value: unknown) {
  const next = props.fields.find(f => f.key === (value as FilterField))
  if (next) emit('update:modelValue', defaultCondition(next))
}

function setOp(value: unknown) {
  const def = ops.value.find(o => o.op === (value as Op))
  if (def) emit('update:modelValue', { ...props.modelValue, op: def.op, value: defaultValue(field.value, def.value) })
}

function setValue(value: FilterValue) {
  emit('update:modelValue', { ...props.modelValue, value })
}

function setSingle(value: unknown) {
  setValue(isNumber.value ? Number(value) : String(value ?? ''))
}

function setPair(index: 0 | 1, value: unknown) {
  const pair = Array.isArray(props.modelValue.value) ? [...props.modelValue.value] : [0, 0]
  pair[index] = Number(value ?? 0)
  setValue(pair)
}

function setMulti(value: unknown) {
  setValue(Array.isArray(value) ? (value as (string | number)[]).map(String) : [])
}

const single = computed(() => (props.modelValue.value ?? '') as string | number)
const pair = computed(() => (Array.isArray(props.modelValue.value) ? props.modelValue.value : [0, 0]) as number[])
const multi = computed(() => (Array.isArray(props.modelValue.value) ? props.modelValue.value.map(String) : []))
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <USelect :model-value="modelValue.field" :items="fieldItems" class="w-56" @update:model-value="setField" />
    <USelect :model-value="modelValue.op" :items="opItems" class="w-52" @update:model-value="setOp" />

    <template v-if="opDef.value === 'single'">
      <USelectMenu
        v-if="optionItems.length"
        :model-value="String(single)"
        :items="optionItems"
        value-key="value"
        class="w-56"
        @update:model-value="setSingle"
      />
      <UInputNumber v-else-if="isNumber" :model-value="Number(single)" :step="field.unit === 'Go' ? 0.5 : 1" class="w-36" @update:model-value="setSingle" />
      <UInput v-else :model-value="String(single)" class="w-56" @update:model-value="setSingle" />
      <span v-if="field.unit" class="text-sm text-muted">{{ field.unit }}</span>
    </template>

    <template v-else-if="opDef.value === 'pair'">
      <UInputNumber :model-value="pair[0]" class="w-32" @update:model-value="(v: unknown) => setPair(0, v)" />
      <span class="text-sm text-muted">et</span>
      <UInputNumber :model-value="pair[1]" class="w-32" @update:model-value="(v: unknown) => setPair(1, v)" />
    </template>

    <template v-else-if="opDef.value === 'multi'">
      <USelectMenu v-if="optionItems.length" :model-value="multi" :items="optionItems" value-key="value" multiple class="w-72" @update:model-value="setMulti" />
      <UInputTags v-else :model-value="multi" placeholder="Valeur puis Entrée" class="w-72" @update:model-value="setMulti" />
    </template>

    <template v-else-if="opDef.value === 'days'">
      <UInputNumber :model-value="Number(single)" :min="0" class="w-32" @update:model-value="setSingle" />
      <span class="text-sm text-muted">jours</span>
    </template>

    <UInput v-else-if="opDef.value === 'date'" type="date" :model-value="String(single)" class="w-44" @update:model-value="setSingle" />

    <UButton icon="i-lucide-trash-2" color="neutral" variant="ghost" size="sm" aria-label="Supprimer la condition" @click="emit('remove')" />
  </div>
</template>
```

- [ ] **Step 2: Écrire FilterBuilder**

`app/components/FilterBuilder.vue` :

```vue
<script setup lang="ts">
import { defaultCondition, type FieldDef, type FilterGroup, type FilterNode } from '#shared/filters'

const props = withDefaults(defineProps<{ modelValue: FilterGroup; fields: FieldDef[]; depth?: number }>(), { depth: 0 })
const emit = defineEmits<{ 'update:modelValue': [value: FilterGroup]; remove: [] }>()

function update(patch: Partial<FilterGroup>) {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function setChild(index: number, node: FilterNode) {
  const children = [...props.modelValue.children]
  children[index] = node
  update({ children })
}

function removeChild(index: number) {
  update({ children: props.modelValue.children.filter((_, i) => i !== index) })
}

function addCondition() {
  update({ children: [...props.modelValue.children, defaultCondition(props.fields[0]!)] })
}

function addGroup() {
  update({ children: [...props.modelValue.children, { kind: 'group', mode: 'and', children: [] }] })
}
</script>

<template>
  <div class="space-y-2" :class="depth > 0 ? 'border-l-2 border-default pl-3 py-1' : ''">
    <div class="flex items-center gap-2">
      <UButton size="xs" :variant="modelValue.mode === 'and' ? 'solid' : 'outline'" label="Toutes les conditions (ET)" @click="update({ mode: 'and' })" />
      <UButton size="xs" :variant="modelValue.mode === 'or' ? 'solid' : 'outline'" label="Au moins une (OU)" @click="update({ mode: 'or' })" />
      <UButton v-if="depth > 0" size="xs" icon="i-lucide-x" color="neutral" variant="ghost" aria-label="Supprimer le groupe" @click="emit('remove')" />
    </div>

    <template v-for="(child, index) in modelValue.children" :key="index">
      <FilterBuilder
        v-if="child.kind === 'group'"
        :model-value="child"
        :fields="fields"
        :depth="depth + 1"
        @update:model-value="(node: FilterGroup) => setChild(index, node)"
        @remove="removeChild(index)"
      />
      <FilterConditionRow
        v-else
        :model-value="child"
        :fields="fields"
        @update:model-value="(node: FilterNode) => setChild(index, node)"
        @remove="removeChild(index)"
      />
    </template>

    <div class="flex gap-2">
      <UButton size="xs" variant="soft" icon="i-lucide-plus" label="Condition" @click="addCondition" />
      <UButton v-if="depth < 3" size="xs" variant="ghost" icon="i-lucide-brackets" label="Groupe" @click="addGroup" />
    </div>
  </div>
</template>
```

- [ ] **Step 3: Écrire ItemDetail**

`app/components/ItemDetail.vue` :

```vue
<script setup lang="ts">
import type { ItemDetail } from '#shared/catalog'
import { KIND_LABELS } from '#shared/instances'
import { formatDate, formatDateTime, formatSize } from '#shared/format'
import { languageLabel, resolutionLabel } from '#shared/media'

const id = defineModel<number | null>('id', { required: true })
const api = useApi()
const toast = useToast()
const detail = ref<ItemDetail | null>(null)
const open = computed({
  get: () => id.value !== null,
  set: (value: boolean) => { if (!value) id.value = null },
})

watch(id, async (value) => {
  detail.value = null
  if (value === null) return
  try {
    detail.value = await api<ItemDetail>(`/api/catalog/items/${value}`)
  } catch (e) {
    toast.add({ title: 'Fiche indisponible', description: errorMessage(e), color: 'error' })
    id.value = null
  }
}, { immediate: true })

const GB = 1024 ** 3
const langs = (codes: string[]) => (codes.length ? codes.map(languageLabel).join(', ') : '—')
const yesNo = (v: boolean | null) => (v === null ? '—' : v ? 'oui' : 'non')
const MAX_FILES = 100
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="detail ? `${detail.item.title}${detail.item.year ? ` (${detail.item.year})` : ''}` : 'Chargement…'"
    :description="detail ? (detail.item.type === 'movie' ? 'Film' : 'Série') : undefined"
    :ui="{ content: 'max-w-3xl' }"
  >
    <template #body>
      <div v-if="detail" class="space-y-6 text-sm">
        <section>
          <h3 class="font-semibold mb-2">Informations</h3>
          <dl class="grid grid-cols-[10rem_1fr] gap-y-1">
            <dt class="text-muted">Langue originale</dt><dd>{{ detail.item.originalLanguage ? languageLabel(detail.item.originalLanguage) : '—' }}</dd>
            <dt class="text-muted">Genres</dt><dd>{{ detail.item.genres.join(', ') || '—' }}</dd>
            <dt class="text-muted">Notes</dt><dd>TMDB {{ detail.item.ratingTmdb ?? '—' }} · IMDb {{ detail.item.ratingImdb ?? '—' }}</dd>
            <dt class="text-muted">Ajouté le</dt><dd>{{ formatDate(detail.item.addedAt) }}</dd>
            <dt class="text-muted">Identifiants</dt><dd>TMDB {{ detail.item.tmdbId ?? '—' }} · TVDB {{ detail.item.tvdbId ?? '—' }} · IMDb {{ detail.item.imdbId ?? '—' }}</dd>
          </dl>
        </section>

        <section>
          <h3 class="font-semibold mb-2">Présences</h3>
          <table class="w-full">
            <thead class="text-left text-muted"><tr><th>Instance</th><th>Bibliothèque / dossier racine</th><th>Suivi</th><th>Chemin réel</th></tr></thead>
            <tbody>
              <tr v-for="p in detail.presences" :key="`${p.instanceId}-${p.externalId}`" class="border-t border-default">
                <td class="py-1">{{ p.instanceName }} <span class="text-muted">({{ KIND_LABELS[p.kind] }})</span></td>
                <td>{{ p.library ?? p.rootFolder ?? '—' }}</td>
                <td>{{ yesNo(p.monitored) }}</td>
                <td class="break-all"><code>{{ p.realFolder ?? 'sans correspondance' }}</code></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3 class="font-semibold mb-2">Fichiers ({{ detail.files.length }})</h3>
          <table v-if="detail.files.length" class="w-full">
            <thead class="text-left text-muted"><tr><th v-if="detail.item.type === 'series'">Épisode</th><th>Résolution</th><th>Codec</th><th>Audio</th><th>Sous-titres</th><th>Taille</th></tr></thead>
            <tbody>
              <tr v-for="(f, i) in detail.files.slice(0, MAX_FILES)" :key="i" class="border-t border-default" :title="f.realPath ?? ''">
                <td v-if="detail.item.type === 'series'" class="py-1">S{{ String(f.season ?? 0).padStart(2, '0') }}E{{ String(f.episode ?? 0).padStart(2, '0') }}</td>
                <td class="py-1">{{ resolutionLabel(f.resolution) }}{{ f.isRemux ? ' remux' : '' }}</td>
                <td>{{ f.videoCodec ?? '—' }}</td>
                <td>{{ langs(f.audioLanguages) }}</td>
                <td>{{ langs(f.subtitleLanguages) }}</td>
                <td>{{ formatSize(f.size / GB) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="detail.files.length > MAX_FILES" class="text-muted mt-1">… et {{ detail.files.length - MAX_FILES }} autres fichiers.</p>
          <p v-if="!detail.files.length" class="text-muted">Aucun fichier connu des *arr.</p>
        </section>

        <section>
          <h3 class="font-semibold mb-2">Visionnage</h3>
          <ul v-if="detail.history.length" class="space-y-1">
            <li v-for="(h, i) in detail.history" :key="i">{{ h.serverName }} · {{ h.user }} — {{ h.playCount }} lecture(s), dernière le {{ formatDateTime(h.lastWatchedAt) }}</li>
          </ul>
          <p v-else class="text-muted">Jamais vu.</p>
        </section>
      </div>
    </template>
  </USlideover>
</template>
```

- [ ] **Step 4: Écrire la page Catalogue**

`app/pages/catalogue.vue` :

```vue
<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { emptyFilter, validateFilter, type CatalogRow, type FieldDef, type FilterGroup } from '#shared/filters'
import type { CatalogResult, SortField } from '#shared/catalog'
import type { InstanceDto } from '#shared/instances'
import { languageLabel, resolutionLabel } from '#shared/media'
import { formatDate, formatSize } from '#shared/format'

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')

const api = useApi()
const toast = useToast()
const instances = useState<InstanceDto[]>('instances', () => [])
const fields = ref<FieldDef[]>([])
const filter = ref<FilterGroup>(emptyFilter())
const search = ref('')
const page = ref(1)
const PAGE_SIZE = 50
const sort = ref<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'title', dir: 'asc' })
const result = ref<CatalogResult>({ rows: [], total: 0, totalSizeGb: 0 })
const loading = ref(false)
const showFilters = ref(false)
const detailId = ref<number | null>(null)

const filterErrors = computed(() => validateFilter(filter.value))
function countConditions(group: FilterGroup): number {
  return group.children.reduce((n, c) => n + (c.kind === 'group' ? countConditions(c) : 1), 0)
}
const activeConditions = computed(() => countConditions(filter.value))

async function load() {
  if (filterErrors.value.length) return
  loading.value = true
  try {
    result.value = await api<CatalogResult>('/api/catalog/query', {
      method: 'POST',
      body: { filter: filter.value, search: search.value.trim() || undefined, sort: sort.value, page: page.value, pageSize: PAGE_SIZE },
    })
  } catch (e) {
    toast.add({ title: 'Catalogue indisponible', description: errorMessage(e), color: 'error' })
  } finally {
    loading.value = false
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined
function reloadFromStart() {
  clearTimeout(debounce)
  debounce = setTimeout(() => {
    if (page.value !== 1) page.value = 1
    else void load()
  }, 300)
}
watch([filter, search], reloadFromStart, { deep: true })
watch([page, sort], load, { deep: true })
onSyncFinished(load)

onMounted(async () => {
  try {
    const [f, list] = await Promise.all([api<{ fields: FieldDef[] }>('/api/catalog/fields'), api<InstanceDto[]>('/api/instances')])
    fields.value = f.fields
    instances.value = list
  } catch (e) {
    toast.add({ title: 'Chargement impossible', description: errorMessage(e), color: 'error' })
  }
  await load()
})

const instanceName = (id: string) => instances.value.find(i => String(i.id) === id)?.name ?? `#${id}`
const langs = (codes: string[]) => (codes.length ? codes.map(languageLabel).join(', ') : '—')

function sortHeader(label: string, field: SortField) {
  return () => h(UButton, {
    color: 'neutral',
    variant: 'ghost',
    label,
    class: '-mx-2.5',
    icon: sort.value.field === field ? (sort.value.dir === 'asc' ? 'i-lucide-arrow-up-narrow-wide' : 'i-lucide-arrow-down-wide-narrow') : 'i-lucide-arrow-up-down',
    onClick: () => { sort.value = { field, dir: sort.value.field === field && sort.value.dir === 'asc' ? 'desc' : 'asc' } },
  })
}

const COLUMN_LABELS: Record<string, string> = {
  type: 'Type', instances: 'Instances', libraries: 'Bibliothèques', sizeGb: 'Taille', resolution: 'Résolution',
  audioLanguages: 'Audio', subtitleLanguages: 'Sous-titres', originalLanguage: 'Langue originale', addedAt: 'Ajouté', lastWatchedAt: 'Dernier visionnage',
}

const columns: TableColumn<CatalogRow>[] = [
  {
    id: 'title',
    header: sortHeader('Titre', 'title'),
    cell: ({ row }) => h('button', { class: 'text-left hover:underline', onClick: () => { detailId.value = row.original.id } }, [
      h('span', { class: 'font-medium' }, row.original.title),
      row.original.year ? h('span', { class: 'text-muted ml-1' }, `(${row.original.year})`) : null,
    ]),
  },
  {
    id: 'type',
    header: 'Type',
    cell: ({ row }) => h(UBadge, { variant: 'subtle', color: row.original.type === 'movie' ? 'primary' : 'info' }, () => (row.original.type === 'movie' ? 'Film' : 'Série')),
  },
  {
    id: 'instances',
    header: 'Instances',
    cell: ({ row }) => row.original.instances.length
      ? h('div', { class: 'flex flex-wrap gap-1' }, row.original.instances.map(id => h(UBadge, { variant: 'outline', color: 'neutral', size: 'sm' }, () => instanceName(id))))
      : h('span', { class: 'text-warning' }, 'aucune'),
  },
  { id: 'libraries', header: 'Bibliothèques', cell: ({ row }) => row.original.libraries.join(', ') || '—' },
  { id: 'sizeGb', header: sortHeader('Taille', 'sizeGb'), cell: ({ row }) => formatSize(row.original.sizeGb) },
  { id: 'resolution', header: sortHeader('Résolution', 'resolution'), cell: ({ row }) => resolutionLabel(row.original.resolution) },
  { id: 'audioLanguages', header: 'Audio', cell: ({ row }) => langs(row.original.audioLanguages) },
  { id: 'subtitleLanguages', header: 'Sous-titres', cell: ({ row }) => langs(row.original.subtitleLanguages) },
  { id: 'originalLanguage', header: 'Langue originale', cell: ({ row }) => (row.original.originalLanguage ? languageLabel(row.original.originalLanguage) : '—') },
  { id: 'addedAt', header: sortHeader('Ajouté', 'addedAt'), cell: ({ row }) => formatDate(row.original.addedAt) },
  { id: 'lastWatchedAt', header: sortHeader('Dernier visionnage', 'lastWatchedAt'), cell: ({ row }) => (row.original.lastWatchedAt ? formatDate(row.original.lastWatchedAt) : 'jamais') },
]

const VISIBILITY_KEY = 'sortarr.catalogue.columns'
function readVisibility(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(VISIBILITY_KEY) ?? '{}') as Record<string, boolean> } catch { return {} }
}
const columnVisibility = ref<Record<string, boolean>>(readVisibility())
watch(columnVisibility, (value) => {
  try { localStorage.setItem(VISIBILITY_KEY, JSON.stringify(value)) } catch { /* stockage indisponible */ }
}, { deep: true })

const columnItems = computed(() => Object.entries(COLUMN_LABELS).map(([id, label]) => ({
  label,
  type: 'checkbox' as const,
  checked: columnVisibility.value[id] !== false,
  onUpdateChecked: (checked: boolean) => { columnVisibility.value = { ...columnVisibility.value, [id]: checked } },
  onSelect: (e: Event) => e.preventDefault(),
})))
</script>

<template>
  <AppPage title="Catalogue">
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <UInput v-model="search" icon="i-lucide-search" placeholder="Rechercher un titre…" class="w-72" />
        <UButton
          :label="activeConditions ? `Filtres (${activeConditions})` : 'Filtres'"
          icon="i-lucide-filter"
          :variant="showFilters ? 'solid' : 'soft'"
          @click="showFilters = !showFilters"
        />
        <UButton v-if="activeConditions" label="Effacer les filtres" color="neutral" variant="ghost" @click="filter = emptyFilter()" />
        <div class="ml-auto flex items-center gap-3 text-sm text-muted">
          <span>{{ result.total.toLocaleString('fr-FR') }} titres · {{ formatSize(result.totalSizeGb) }}</span>
          <UDropdownMenu :items="columnItems" :content="{ align: 'end' }">
            <UButton label="Colonnes" color="neutral" variant="outline" trailing-icon="i-lucide-chevron-down" />
          </UDropdownMenu>
        </div>
      </div>

      <UCard v-if="showFilters">
        <FilterBuilder v-if="fields.length" v-model="filter" :fields="fields" />
        <UAlert v-if="filterErrors.length" class="mt-3" color="warning" variant="subtle" icon="i-lucide-triangle-alert" title="Filtre incomplet" :description="filterErrors.join(' ; ')" />
      </UCard>

      <UTable v-model:column-visibility="columnVisibility" :data="result.rows" :columns="columns" :loading="loading" sticky class="max-h-[calc(100vh-16rem)]" />
      <p v-if="!loading && !result.total" class="text-center text-muted py-6">
        Aucun titre. Lance une synchro, ou élargis les filtres.
      </p>

      <div v-if="result.total > PAGE_SIZE" class="flex justify-center">
        <UPagination v-model:page="page" :total="result.total" :items-per-page="PAGE_SIZE" />
      </div>
    </div>

    <ItemDetail v-model:id="detailId" />
  </AppPage>
</template>
```

- [ ] **Step 5: Vérifier**

Run: `npm run typecheck`
Expected: aucune erreur.

Avec le serveur de dev, les instances importées et les chemins configurés, cliquer sur « Synchroniser » puis ouvrir `/catalogue` :
- environ 1 535 + 212 films et 780 + 100 séries ; la ligne du haut affiche le total et la taille ;
- la recherche « dune » filtre instantanément (300 ms) ;
- filtre « Langue originale est Anglais » ET « Instance *arr ne contient pas Radarr 4K » : la liste montre les films anglais hors 4K ;
- une condition incomplète (ex : « est parmi » sans valeur) affiche « Filtre incomplet » et ne recharge pas ;
- tri par taille décroissante ; masquer une colonne, recharger la page : le réglage est conservé ;
- cliquer sur un titre ouvre la fiche : présences (Radarr + Plex + Jellyfin), fichiers, visionnage.

- [ ] **Step 6: Commit**

```bash
git add app
git commit -m "feat(ui): catalogue avec éditeur de filtres et fiche détaillée"
```

---

### Task 20: Interface — Tableau de bord et réglages généraux

**Files:**
- Create: `app/pages/reglages/general.vue`
- Modify: `app/pages/index.vue`

**Interfaces:**
- Consumes: `GET /api/dashboard`, `GET /api/settings/general`, `PUT /api/settings/sync`, `POST /api/auth/password` ; `DashboardDto`, `passwordChangeSchema`, `STATUS_DOT`, `STATUS_LABELS`, `KIND_LABELS`, `formatSize`, `formatDateTime`.

- [ ] **Step 1: Écrire le tableau de bord**

`app/pages/index.vue` :

```vue
<script setup lang="ts">
import type { DashboardDto } from '#shared/catalog'
import { KIND_LABELS, STATUS_DOT, STATUS_LABELS } from '#shared/instances'
import { formatDateTime, formatSize } from '#shared/format'

const api = useApi()
const toast = useToast()
const data = ref<DashboardDto | null>(null)

async function load() {
  try {
    data.value = await api<DashboardDto>('/api/dashboard')
  } catch (e) {
    toast.add({ title: 'Tableau de bord indisponible', description: errorMessage(e), color: 'error' })
  }
}
onMounted(load)
onSyncFinished(load)

const stats = computed(() => data.value
  ? [
      { label: 'Films', value: data.value.movies.toLocaleString('fr-FR'), icon: 'i-lucide-film' },
      { label: 'Séries', value: data.value.series.toLocaleString('fr-FR'), icon: 'i-lucide-tv' },
      { label: 'Espace utilisé', value: formatSize(data.value.totalSizeGb), icon: 'i-lucide-hard-drive' },
      { label: 'Jamais vus', value: data.value.neverWatched.toLocaleString('fr-FR'), icon: 'i-lucide-eye-off' },
    ]
  : [])
</script>

<template>
  <AppPage title="Tableau de bord">
    <div v-if="data" class="space-y-6">
      <UAlert
        v-if="!data.instances.length"
        color="info"
        variant="subtle"
        icon="i-lucide-server"
        title="Aucune instance configurée"
        description="Ajoute tes Radarr, Sonarr, Plex et Jellyfin pour remplir le catalogue."
        :actions="[{ label: 'Ajouter des instances', to: '/reglages/instances' }]"
      />

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <UCard v-for="s in stats" :key="s.label">
          <div class="flex items-center gap-3">
            <UIcon :name="s.icon" class="size-6 text-primary" />
            <div>
              <p class="text-2xl font-semibold">{{ s.value }}</p>
              <p class="text-sm text-muted">{{ s.label }}</p>
            </div>
          </div>
        </UCard>
      </div>

      <div class="grid lg:grid-cols-2 gap-4">
        <UCard>
          <template #header><h2 class="font-medium">Instances</h2></template>
          <ul class="space-y-2 text-sm">
            <li v-for="i in data.instances" :key="i.id" class="flex items-center gap-2">
              <span class="block size-2.5 rounded-full shrink-0" :class="i.enabled ? STATUS_DOT[i.lastStatus] : 'bg-neutral-300'" />
              <span class="font-medium">{{ i.name }}</span>
              <span class="text-muted">{{ KIND_LABELS[i.kind] }} · {{ i.enabled ? STATUS_LABELS[i.lastStatus] : 'désactivée' }}</span>
              <span class="ml-auto text-muted">{{ formatDateTime(i.lastSyncAt) }}</span>
            </li>
          </ul>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex justify-between items-center">
              <h2 class="font-medium">Dernière synchro</h2>
              <span class="text-sm text-muted">Prochaine : {{ formatDateTime(data.sync.nextRunAt) }}</span>
            </div>
          </template>
          <p v-if="!data.sync.finishedAt" class="text-sm text-muted">Aucune synchro pour l'instant.</p>
          <div v-else class="space-y-2 text-sm">
            <p class="text-muted">Terminée le {{ formatDateTime(data.sync.finishedAt) }}</p>
            <ul class="space-y-1">
              <li v-for="r in data.sync.results" :key="r.instanceId" class="flex items-start gap-2">
                <UIcon :name="r.ok ? 'i-lucide-circle-check' : 'i-lucide-circle-x'" :class="r.ok ? 'text-success' : 'text-error'" class="size-4 mt-0.5 shrink-0" />
                <span>
                  <span class="font-medium">{{ r.name }}</span> —
                  <template v-if="r.ok">{{ r.items }} titres, {{ r.files }} fichiers<span v-if="r.unmapped" class="text-warning">, {{ r.unmapped }} sans correspondance de chemin</span></template>
                  <span v-else class="text-error">{{ r.error }}</span>
                </span>
              </li>
            </ul>
          </div>
        </UCard>
      </div>
    </div>
  </AppPage>
</template>
```

- [ ] **Step 2: Écrire les réglages généraux**

`app/pages/reglages/general.vue` :

```vue
<script setup lang="ts">
import { passwordChangeSchema } from '#shared/auth'
import { formatDateTime } from '#shared/format'

interface General { mediaRoot: string; configDir: string; syncCron: string; nextSyncAt: number | null }

const api = useApi()
const toast = useToast()
const general = ref<General | null>(null)
const cron = ref('')
const savingCron = ref(false)
const PRESETS = [
  { label: 'Toutes les heures', value: '0 * * * *' },
  { label: 'Toutes les 6 heures', value: '0 */6 * * *' },
  { label: 'Chaque nuit à 4 h', value: '0 4 * * *' },
]

onMounted(async () => {
  try {
    general.value = await api<General>('/api/settings/general')
    cron.value = general.value.syncCron
  } catch (e) {
    toast.add({ title: 'Réglages indisponibles', description: errorMessage(e), color: 'error' })
  }
})

async function saveCron() {
  savingCron.value = true
  try {
    general.value = await api<General>('/api/settings/sync', { method: 'PUT', body: { cron: cron.value } })
    toast.add({ title: 'Planification enregistrée', description: `Prochaine synchro : ${formatDateTime(general.value.nextSyncAt)}`, color: 'success' })
  } catch (e) {
    toast.add({ title: 'Enregistrement impossible', description: errorMessage(e), color: 'error' })
  } finally {
    savingCron.value = false
  }
}

const password = reactive({ current: '', next: '', confirm: '' })
const savingPassword = ref(false)
async function changePassword() {
  savingPassword.value = true
  try {
    await api('/api/auth/password', { method: 'POST', body: password })
    Object.assign(password, { current: '', next: '', confirm: '' })
    toast.add({ title: 'Mot de passe changé', description: 'Les autres sessions ont été fermées.', color: 'success' })
  } catch (e) {
    toast.add({ title: 'Changement impossible', description: errorMessage(e), color: 'error' })
  } finally {
    savingPassword.value = false
  }
}
</script>

<template>
  <AppPage title="Général">
    <div class="space-y-6 max-w-2xl">
      <UCard>
        <template #header><h2 class="font-medium">Synchronisation</h2></template>
        <div class="space-y-3">
          <div class="flex flex-wrap gap-2">
            <UButton v-for="p in PRESETS" :key="p.value" size="sm" :variant="cron === p.value ? 'solid' : 'outline'" :label="p.label" @click="cron = p.value" />
          </div>
          <UFormField label="Expression cron" description="Minute, heure, jour du mois, mois, jour de la semaine.">
            <UInput v-model="cron" class="w-60 font-mono" />
          </UFormField>
          <div class="flex items-center gap-3">
            <UButton label="Enregistrer" :loading="savingCron" @click="saveCron" />
            <span class="text-sm text-muted">Prochaine synchro : {{ formatDateTime(general?.nextSyncAt ?? null) }}</span>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header><h2 class="font-medium">Mot de passe</h2></template>
        <UForm :schema="passwordChangeSchema" :state="password" class="space-y-3" @submit="changePassword">
          <UFormField label="Mot de passe actuel" name="current"><UInput v-model="password.current" type="password" autocomplete="current-password" class="w-72" /></UFormField>
          <UFormField label="Nouveau mot de passe" name="next"><UInput v-model="password.next" type="password" autocomplete="new-password" class="w-72" /></UFormField>
          <UFormField label="Confirmation" name="confirm"><UInput v-model="password.confirm" type="password" autocomplete="new-password" class="w-72" /></UFormField>
          <UButton type="submit" label="Changer le mot de passe" :loading="savingPassword" />
        </UForm>
      </UCard>

      <UCard v-if="general">
        <template #header><h2 class="font-medium">Dossiers</h2></template>
        <dl class="grid grid-cols-[12rem_1fr] gap-y-1 text-sm">
          <dt class="text-muted">Racine médias</dt><dd><code>{{ general.mediaRoot }}</code></dd>
          <dt class="text-muted">Configuration</dt><dd><code>{{ general.configDir }}</code></dd>
        </dl>
      </UCard>
    </div>
  </AppPage>
</template>
```

- [ ] **Step 3: Vérifier**

Run: `npm run typecheck`
Expected: aucune erreur.

Avec le serveur de dev **sans** `SORTARR_DISABLE_SCHEDULER` :
- `/` affiche les compteurs, l'état des instances et le résultat de la dernière synchro (avec le nombre de titres « sans correspondance de chemin ») ;
- `/reglages/general` : choisir « Chaque nuit à 4 h », enregistrer → « Prochaine synchro : <date> à 04:00 » ; une expression invalide affiche le message d'erreur ;
- changer le mot de passe puis se reconnecter avec le nouveau.

- [ ] **Step 4: Commit**

```bash
git add app
git commit -m "feat(ui): tableau de bord et réglages généraux"
```

---

### Task 21: Docker, Unraid et README

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `entrypoint.sh`, `docker-compose.yml`, `unraid/sortarr.xml`, `README.md`

**Interfaces:**
- Consumes: `GET /api/health` (healthcheck), variables `SORTARR_CONFIG_DIR`, `SORTARR_MEDIA_ROOT`, `TZ`, `COOKIE_SECURE`, `PUID`, `PGID`.

- [ ] **Step 1: Écrire les fichiers**

`.dockerignore` :

```
node_modules
.nuxt
.output
config
media.env
*.env
tests
docs
.git
```

`Dockerfile` :

```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
# Compilation de better-sqlite3 sur Alpine
RUN apk add --no-cache python3 build-base
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache curl su-exec tini
COPY --from=builder /app/.output ./.output
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SORTARR_CONFIG_DIR=/config \
    SORTARR_MEDIA_ROOT=/media

EXPOSE 3000
VOLUME ["/config"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/bin/sh", "./entrypoint.sh"]
```

`entrypoint.sh` :

```sh
#!/bin/sh
set -e

# Unraid : nobody:users = 99:100
PUID=${PUID:-99}
PGID=${PGID:-100}

case "$PUID" in ''|*[!0-9]*) echo "PUID doit être un nombre (reçu '$PUID')." >&2; exit 1 ;; esac
case "$PGID" in ''|*[!0-9]*) echo "PGID doit être un nombre (reçu '$PGID')." >&2; exit 1 ;; esac

CONFIG_DIR=${SORTARR_CONFIG_DIR:-/config}
mkdir -p "$CONFIG_DIR"

# Seul /config change de propriétaire, et seulement si nécessaire.
# /media n'est jamais modifié ici : les droits du NAS restent ceux de l'utilisateur.
OWNER=$(ls -nd "$CONFIG_DIR" | awk '{print $3":"$4}')
if [ "$OWNER" != "$PUID:$PGID" ]; then
  chown -R "$PUID:$PGID" "$CONFIG_DIR"
fi

umask "${UMASK:-022}"
exec su-exec "$PUID:$PGID" node .output/server/index.mjs
```

`docker-compose.yml` :

```yaml
services:
  sortarr:
    build: .
    image: ghcr.io/lightmaster00/sortarr:latest
    container_name: sortarr
    restart: unless-stopped
    init: false # tini est déjà le PID 1 de l'image
    security_opt:
      - no-new-privileges:true
    ports:
      - "3000:3000"
    volumes:
      # Base SQLite, secret de chiffrement, media.env facultatif
      - ./config:/config
      # La racine médias du NAS, celle qui contient movies/, movies-4k/, series/…
      - /mnt/user/media:/media
    environment:
      - PUID=99
      - PGID=100
      - TZ=Europe/Paris
      # Derrière un reverse proxy en HTTPS :
      # - COOKIE_SECURE=true
```

`unraid/sortarr.xml` :

```xml
<?xml version="1.0"?>
<Container version="2">
  <Name>sortarr</Name>
  <Repository>ghcr.io/lightmaster00/sortarr:latest</Repository>
  <Network>bridge</Network>
  <Shell>sh</Shell>
  <Privileged>false</Privileged>
  <WebUI>http://[IP]:[PORT:3000]/</WebUI>
  <Overview>Administration de la médiathèque : catalogue unifié Radarr / Sonarr / Plex / Jellyfin, audit, règles et migrations.</Overview>
  <Category>MediaServer:Other Tools:</Category>
  <Config Name="Interface web" Target="3000" Default="3000" Mode="tcp" Description="Port de l'interface" Type="Port" Display="always" Required="true">3000</Config>
  <Config Name="Configuration" Target="/config" Default="/mnt/user/appdata/sortarr" Mode="rw" Description="Base de données, secret de chiffrement, media.env" Type="Path" Display="always" Required="true">/mnt/user/appdata/sortarr</Config>
  <Config Name="Médias" Target="/media" Default="/mnt/user/media" Mode="rw" Description="Racine des médias (contient movies, movies-4k, series…)" Type="Path" Display="always" Required="true">/mnt/user/media</Config>
  <Config Name="PUID" Target="PUID" Default="99" Type="Variable" Display="advanced" Required="false">99</Config>
  <Config Name="PGID" Target="PGID" Default="100" Type="Variable" Display="advanced" Required="false">100</Config>
  <Config Name="Fuseau horaire" Target="TZ" Default="Europe/Paris" Type="Variable" Display="advanced" Required="false">Europe/Paris</Config>
  <Config Name="Cookie sécurisé" Target="COOKIE_SECURE" Default="false" Description="true si l'accès passe par un reverse proxy HTTPS" Type="Variable" Display="advanced" Required="false">false</Config>
</Container>
```

`README.md` :

````markdown
# Sortarr

Administration de la médiathèque : un catalogue unique qui rassemble Radarr, Sonarr, Plex et Jellyfin.

Phase 1 (cette version) : connexion admin, gestion des instances depuis l'interface, correspondance des chemins,
synchronisation planifiée et catalogue filtrable en lecture seule. Rien n'est modifié dans tes services.

## Démarrer avec Docker

```bash
docker compose up -d --build
```

Puis ouvrir http://<ip-du-serveur>:3000 :

1. créer le compte admin ;
2. **Réglages › Instances** : ajouter Radarr, Sonarr, Plex et Jellyfin (ou importer `media.env`, voir plus bas), puis « Tester la connexion » ;
3. **Réglages › Chemins** : pour chaque instance, « Suggérer », corriger, « Enregistrer », « Vérifier » ;
4. cliquer sur « Synchroniser » puis ouvrir le **Catalogue**.

### Volumes

| Conteneur | Rôle |
|---|---|
| `/config` | base SQLite, fichier `secret` (clé de chiffrement des clés API), `media.env` facultatif |
| `/media` | racine des médias du NAS, celle qui contient `movies/`, `movies-4k/`, `series/`… |

Garde une sauvegarde de `/config/secret` : sans lui, les clés API enregistrées sont illisibles et doivent être ressaisies.

### Importer media.env

Copier le fichier dans `/config/media.env`. Format : `<NOM>_URL` et `<NOM>_KEY` (ou `<NOM>_TOKEN` pour Plex), par exemple
`RADARR_4K_URL=http://192.168.1.11:7878` et `RADARR_4K_KEY=…`. Le type est deviné à partir du nom.

### Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `PUID` / `PGID` | `99` / `100` | utilisateur qui exécute l'app |
| `TZ` | — | fuseau horaire de la planification |
| `COOKIE_SECURE` | `false` | `true` derrière un reverse proxy HTTPS |

## Développement

```bash
npm install
npm test
SORTARR_CONFIG_DIR=./config SORTARR_MEDIA_ROOT=/chemin/vers/medias npm run dev
```

`npm run typecheck` vérifie les types. Les tests n'appellent jamais tes vrais services.
````

- [ ] **Step 2: Vérifier l'image (si Docker est disponible sur la machine)**

Run:

```bash
docker build -t sortarr:dev .
docker run -d --name sortarr-test -p 3999:3000 -v "$(mktemp -d)":/config -v /tmp:/media -e PUID=$(id -u) -e PGID=$(id -g) sortarr:dev
sleep 5 && curl -fsS http://127.0.0.1:3999/api/health
docker rm -f sortarr-test
```

Expected: `{"ok":true}`. Sans Docker sur la machine, noter que cette étape reste à faire sur le serveur.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore entrypoint.sh docker-compose.yml unraid README.md
git commit -m "chore: image Docker, modèle Unraid et README"
```

---

### Task 22: Fixtures enregistrées depuis les vrais services

**Files:**
- Create: `scripts/record-fixtures.mjs`, `tests/unit/connectors/recorded.test.ts`
- Generated: `tests/fixtures/recorded/*.json`

**Interfaces:**
- Consumes: `media.env` (lecture seule), mappers `mapRadarrMovie`, `mapSonarrSeries`, `mapPlexItem`, `aggregatePlexHistory`, `mapJellyfinItem`, `aggregateJellyfinPlayed`.
- Produces: fixtures JSON anonymisées ; un test qui fait passer les vraies réponses dans les mappers (ignoré si les fixtures sont absentes).

Le script ne fait que des requêtes GET. Il garde 15 éléments par liste et anonymise : comptes et noms d'utilisateurs, identifiant et nom de serveur, adresses IP. Les titres et chemins sont conservés (nécessaires aux tests) : relire les fixtures avant de publier le dépôt.

- [ ] **Step 1: Écrire le script**

`scripts/record-fixtures.mjs` :

```js
#!/usr/bin/env node
// Usage : node scripts/record-fixtures.mjs media.env
// Lecture seule : uniquement des requêtes GET vers les services déclarés dans media.env.
import fs from 'node:fs'
import path from 'node:path'

const envFile = process.argv[2] ?? 'media.env'
const env = Object.fromEntries(
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const outDir = path.resolve('tests/fixtures/recorded')
fs.mkdirSync(outDir, { recursive: true })
const LIMIT = 15

const REDACT = new Set(['machineIdentifier', 'ServerName', 'LocalAddress', 'WanAddress', 'LocalAddresses', 'RemoteAddresses', 'email', 'Email', 'username', 'thumb', 'PrimaryImageTag'])
const users = new Map()
function scrub(value, key) {
  if (Array.isArray(value)) return value.map(v => scrub(v))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]))
  if (key && REDACT.has(key)) return 'anonymisé'
  if (key === 'accountID') return 1
  if (typeof value === 'string') return value.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '10.0.0.1')
  return value
}
function anonymizeUsers(list) {
  return list.map((u, i) => {
    users.set(u.Name ?? u.name, `utilisateur-${i + 1}`)
    return { ...u, Name: `utilisateur-${i + 1}`, name: u.name ? `utilisateur-${i + 1}` : undefined }
  })
}

async function get(base, route, headers) {
  const res = await fetch(`${base.replace(/\/+$/, '')}${route}`, { headers: { Accept: 'application/json', ...headers } })
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${route.split('?')[0]}`)
  return res.json()
}
function save(name, data) {
  fs.writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(scrub(data), null, 2)}\n`)
  console.log(`✓ ${name}.json`)
}
const firstPrefix = re => Object.keys(env).find(k => k.endsWith('_URL') && re.test(k) && !/4K/.test(k))?.slice(0, -4)

async function radarr(p) {
  const h = { 'X-Api-Key': env[`${p}_KEY`] }
  const movies = await get(env[`${p}_URL`], '/api/v3/movie', h)
  save('radarr-movies', movies.filter(m => m.movieFile).slice(0, LIMIT))
  save('radarr-tags', await get(env[`${p}_URL`], '/api/v3/tag', h))
}
async function sonarr(p) {
  const h = { 'X-Api-Key': env[`${p}_KEY`] }
  const base = env[`${p}_URL`]
  const series = (await get(base, '/api/v3/series', h)).filter(s => (s.statistics?.episodeFileCount ?? 0) > 0).slice(0, 3)
  save('sonarr-series', series)
  const detail = []
  for (const s of series) {
    detail.push({ seriesId: s.id, episodes: await get(base, `/api/v3/episode?seriesId=${s.id}`, h), files: await get(base, `/api/v3/episodefile?seriesId=${s.id}`, h) })
  }
  save('sonarr-episodes', detail)
}
async function plex(p) {
  const h = { 'X-Plex-Token': env[`${p}_TOKEN`] ?? env[`${p}_KEY`] }
  const base = env[`${p}_URL`]
  const sections = await get(base, '/library/sections', h)
  save('plex-sections', sections)
  const dirs = sections.MediaContainer.Directory ?? []
  for (const type of ['movie', 'show']) {
    const s = dirs.find(d => d.type === type)
    if (!s) continue
    const all = await get(base, `/library/sections/${s.key}/all?includeGuids=1`, h)
    all.MediaContainer.Metadata = (all.MediaContainer.Metadata ?? []).slice(0, LIMIT)
    save(`plex-${type}-items`, { library: s.title, ...all })
  }
  const history = await get(base, '/status/sessions/history/all?sort=viewedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=50', h)
  save('plex-history', history)
  const accounts = await get(base, '/accounts', h)
  accounts.MediaContainer.Account = (accounts.MediaContainer.Account ?? []).map((a, i) => ({ id: 1, name: `utilisateur-${i + 1}` }))
  save('plex-accounts', accounts)
}
async function jellyfin(p) {
  const h = { Authorization: `MediaBrowser Token="${env[`${p}_KEY`]}"` }
  const base = env[`${p}_URL`]
  const libraries = await get(base, '/Library/VirtualFolders', h)
  save('jellyfin-libraries', libraries)
  const items = []
  for (const lib of libraries.filter(l => ['movies', 'tvshows'].includes(l.CollectionType))) {
    const r = await get(base, `/Items?ParentId=${lib.ItemId}&Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds,Path&EnableImages=false&Limit=${LIMIT}`, h)
    items.push({ library: lib.Name, items: r.Items })
  }
  save('jellyfin-items', items)
  const userList = await get(base, '/Users', h)
  const first = userList[0]
  if (first) {
    const played = await get(base, `/Items?userId=${first.Id}&Recursive=true&IncludeItemTypes=Movie,Episode&Filters=IsPlayed&Fields=ProviderIds&EnableImages=false&EnableUserData=true&Limit=${LIMIT}`, h)
    save('jellyfin-played', { user: 'utilisateur-1', items: played.Items })
  }
  save('jellyfin-users', anonymizeUsers(userList.map(u => ({ Id: u.Id, Name: u.Name }))))
}

const jobs = [
  ['RADARR', radarr], ['SONARR', sonarr], ['PLEX', plex], ['JELLYFIN', jellyfin],
]
for (const [name, fn] of jobs) {
  const prefix = firstPrefix(new RegExp(name))
  if (!prefix) { console.log(`- ${name} absent de ${envFile}`); continue }
  try { await fn(prefix) } catch (e) { console.error(`✗ ${name} : ${e.message}`) }
}
```

- [ ] **Step 2: Écrire le test de rejeu**

`tests/unit/connectors/recorded.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mapRadarrMovie, mapSonarrSeries, type ArrFile, type RadarrMovie, type SonarrEpisode, type SonarrSeries } from '../../../server/connectors/arr'
import { aggregatePlexHistory, mapPlexItem, type PlexHistoryEntry, type PlexMeta } from '../../../server/connectors/plex'
import { aggregateJellyfinPlayed, mapJellyfinItem, type JellyfinItem } from '../../../server/connectors/jellyfin'

const dir = path.resolve('tests/fixtures/recorded')
const has = (name: string) => fs.existsSync(path.join(dir, `${name}.json`))
const load = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8')) as T

describe('réponses enregistrées', () => {
  it.skipIf(!has('radarr-movies'))('Radarr : chaque film a un titre, un chemin et un fichier normalisé', () => {
    const tags = new Map(load<{ id: number; label: string }[]>('radarr-tags').map(t => [t.id, t.label]))
    for (const m of load<RadarrMovie[]>('radarr-movies')) {
      const r = mapRadarrMovie(m, tags)
      expect(r.title).toBeTruthy()
      expect(r.servicePath.startsWith('/')).toBe(true)
      expect(r.files).toHaveLength(1)
      expect(r.files[0]!.size).toBeGreaterThan(0)
    }
  })

  it.skipIf(!has('sonarr-episodes'))('Sonarr : les fichiers d\'épisodes sont rattachés à leur série', () => {
    const series = load<SonarrSeries[]>('sonarr-series')
    for (const d of load<{ seriesId: number; episodes: SonarrEpisode[]; files: ArrFile[] }[]>('sonarr-episodes')) {
      const r = mapSonarrSeries(series.find(s => s.id === d.seriesId)!, d.episodes, d.files, new Map())
      expect(r.files.length).toBe(d.files.length)
      expect(r.files.every(f => f.season !== null)).toBe(true)
    }
  })

  it.skipIf(!has('plex-movie-items'))('Plex : les films ont un dossier et au moins un identifiant', () => {
    const data = load<{ library: string; MediaContainer: { Metadata: PlexMeta[] } }>('plex-movie-items')
    const items = data.MediaContainer.Metadata.map(m => mapPlexItem(m, data.library))
    expect(items.every(i => i.servicePaths.length > 0)).toBe(true)
    expect(items.some(i => i.tmdbId || i.imdbId)).toBe(true)
  })

  it.skipIf(!has('plex-history'))("Plex : l'historique s'agrège", () => {
    const entries = load<{ MediaContainer: { Metadata?: PlexHistoryEntry[] } }>('plex-history').MediaContainer.Metadata ?? []
    const out = aggregatePlexHistory(entries, new Map())
    expect(out.length).toBeLessThanOrEqual(entries.length)
  })

  it.skipIf(!has('jellyfin-items'))('Jellyfin : les éléments ont un chemin et un type', () => {
    for (const lib of load<{ library: string; items: JellyfinItem[] }[]>('jellyfin-items')) {
      for (const it of lib.items) {
        const r = mapJellyfinItem(it, lib.library)
        expect(['movie', 'series']).toContain(r.type)
        expect(r.servicePaths.length).toBe(1)
      }
    }
  })

  it.skipIf(!has('jellyfin-played'))('Jellyfin : le visionnage s\'agrège', () => {
    const played = load<{ user: string; items: JellyfinItem[] }>('jellyfin-played')
    expect(aggregateJellyfinPlayed([played]).every(h => h.playCount >= 1)).toBe(true)
  })
})
```

- [ ] **Step 3: Enregistrer et rejouer**

Run: `node scripts/record-fixtures.mjs media.env`
Expected: une ligne `✓ …json` par fichier, aucune ligne `✗`. (Le script prend la première instance non-4K de chaque type.)

Run: `grep -rE '192\.168\.|X-Plex-Token|MediaBrowser Token' tests/fixtures/recorded || echo "rien de sensible"`
Expected: `rien de sensible`.

Run: `npx vitest run tests/unit/connectors/recorded.test.ts`
Expected: PASS (6 tests). Un échec ici révèle un écart entre les vraies réponses et les mappers : corriger le mapper concerné et ajouter le cas au test unitaire du connecteur.

- [ ] **Step 4: Lancer toute la suite**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: tout passe.

- [ ] **Step 5: Commit**

```bash
git add scripts tests
git commit -m "test: fixtures enregistrées depuis les vrais services"
```

---

## Couverture de la spec (phase 1)

| Exigence de la spec | Tâche |
|---|---|
| §3 Stack, Docker, modèle Unraid | 1, 21 |
| §3 Assistant de premier lancement + import `media.env` | 4 (création du compte), 11, 17 |
| §4.1 Instances : nombre libre, formulaire, test, découverte, désactivation, suppression gardée, clé jamais renvoyée | 10, 17 |
| §4.1 État des instances visible sur chaque page | 16 |
| §4.2 Correspondance des chemins, plus long préfixe, suggestions, vérification | 12, 18 |
| §4.3 Catalogue, rapprochement par chemin puis identifiant, fraîcheur « périmée » | 13, 15 |
| §5 Moteur de filtres (champs, opérateurs, Zod, champ inconnu = invalide) | 14, 19 |
| §9 Tableau de bord, Catalogue (colonnes configurables, fiche détaillée), Réglages (instances, chemins, synchro, mot de passe) | 16 à 20 |
| §10 Sécurité (bcrypt, cookie httpOnly/Lax, routes protégées, chiffrement des clés) | 3, 4, 10 |
| §11 Erreurs HTTP (15 s, 3 tentatives, réseau/5xx), synchro partielle | 5, 13 |
| §12 Tests (unitaires, fixtures réelles anonymisées, routes protégées, aucune écriture réelle) | toutes, 22 |

Hors phase 1 (prévu dans les phases suivantes de la spec) : règles et audit (phase 2, réutilise `FilterBuilder`, `matches` et `registerDeletionGuard`), mode simulation et suppressions (phase 3), migrations (phase 4), actions automatiques (phase 5).

## Passage de relais phases 2/3

Points relevés à la revue finale de la phase 1, à traiter avant ou pendant les phases suivantes :

- Les règles doivent refuser un filtre vide, y compris des groupes imbriqués vides (un filtre vide correspond à tout le catalogue).
- Une règle « jamais vu » exige au moins une présence fraîche sur un serveur (Plex ou Jellyfin) : sans serveur synchronisé, l'absence d'historique ne prouve rien.
- Les gardes de suppression d'instance doivent parcourir les filtres des règles à la recherche de l'identifiant (`instances` et `servers` stockent `String(id)`).
- Toute opération destructive revérifie `assertUnderMediaRoot` sur le `realpath` juste avant d'agir.
- Les orphelins indexés par chemin ou par IMDb changent d'`item_id` quand ils sont adoptés par un *arr : ne pas référencer leur `item_id` de façon durable.
- Ajouter une limitation des tentatives de connexion avant la phase 3.
- Choisir la source de la résolution (`mediaInfo` ou qualité) avant d'écrire des règles sur la qualité.
- Normaliser les variantes régionales des langues (`pt-BR`, `en-US`…) avant les règles sur les langues.
- Lancer la construction Docker et le healthcheck sur le serveur.
