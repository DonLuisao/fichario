// Llamadas a la API. La sesión va en una cookie que este código no puede leer.

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly data: Record<string, unknown> = {}) {
    super(message);
  }
}
export class OfflineError extends Error {
  constructor() {
    super('Sin conexión');
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(fn: Listener): void {
  unauthorizedListeners.add(fn);
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new OfflineError();
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) unauthorizedListeners.forEach((fn) => fn());
    throw new ApiError(data.error ?? 'Algo ha fallado. Inténtalo de nuevo.', res.status, data);
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const put = <T = any>(path: string, body: unknown = {}) => api<T>('PUT', path, body);
export const del = <T = any>(path: string) => api<T>('DELETE', path);

export function errorMessage(error: unknown): string {
  if (error instanceof OfflineError) return 'No hay conexión. Comprueba tu red y vuelve a probar.';
  if (error instanceof Error) return error.message;
  return 'Algo ha fallado. Inténtalo de nuevo.';
}
