const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Local identifier: a millisecond timestamp in base36 followed by random
 * characters. Lexicographically sortable by creation time, which keeps
 * conversation and message ordering stable without a server.
 */
export function createId(now: number = Date.now()): string {
  const time = now.toString(36).padStart(8, '0');
  let random = '';
  for (let index = 0; index < 8; index += 1) {
    random += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${time}${random}`;
}
