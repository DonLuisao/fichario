// Contraseñas, tokens y comparaciones seguras, con el módulo crypto de Node.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// Parámetros de scrypt: N=2^15 necesita ~32 MB de memoria y unos 100 ms en una Raspberry Pi 4.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return timingSafeEqual(key, expected);
}

// Hash de una contraseña inventada, para tardar lo mismo cuando el usuario no existe
// y no revelar así qué correos están registrados.
let dummyHash = null;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword('fichario-no-existe');
  await verifyPassword(password, dummyHash);
}

export function newToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

// En la base de datos solo se guarda el hash de cada token (sesiones, recuperación).
export function sha256(value) {
  return createHash('sha256').update(value).digest('base64url');
}

// Códigos de invitación legibles: ABCD-EFGH-JKLM-NPQR, sin 0/O ni 1/I.
const INVITE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newInviteCode() {
  const bytes = randomBytes(16);
  let code = '';
  for (let i = 0; i < 16; i++) {
    if (i && i % 4 === 0) code += '-';
    code += INVITE_CHARS[bytes[i] % INVITE_CHARS.length];
  }
  return code;
}
