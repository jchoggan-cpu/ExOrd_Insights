/** Turns a caught value into a loggable string — one access point so every catch block formats errors the same way. */
export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
