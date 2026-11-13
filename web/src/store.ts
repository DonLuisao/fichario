// Datos del usuario en el dispositivo y sincronización con el servidor.
//
// Todo cambio se aplica primero aquí (la app responde al instante y funciona sin conexión)
// y se apunta como pendiente. La sincronización envía los pendientes y recibe lo que haya
// cambiado en otros dispositivos desde la última vez.
import { get, OfflineError, post } from './api';
import type { Card, Folder, Review, Stats, User } from './types';

type SyncStatus = 'ok' | 'syncing' | 'offline' | 'error';

interface Saved {
  rev: number;
  folders: Record<string, Folder>;
  cards: Record<string, Card>;
  pending: Pending;
  stats: Stats | null;
}
interface Pending {
  folders: Record<string, Folder | { id: string; deleted: true }>;
  cards: Record<string, Card | { id: string; deleted: true }>;
  reviews: Review[];
}

const emptyPending = (): Pending => ({ folders: {}, cards: {}, reviews: [] });
const FOLDER_COLORS = ['#3b5bdb', '#0c8599', '#e8590c', '#9c36b5', '#2b8a3e', '#c2255c', '#5f3dc4', '#d9480f'];

class Store {
  user: User | null = null;
  rev = 0;
  folders: Record<string, Folder> = {};
  cards: Record<string, Card> = {};
  pending: Pending = emptyPending();
  stats: Stats | null = null;
  status: SyncStatus = 'ok';
  private listeners = new Set<() => void>();
  private syncing: Promise<void> | null = null;
  private again = false;
  private timer: number | undefined;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  private get key() {
    return `fichario:datos:${this.user?.id}`;
  }

  // ---- Sesión ----

