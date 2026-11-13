// Comprobaciones de los datos que llegan del cliente.
import { HttpError } from './http.mjs';

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function text(value, { field, min = 0, max }) {
  if (typeof value !== 'string') throw new HttpError(400, `Falta ${field}`);
  const v = value.trim();
  if (v.length < min) throw new HttpError(400, min === 1 ? `Falta ${field}` : `${field} es demasiado corto`);
  if (v.length > max) throw new HttpError(400, `${field} es demasiado largo`);
  return v;
}

export function id(value, field = 'el identificador') {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new HttpError(400, `${field} no es válido`);
  return value;
}

export function password(value) {
  if (typeof value !== 'string' || value.length < 8) {
    throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
  }
  if (value.length > 200) throw new HttpError(400, 'La contraseña es demasiado larga');
  return value;
}

export function email(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(v) || v.length > 254) throw new HttpError(400, 'El correo no es válido');
  return v;
}

export const FOLDER_COLORS = ['#3b5bdb', '#0c8599', '#e8590c', '#9c36b5', '#2b8a3e', '#c2255c', '#5f3dc4', '#d9480f'];
