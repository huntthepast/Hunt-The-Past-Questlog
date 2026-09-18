import type { Alpine } from 'alpinejs';

/**
 * Alpine components used by the public site.
 * Everything is progressive: pages render fully without JS, Alpine only adds filtering,
 * sorting and the "track your own progress" mode on checklists.
 */

type SortSpec = { attr: string; dir?: 'asc' | 'desc'; numeric?: boolean };
type ListFilterConfig = {
  facets?: string[];
  flags?: string[];
  sorts?: Record<string, SortSpec>;
  defaultSort?: string;
};

export default (Alpine: Alpine) => {
  /**
   * Generic client-side filter/sort for server-rendered lists.
   * Items are elements with `data-item` inside the component root and expose their
   * facets as data attributes (e.g. data-platform="snes"). Multi-valued attributes are
   * comma separated. Free-text search matches against `data-search`.
   */
  Alpine.data('listFilter', (config: ListFilterConfig = {}) => ({
    q: '',
    facet: Object.fromEntries((config.facets ?? []).map((f) => [f, ''])) as Record<string, string>,
    flag: Object.fromEntries((config.flags ?? []).map((f) => [f, false])) as Record<string, boolean>,
    sort: config.defaultSort ?? '',
    total: 0,
    visible: 0,

    init() {
      this.total = this.items().length;
      this.visible = this.total;
      for (const key of ['q', 'facet', 'flag', 'sort']) this.$watch(key, () => this.apply());
      this.apply();
    },

    items(): HTMLElement[] {
      return Array.from(this.$root.querySelectorAll<HTMLElement>('[data-item]'));
    },

    get active(): boolean {
      return Boolean(this.q) || Object.values(this.facet).some(Boolean) || Object.values(this.flag).some(Boolean);
    },

    matches(el: HTMLElement): boolean {
      const d = el.dataset;
      if (this.q) {
        const needle = this.q.trim().toLowerCase();
        if (needle && !(d.search ?? '').toLowerCase().includes(needle)) return false;
      }
      for (const [name, value] of Object.entries(this.facet)) {
        if (!value) continue;
        const have = (d[name] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
        if (!have.includes(value)) return false;
      }
      for (const [name, on] of Object.entries(this.flag)) {
        if (on && d[name] !== '1') return false;
      }
      return true;
    },

    apply() {
      let visible = 0;
      for (const el of this.items()) {
        const ok = this.matches(el);
        el.hidden = !ok;
        if (ok) visible++;
      }
      this.visible = visible;
      this.reorder();
      // Let section wrappers hide themselves when every child is filtered out.
      for (const group of Array.from(this.$root.querySelectorAll<HTMLElement>('[data-group]'))) {
        const anyVisible = Array.from(group.querySelectorAll<HTMLElement>('[data-item]')).some((el) => !el.hidden);
        group.hidden = !anyVisible;
      }
    },

    reorder() {
      const spec = config.sorts?.[this.sort];
      if (!spec) return;
      const dir = spec.dir === 'desc' ? -1 : 1;
      const read = (el: HTMLElement) => {
        const raw = el.dataset[spec.attr] ?? '';
        if (!spec.numeric) return raw.toLowerCase();
        const n = Number.parseFloat(raw);
        return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
      };
      // Sort within each parent so grouped lists keep their groups intact.
      const parents = new Set(this.items().map((el) => el.parentElement).filter(Boolean) as HTMLElement[]);
      for (const parent of parents) {
        const children = Array.from(parent.children).filter((c): c is HTMLElement => c instanceof HTMLElement && 'item' in c.dataset);
        children
          .map((el, index) => ({ el, index, key: read(el) }))
          .sort((a, b) => {
            if (a.key === b.key) return a.index - b.index;
            if (typeof a.key === 'number' && typeof b.key === 'number') return (a.key - b.key) * dir;
            return String(a.key).localeCompare(String(b.key)) * dir;
          })
          .forEach(({ el }) => parent.appendChild(el));
      }
    },

    reset() {
      this.q = '';
      for (const k of Object.keys(this.facet)) this.facet[k] = '';
      for (const k of Object.keys(this.flag)) this.flag[k] = false;
      this.sort = config.defaultSort ?? '';
    },
  }));

  /**
   * Checklist / missable tracker.
   * "owner" mode shows the site owner's progress baked into the HTML.
   * "mine" mode lets a visitor tick items for themselves; state lives in localStorage only.
   */
  Alpine.data('tracker', (trackerId: string, total: number) => ({
    mode: 'owner' as 'owner' | 'mine',
    mine: {} as Record<string, boolean>,
    total,
    storageKey: `questlog:tracker:${trackerId}`,

    init() {
      try {
        const saved = localStorage.getItem(this.storageKey);
        if (saved) this.mine = JSON.parse(saved);
        const mode = localStorage.getItem(this.storageKey + ':mode');
        if (mode === 'mine') this.mode = 'mine';
      } catch {
        /* storage unavailable (private mode etc.) - fall back to owner view */
      }
    },

    get myDone(): number {
      return Object.values(this.mine).filter(Boolean).length;
    },

    get myPct(): number {
      return this.total ? Math.round((this.myDone / this.total) * 100) : 0;
    },

    setMode(mode: 'owner' | 'mine') {
      this.mode = mode;
      try {
        localStorage.setItem(this.storageKey + ':mode', mode);
      } catch {
        /* ignore */
      }
    },

    isDone(itemId: string, ownerDone: boolean): boolean {
      return this.mode === 'owner' ? ownerDone : Boolean(this.mine[itemId]);
    },

    toggle(itemId: string) {
      if (this.mode !== 'mine') return;
      this.mine[itemId] = !this.mine[itemId];
      this.persist();
    },

    reset() {
      this.mine = {};
      this.persist();
    },

    persist() {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(this.mine));
      } catch {
        /* ignore */
      }
    },
  }));
};
