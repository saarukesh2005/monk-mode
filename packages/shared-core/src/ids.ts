/** RFC 4122 v4 UUID using the platform CSPRNG. */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
