// Shared PIN / password validation (ADR-0004). The optional second factor began
// as a 4-digit numeric PIN; it is now a variable-length PIN OR password
// (PIN_MIN_LEN..PIN_MAX_LEN characters, any characters). The content-key fold
// (master || pin IKM, src/shared/crypto.ts) and the Durable Object's PBKDF2 hash
// are both length-agnostic, so this bound is purely a UX / abuse floor: long
// enough to resist trivial guessing, capped so a huge value cannot be uploaded.
//
// Imported by the web client (create + reveal) and the Worker create handler so
// the rule is defined in exactly one place and cannot drift between them.
export const PIN_MIN_LEN = 4;
export const PIN_MAX_LEN = 128;

export function isValidPin(pin: string): boolean {
  return pin.length >= PIN_MIN_LEN && pin.length <= PIN_MAX_LEN;
}
