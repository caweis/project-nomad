// Minimal ambient types for better-sqlite3 (the package ships none, and we use
// only a small slice of its API in GrocyProvisioner). Swap for
// @types/better-sqlite3 if a broader need appears.
declare module 'better-sqlite3' {
  interface Statement {
    get(...params: unknown[]): unknown
    run(...params: unknown[]): unknown
  }

  interface DatabaseInstance {
    prepare(sql: string): Statement
    pragma(sql: string): unknown
    close(): void
  }

  interface DatabaseConstructor {
    new (filename: string, options?: { timeout?: number; readonly?: boolean }): DatabaseInstance
  }

  const Database: DatabaseConstructor
  export default Database
}
