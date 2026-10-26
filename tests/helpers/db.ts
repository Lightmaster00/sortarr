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