  setUser(user: User | null) {
    this.user = user;
    if (!user) {
      Object.assign(this, { rev: 0, folders: {}, cards: {}, pending: emptyPending(), stats: null, status: 'ok' });
      this.emit();
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? 'null') as Saved | null;
      if (saved) Object.assign(this, { rev: saved.rev, folders: saved.folders, cards: saved.cards, pending: saved.pending, stats: saved.stats });
    } catch {
      /* datos locales dañados: se recuperan del servidor */
    }
    this.emit();
  }

  forgetLocalData() {
    if (this.user) localStorage.removeItem(this.key);
  }

  private persist() {
    if (!this.user) return;
    const saved: Saved = { rev: this.rev, folders: this.folders, cards: this.cards, pending: this.pending, stats: this.stats };
    try {
      localStorage.setItem(this.key, JSON.stringify(saved));
    } catch {
      /* sin espacio: se seguirá trabajando en memoria */
    }
  }

  // ---- Consultas ----

  folderList(): Folder[] {
    return Object.values(this.folders).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }
  cardsIn(folderId: string | null | 'todas'): Card[] {
    const all = Object.values(this.cards);
    if (folderId === 'todas') return all;
    return all.filter((c) => c.folder_id === folderId);
  }
  pendingCount(): number {
    return Object.keys(this.pending.folders).length + Object.keys(this.pending.cards).length + this.pending.reviews.length;
  }
  nextColor(): string {
    return FOLDER_COLORS[Object.keys(this.folders).length % FOLDER_COLORS.length];
  }

  // ---- Cambios ----

  saveFolder(input: { id?: string; name: string; color?: string }): Folder {
    const id = input.id ?? crypto.randomUUID();
    const prev = this.folders[id];
    const folder: Folder = { id, name: input.name.trim(), color: input.color ?? prev?.color ?? this.nextColor(), source: prev?.source ?? '' };
    this.folders[id] = folder;
    this.pending.folders[id] = folder;
    this.changed();
    return folder;
  }

  deleteFolder(id: string) {
    delete this.folders[id];
    this.pending.folders[id] = { id, deleted: true };
    // El servidor borra también sus tarjetas; aquí se quitan ya para que la vista sea coherente.
    for (const c of Object.values(this.cards)) {
      if (c.folder_id === id) {
        delete this.cards[c.id];
        delete this.pending.cards[c.id];
      }
    }
    this.changed();
  }

  saveCard(input: Omit<Card, 'id'> & { id?: string }): Card {
    const card: Card = {
      id: input.id ?? crypto.randomUUID(),
      folder_id: input.folder_id,
      question: input.question.trim(),
      answer: input.answer.trim(),
      wrongs: input.wrongs.map((w) => w.trim()).filter(Boolean).slice(0, 3),
    };
    this.cards[card.id] = card;
    this.pending.cards[card.id] = card;
    this.changed();
    return card;
  }

  deleteCard(id: string) {
    delete this.cards[id];
    this.pending.cards[id] = { id, deleted: true };
    this.changed();
  }

  addReview(cardId: string, correct: boolean, mode: 'flip' | 'quiz') {
    if (this.user?.is_demo) return;
    this.pending.reviews.push({ id: crypto.randomUUID(), card_id: cardId, correct, mode, answered_at: Date.now() });
    this.persist();
    this.scheduleSync(4000);
  }

  private changed() {
    this.persist();
    this.emit();
    this.scheduleSync(800);
  }

  // ---- Sincronización ----

  scheduleSync(delay = 0) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.sync(), delay);
  }

  async sync(): Promise<void> {
    if (!this.user) return;
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    this.syncing = this.runSync().finally(() => {
      this.syncing = null;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    });
    return this.syncing;
  }

  private async runSync() {
    // Lo que se envía ahora. Si el usuario sigue cambiando cosas mientras tanto, eso
    // queda pendiente para la siguiente vuelta.
    const sent = {
      folders: { ...this.pending.folders },
      cards: { ...this.pending.cards },
      reviews: [...this.pending.reviews],
    };
    this.status = 'syncing';
    this.emit();
    try {
      const res = await post<{ rev: number; folders: (Folder & { deleted: boolean })[]; cards: (Card & { deleted: boolean })[] }>('/api/sync', {
        since: this.rev,
        changes: { folders: Object.values(sent.folders), cards: Object.values(sent.cards), reviews: sent.reviews },
      });
      for (const [id, item] of Object.entries(sent.folders)) if (this.pending.folders[id] === item) delete this.pending.folders[id];
      for (const [id, item] of Object.entries(sent.cards)) if (this.pending.cards[id] === item) delete this.pending.cards[id];
      this.pending.reviews = this.pending.reviews.filter((r) => !sent.reviews.includes(r));

      for (const f of res.folders) {
        if (this.pending.folders[f.id]) continue;
        if (f.deleted) delete this.folders[f.id];
        else this.folders[f.id] = { id: f.id, name: f.name, color: f.color, source: f.source };
      }
      for (const c of res.cards) {
        if (this.pending.cards[c.id]) continue;
        if (c.deleted) delete this.cards[c.id];
        else this.cards[c.id] = { id: c.id, folder_id: c.folder_id, question: c.question, answer: c.answer, wrongs: c.wrongs };
      }
      this.rev = res.rev;
      this.status = this.pendingCount() ? 'syncing' : 'ok';
      if (this.pendingCount()) this.again = true;
    } catch (error) {
      this.status = error instanceof OfflineError ? 'offline' : 'error';
      // Se reintentará solo
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.sync(), 30_000);
    }
    this.persist();
    this.emit();
  }

  async loadStats(): Promise<Stats | null> {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      this.stats = await get<Stats>(`/api/stats?tz=${encodeURIComponent(tz)}`);
      this.persist();
      this.emit();
    } catch {
      /* sin conexión: se usan las últimas estadísticas guardadas */
    }
    return this.stats;
  }
}

export const store = new Store();

window.addEventListener('online', () => store.scheduleSync());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') store.scheduleSync();
});
