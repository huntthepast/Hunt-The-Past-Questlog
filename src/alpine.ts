import type { Alpine } from 'alpinejs';

/**
 * Alpine components used by the public site.
 * Everything is progressive: pages render fully without JS, Alpine only adds filtering,
 * sorting, paging and the "track your own progress" mode on checklists.
 */

type SortSpec = { attr: string; dir?: 'asc' | 'desc'; numeric?: boolean };
type ListFilterConfig = {
  /** Single-select facets (driven by a <select>): '' means "any". */
  facets?: string[];
  /** Multi-select facets (toggle chips) with their default = every value enabled. */
  multi?: Record<string, string[]>;
  flags?: string[];
  sorts?: Record<string, SortSpec>;
  defaultSort?: string;
  /** Items per page. Omit (or 0) to show everything on one page. */
  pageSize?: number;
  /** Allowed page sizes (0 = all). */
  pageSizes?: number[];
  /** localStorage key under which the multi-select facets and page size are remembered. */
  storageKey?: string;
};

type FacetValue = string | string[];

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v));

export default (Alpine: Alpine) => {
  /**
   * Generic client-side filter/sort/paginate for server-rendered lists.
   * Items are elements with `data-item` inside the component root and expose their
   * facets as data attributes (e.g. data-platform="snes"). Multi-valued attributes are
   * comma separated. Free-text search matches against `data-search`. Wrappers marked
   * `data-group` hide themselves when none of their items are visible.
   */
  Alpine.data('listFilter', (config: ListFilterConfig = {}) => ({
    q: '',
    facet: {
      ...Object.fromEntries((config.facets ?? []).map((f) => [f, ''])),
      ...Object.fromEntries(Object.entries(config.multi ?? {}).map(([f, all]) => [f, [...all]])),
    } as Record<string, FacetValue>,
    flag: Object.fromEntries((config.flags ?? []).map((f) => [f, false])) as Record<string, boolean>,
    sort: config.defaultSort ?? '',
    total: 0,
    visible: 0,
    page: 1,
    pageSize: config.pageSize ?? 0,

    init() {
      this.total = this.items().length;
      this.visible = this.total;
      this.restore();
      // Any change to the filters, the sort or the page size starts over at page 1.
      for (const key of ['q', 'facet', 'flag', 'sort', 'pageSize']) {
        this.$watch(key, () => {
          // Changing the page re-applies through its own watcher; otherwise apply directly.
          if (this.page !== 1) this.page = 1;
          else this.apply();
        });
      }
      for (const key of ['facet', 'pageSize']) this.$watch(key, () => this.persist());
      this.$watch('page', () => this.apply());
      this.apply();
    },

    items(): HTMLElement[] {
      return Array.from(this.$root.querySelectorAll<HTMLElement>('[data-item]'));
    },

    /* ---- remembered preferences (multi-select facets + page size) ---- */

    restore() {
      if (!config.storageKey) return;
      try {
        const saved = JSON.parse(localStorage.getItem(config.storageKey) ?? 'null');
        if (!saved || typeof saved !== 'object') return;
        if (config.pageSize !== undefined && (config.pageSizes ?? []).includes(saved.pageSize)) this.pageSize = saved.pageSize;
        for (const [name, all] of Object.entries(config.multi ?? {})) {
          const values = saved.facet?.[name];
          if (Array.isArray(values)) this.facet[name] = values.filter((v: unknown): v is string => typeof v === 'string' && all.includes(v));
        }
      } catch {
        /* storage unavailable or corrupt: keep defaults */
      }
    },

    persist() {
      if (!config.storageKey) return;
      try {
        const facet = Object.fromEntries(Object.keys(config.multi ?? {}).map((name) => [name, this.facet[name]]));
        localStorage.setItem(config.storageKey, JSON.stringify({ facet, pageSize: this.pageSize }));
      } catch {
        /* ignore */
      }
    },

    /* ---- multi-select facet helpers (used by toggle chips) ---- */

    has(name: string, value: string): boolean {
      const current = this.facet[name];
      return Array.isArray(current) ? current.includes(value) : current === value;
    },

    toggle(name: string, value: string) {
      const current = this.facet[name];
      if (!Array.isArray(current)) return;
      this.facet[name] = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    },

    /** Replace a multi-select facet wholesale (presets, "all", "none"). */
    set(name: string, values: string[]) {
      const all = config.multi?.[name] ?? [];
      this.facet[name] = values.filter((v) => all.includes(v));
    },

    /** True when a multi-select facet enables exactly these values (used to highlight presets). */
    is(name: string, values: string[]): boolean {
      const current = this.facet[name];
      return Array.isArray(current) && sameSet(current, values);
    },

    /** True when a multi-select facet still allows every value. */
    allOn(name: string): boolean {
      const current = this.facet[name];
      return Array.isArray(current) && sameSet(current, config.multi?.[name] ?? []);
    },

    get active(): boolean {
      const facetActive = Object.entries(this.facet).some(([name, value]) =>
        Array.isArray(value) ? !sameSet(value, config.multi?.[name] ?? []) : Boolean(value),
      );
      return Boolean(this.q) || facetActive || Object.values(this.flag).some(Boolean);
    },

    matches(el: HTMLElement): boolean {
      const d = el.dataset;
      if (this.q) {
        const needle = this.q.trim().toLowerCase();
        if (needle && !(d.search ?? '').toLowerCase().includes(needle)) return false;
      }
      for (const [name, value] of Object.entries(this.facet)) {
        const have = (d[name] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
        if (Array.isArray(value)) {
          // Multi-select: the item must carry at least one of the enabled values.
          if (!have.some((v) => value.includes(v))) return false;
          continue;
        }
        if (value && !have.includes(value)) return false;
      }
      for (const [name, on] of Object.entries(this.flag)) {
        if (on && d[name] !== '1') return false;
      }
      return true;
    },

    apply() {
      // Sort first so the page window is taken from the ordered list.
      this.reorder();
      const start = this.pageSize ? (this.page - 1) * this.pageSize : 0;
      const end = this.pageSize ? start + this.pageSize : Number.POSITIVE_INFINITY;
      let matched = 0;
      for (const el of this.items()) {
        if (!this.matches(el)) {
          el.hidden = true;
          continue;
        }
        el.hidden = !(matched >= start && matched < end);
        matched++;
      }
      this.visible = matched;
      // Filters can shrink the list below the current page; snap back to the last real page.
      if (this.page > this.pageCount) {
        this.page = this.pageCount;
        return; // the page watcher re-applies
      }
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
      for (const k of Object.keys(this.facet)) this.facet[k] = Array.isArray(this.facet[k]) ? [...(config.multi?.[k] ?? [])] : '';
      for (const k of Object.keys(this.flag)) this.flag[k] = false;
      this.sort = config.defaultSort ?? '';
      this.page = 1;
    },

    /* ---- pagination ---- */

    get pageCount(): number {
      return this.pageSize ? Math.max(1, Math.ceil(this.visible / this.pageSize)) : 1;
    },

    /** 1-based index of the first item on the current page (0 when nothing matches). */
    get rangeStart(): number {
      if (!this.visible) return 0;
      return this.pageSize ? (this.page - 1) * this.pageSize + 1 : 1;
    },

    get rangeEnd(): number {
      return this.pageSize ? Math.min(this.visible, this.page * this.pageSize) : this.visible;
    },

    /** Page numbers to render, with '...' gaps: 1 ... 4 [5] 6 ... 12 */
    get pageNumbers(): (number | '...')[] {
      const total = this.pageCount;
      const current = this.page;
      if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
      const wanted = new Set([1, total, current - 1, current, current + 1]);
      if (current <= 3) [2, 3, 4].forEach((p) => wanted.add(p));
      if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => wanted.add(p));
      const pages = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
      const out: (number | '...')[] = [];
      for (const [i, p] of pages.entries()) {
        if (i > 0 && p - (pages[i - 1] as number) > 1) out.push('...');
        out.push(p);
      }
      return out;
    },

    goTo(page: number) {
      const next = Math.min(Math.max(1, page), this.pageCount);
      if (next === this.page) return;
      this.page = next;
      this.$nextTick(() => this.$root.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    },
  }));

  /**
   * Image viewer for guide pages. Collects every image inside `.guide-prose` and every element
   * carrying `data-lightbox` (gallery tiles) within the component root; clicking one opens the
   * overlay rendered by <Lightbox />, with prev/next across all of them.
   */
  type LightboxImage = { src: string; title: string; caption: string };
  Alpine.data('lightbox', () => ({
    open: false,
    index: 0,
    images: [] as LightboxImage[],

    init() {
      this.$root.addEventListener('click', (event: Event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-lightbox], .guide-prose img');
        if (!target || !this.$root.contains(target)) return;
        const image = this.describe(target);
        if (!image) return;
        event.preventDefault();
        this.collect();
        const found = this.images.findIndex((i) => i.src === image.src);
        this.index = found >= 0 ? found : 0;
        this.open = true;
      });
    },

    describe(el: HTMLElement): LightboxImage | null {
      if (el instanceof HTMLImageElement) return { src: el.currentSrc || el.src, title: el.alt || el.title || '', caption: el.title || '' };
      const src = el.dataset.lightbox || el.getAttribute('href') || '';
      if (!src) return null;
      return { src, title: el.dataset.title || '', caption: el.dataset.caption || '' };
    },

    collect() {
      const seen = new Set<string>();
      this.images = Array.from(this.$root.querySelectorAll<HTMLElement>('[data-lightbox], .guide-prose img'))
        .map((el) => this.describe(el))
        .filter((i): i is LightboxImage => Boolean(i) && !seen.has(i!.src) && Boolean(seen.add(i!.src)));
    },

    get current(): LightboxImage | undefined {
      return this.images[this.index];
    },

    close() {
      this.open = false;
    },
    prev() {
      this.index = (this.index - 1 + this.images.length) % this.images.length;
    },
    next() {
      this.index = (this.index + 1) % this.images.length;
    },
  }));

  /**
   * Makes the read-only task lists rendered from Markdown (`- [ ] item`) tickable for the reader.
   * Ticks are saved per guide in localStorage only - the author's own [x] marks are the defaults.
   */
  Alpine.data('guideChecklist', (guideId: string) => ({
    key: `questlog:guide:${guideId}`,
    boxes: [] as HTMLInputElement[],
    state: {} as Record<string, boolean>,
    total: 0,
    done: 0,

    init() {
      this.boxes = Array.from(this.$root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      this.total = this.boxes.length;
      if (!this.total) return;
      try {
        this.state = JSON.parse(localStorage.getItem(this.key) ?? '{}');
      } catch {
        /* storage unavailable */
      }
      this.boxes.forEach((box, i) => {
        box.disabled = false;
        box.classList.add('cursor-pointer');
        if (this.state[i] !== undefined) box.checked = this.state[i];
        box.addEventListener('change', () => {
          this.state[i] = box.checked;
          this.persist();
          this.recount();
        });
        // Let the whole line toggle the box, like a label would.
        const line = box.closest('li');
        if (line) {
          line.style.cursor = 'pointer';
          line.addEventListener('click', (event) => {
            if ((event.target as HTMLElement).closest('a, input, button')) return;
            box.checked = !box.checked;
            box.dispatchEvent(new Event('change'));
          });
        }
      });
      this.recount();
    },

    recount() {
      this.done = this.boxes.filter((box) => box.checked).length;
    },

    persist() {
      try {
        localStorage.setItem(this.key, JSON.stringify(this.state));
      } catch {
        /* ignore */
      }
    },

    reset() {
      this.state = {};
      this.boxes.forEach((box) => {
        box.checked = box.defaultChecked;
      });
      try {
        localStorage.removeItem(this.key);
      } catch {
        /* ignore */
      }
      this.recount();
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
