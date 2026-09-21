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
  const ZOOM_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3.5"><path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6"/></svg>';
  Alpine.data('lightbox', () => ({
    open: false,
    index: 0,
    images: [] as LightboxImage[],

    init() {
      // Give every inline image a clickable wrapper with an "Enlarge" badge so it reads as a control.
      for (const img of Array.from(this.$root.querySelectorAll<HTMLImageElement>('.guide-prose img'))) {
        if (img.closest('[data-lightbox]')) continue;
        const wrap = document.createElement('span');
        wrap.className = 'zoomable';
        wrap.dataset.lightbox = img.currentSrc || img.src;
        wrap.dataset.title = img.alt || img.title || '';
        wrap.dataset.caption = img.title || '';
        wrap.setAttribute('role', 'button');
        wrap.setAttribute('tabindex', '0');
        wrap.setAttribute('aria-label', `Enlarge image${img.alt ? `: ${img.alt}` : ''}`);
        img.replaceWith(wrap);
        wrap.append(img);
        const badge = document.createElement('span');
        badge.className = 'zoomable-badge';
        badge.setAttribute('aria-hidden', 'true');
        badge.innerHTML = `${ZOOM_ICON}<span>Enlarge</span>`;
        wrap.append(badge);
      }

      const openFrom = (target: HTMLElement) => {
        const image = this.describe(target);
        if (!image) return;
        this.collect();
        const found = this.images.findIndex((i) => i.src === image.src);
        this.index = found >= 0 ? found : 0;
        this.open = true;
      };
      this.$root.addEventListener('click', (event: Event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-lightbox]');
        if (!target || !this.$root.contains(target)) return;
        event.preventDefault();
        openFrom(target);
      });
      // Keyboard: wrapped images are focusable buttons.
      this.$root.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const target = (event.target as HTMLElement).closest<HTMLElement>('.zoomable[data-lightbox]');
        if (!target) return;
        event.preventDefault();
        openFrom(target);
      });
    },

    describe(el: HTMLElement): LightboxImage | null {
      const src = el.dataset.lightbox || el.getAttribute('href') || '';
      if (!src) return null;
      return { src, title: el.dataset.title || '', caption: el.dataset.caption || '' };
    },

    collect() {
      const seen = new Set<string>();
      this.images = Array.from(this.$root.querySelectorAll<HTMLElement>('[data-lightbox]'))
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
   * Page sidebar that turns into a slide-in drawer below the lg breakpoint. The sidebar markup is
   * rendered once; on phones a sticky toolbar opens it (optionally scrolled to a given panel).
   */
  /**
   * The site header's phone menu: a slide-in panel like the guide/tracker sidebars. Closes on
   * Escape, on the backdrop, after picking a link, and when the viewport grows past md.
   */
  Alpine.data('navDrawer', () => ({
    open: false,

    init() {
      const mq = window.matchMedia('(min-width: 48rem)');
      mq.addEventListener('change', (e) => {
        if (e.matches) this.open = false;
      });
      this.$watch('open', (value: boolean) => document.body.classList.toggle('overflow-hidden', value));
    },

    toggle() {
      this.open = !this.open;
    },

    close() {
      this.open = false;
    },
  }));

  Alpine.data('sidebarDrawer', () => ({
    drawer: false,
    desktop: false,
    current: '',

    init() {
      const mq = window.matchMedia('(min-width: 64rem)');
      this.desktop = mq.matches;
      mq.addEventListener('change', (e) => {
        this.desktop = e.matches;
        if (e.matches) this.drawer = false;
      });
      window.addEventListener('toc-active', (e) => {
        this.current = (e as CustomEvent<string>).detail ?? '';
      });
      // Lock page scrolling behind the drawer.
      this.$watch('drawer', (value: boolean) => document.body.classList.toggle('overflow-hidden', value && !this.desktop));
    },

    /** Opens the drawer and scrolls it to a panel marked data-drawer-section="<name>". */
    openDrawer(section?: string) {
      this.drawer = true;
      this.$nextTick(() => {
        const box = this.$root.querySelector<HTMLElement>('aside');
        const target = section ? box?.querySelector<HTMLElement>(`[data-drawer-section="${section}"]`) : null;
        if (box && target) box.scrollTop = target.offsetTop - 12;
        else if (box) box.scrollTop = 0;
      });
    },

    closeDrawer() {
      this.drawer = false;
    },

    /** Close after the reader picks a link (in-page anchor or another page). */
    onSidebarClick(event: Event) {
      if ((event.target as HTMLElement).closest('a')) this.drawer = false;
    },
  }));

  /**
   * "On this page" scroll-spy: highlights the heading currently being read and keeps that link in
   * view inside the (independently scrolling) sidebar. Links carry `data-slug` matching heading ids.
   */
  Alpine.data('tocSpy', () => ({
    active: '',

    init() {
      const links = Array.from(this.$root.querySelectorAll<HTMLAnchorElement>('a[data-slug]'));
      const headings = links.map((link) => document.getElementById(link.dataset.slug ?? '')).filter((h): h is HTMLElement => Boolean(h));
      if (!headings.length) return;

      const ACTIVE = ['text-amber-300', 'bg-amber-400/10'];
      // Nested sub-headings (.toc-sub) are folded away except under the section being read.
      // Only switched on here so that without JS the full list stays visible.
      const groups = Array.from(this.$root.querySelectorAll<HTMLElement>('[data-toc-group]'));
      if (this.$root.querySelector('.toc-sub')) this.$root.setAttribute('data-toc-folded', '');
      // Scroll only the sidebar's own box, never the page (on phones the sidebar sits below the article).
      const reveal = (link: HTMLElement) => {
        const box = link.closest<HTMLElement>('.page-sidebar');
        if (!box || box.scrollHeight <= box.clientHeight) return;
        const b = box.getBoundingClientRect();
        const l = link.getBoundingClientRect();
        if (l.top < b.top + 8) box.scrollTop += l.top - b.top - 8;
        else if (l.bottom > b.bottom - 8) box.scrollTop += l.bottom - b.bottom + 8;
      };
      const setActive = (slug: string) => {
        if (slug === this.active) return;
        this.active = slug;
        for (const link of links) {
          const on = link.dataset.slug === slug;
          link.classList.toggle('text-zinc-400', !on);
          for (const cls of ACTIVE) link.classList.toggle(cls, on);
          if (on) {
            const openGroup = link.closest('[data-toc-group]');
            for (const group of groups) group.toggleAttribute('data-open', group === openGroup);
            reveal(link);
            // Tell the mobile toolbar which section is being read.
            window.dispatchEvent(new CustomEvent('toc-active', { detail: link.textContent?.trim() ?? '' }));
          }
        }
      };

      // The active heading is the last one whose top has passed the sticky header band.
      let timer: ReturnType<typeof setTimeout> | null = null;
      const pick = () => {
        timer = null;
        let current = headings[0];
        for (const h of headings) if (h.getBoundingClientRect().top <= 120) current = h;
        // At the very bottom, the last heading wins even if it never reaches the band.
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = headings[headings.length - 1];
        setActive(current?.id ?? '');
      };
      const onScroll = () => {
        if (timer === null) timer = setTimeout(pick, 60);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      pick();
    },
  }));

  /**
   * Makes the task lists rendered from Markdown (`- [ ] item`) tickable for the reader, wraps each
   * one in a collapsible block with a done-counter, and lets the reader lay items out in 1-3 columns.
   * Ticks and layout choices are saved per guide in localStorage only; the author's own [x] marks are
   * the defaults, and the author's layout defaults come from the guide's frontmatter.
   */
  type ChecklistOptions = { columns?: number; collapsed?: boolean };
  type ChecklistBlock = {
    wrap: HTMLElement;
    list: HTMLUListElement;
    count: HTMLElement;
    toggle: HTMLButtonElement;
    tickAll: HTMLButtonElement;
    clear: HTMLButtonElement;
  };
  const CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-3.5 transition-transform"><path d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>';

  Alpine.data('guideChecklist', (guideId: string, options: ChecklistOptions = {}) => ({
    key: `questlog:guide:${guideId}`,
    boxes: [] as HTMLInputElement[],
    blocks: [] as ChecklistBlock[],
    state: {} as Record<string, boolean>,
    ui: { cols: 0, collapsed: {} as Record<string, boolean> },
    total: 0,
    done: 0,

    init() {
      this.boxes = Array.from(this.$root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      this.total = this.boxes.length;
      if (!this.total) return;
      try {
        this.state = JSON.parse(localStorage.getItem(this.key) ?? '{}');
        const ui = JSON.parse(localStorage.getItem(`${this.key}:ui`) ?? '{}');
        if (ui && typeof ui === 'object') this.ui = { cols: Number(ui.cols) || 0, collapsed: ui.collapsed ?? {} };
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
      Array.from(this.$root.querySelectorAll<HTMLUListElement>('ul.contains-task-list')).forEach((list, index) => this.enhance(list, index));
      this.applyColumns();
      this.recount();
    },

    /** Effective column count: the reader's choice, else the author's default, else 1. */
    get cols(): number {
      return Math.min(3, Math.max(1, this.ui.cols || options.columns || 1));
    },

    /** Wraps one task list in a header bar (collapse toggle + counter + column switch). */
    enhance(list: HTMLUListElement, index: number) {
      const wrap = document.createElement('div');
      wrap.className = 'checklist';
      wrap.dataset.index = String(index);

      const bar = document.createElement('div');
      bar.className = 'checklist-bar';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'checklist-toggle';
      const count = document.createElement('span');
      count.className = 'checklist-count';
      toggle.innerHTML = CHEVRON;
      toggle.append(count);

      const cols = document.createElement('span');
      cols.className = 'checklist-cols';
      cols.setAttribute('role', 'group');
      cols.setAttribute('aria-label', 'Columns');
      for (const n of [1, 2, 3]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.cols = String(n);
        button.title = `${n} column${n > 1 ? 's' : ''}`;
        button.setAttribute('aria-label', button.title);
        button.textContent = n === 1 ? '|' : n === 2 ? '||' : '|||';
        button.addEventListener('click', () => this.setColumns(n));
        cols.append(button);
      }

      // Whole-block shortcuts: tick or untick every item of this one checklist (one area of a walkthrough).
      const actions = document.createElement('span');
      actions.className = 'checklist-actions';
      const tickAll = document.createElement('button');
      tickAll.type = 'button';
      tickAll.textContent = 'Tick all';
      tickAll.title = 'Tick every item in this checklist';
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = 'Clear';
      clear.title = 'Untick every item in this checklist';
      actions.append(tickAll, clear);

      const tools = document.createElement('span');
      tools.className = 'checklist-tools';
      tools.append(actions, cols);

      bar.append(toggle, tools);
      list.replaceWith(wrap);
      wrap.append(bar, list);

      const block: ChecklistBlock = { wrap, list, count, toggle, tickAll, clear };
      this.blocks.push(block);
      tickAll.addEventListener('click', () => this.setBlock(block, true));
      clear.addEventListener('click', () => this.setBlock(block, false));
      const collapsed = this.ui.collapsed[index] ?? Boolean(options.collapsed);
      this.setCollapsed(block, collapsed, false);
      toggle.addEventListener('click', () => this.setCollapsed(block, wrap.dataset.collapsed !== 'true'));
    },

    setCollapsed(block: ChecklistBlock, collapsed: boolean, persist = true) {
      block.wrap.dataset.collapsed = String(collapsed);
      block.toggle.setAttribute('aria-expanded', String(!collapsed));
      block.toggle.title = collapsed ? 'Show checklist' : 'Hide checklist';
      if (persist) {
        this.ui.collapsed[block.wrap.dataset.index ?? ''] = collapsed;
        this.persistUi();
      }
    },

    setColumns(n: number) {
      this.ui.cols = n;
      this.persistUi();
      this.applyColumns();
    },

    applyColumns() {
      const cols = this.cols;
      for (const block of this.blocks) {
        block.wrap.dataset.cols = String(cols);
        block.wrap.querySelectorAll<HTMLButtonElement>('.checklist-cols button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.cols) === cols)));
      }
    },

    /** Ticks (or unticks) every item of one checklist block. Unticking asks first, since it throws away ticks. */
    setBlock(block: ChecklistBlock, checked: boolean) {
      const inputs = Array.from(block.list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      const ticked = inputs.filter((b) => b.checked).length;
      if (!checked && ticked > 0 && !confirm(`Untick ${ticked === 1 ? 'the 1 item' : `all ${ticked} items`} in this checklist?`)) return;
      for (const box of inputs) {
        box.checked = checked;
        this.state[this.boxes.indexOf(box)] = checked;
      }
      this.persist();
      this.recount();
    },

    recount() {
      this.done = this.boxes.filter((box) => box.checked).length;
      for (const block of this.blocks) {
        const inputs = Array.from(block.list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
        const ticked = inputs.filter((b) => b.checked).length;
        block.count.textContent = `${ticked} / ${inputs.length} done`;
        block.wrap.dataset.complete = String(inputs.length > 0 && ticked === inputs.length);
        block.tickAll.disabled = ticked === inputs.length;
        block.clear.disabled = ticked === 0;
      }
    },

    persist() {
      try {
        localStorage.setItem(this.key, JSON.stringify(this.state));
      } catch {
        /* ignore */
      }
    },

    persistUi() {
      try {
        localStorage.setItem(`${this.key}:ui`, JSON.stringify(this.ui));
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
  type TrackerOptions = { columns?: number; collapsed?: boolean; sections?: { ids: string[]; done: number }[] };
  Alpine.data('tracker', (trackerId: string, total: number, options: TrackerOptions = {}) => ({
    mode: 'owner' as 'owner' | 'mine',
    mine: {} as Record<string, boolean>,
    total,
    storageKey: `questlog:tracker:${trackerId}`,
    /* Layout preferences (columns, collapsed sections); the author's defaults apply until the reader changes them. */
    ui: { cols: 0, collapsed: {} as Record<string, boolean> },

    init() {
      try {
        const saved = localStorage.getItem(this.storageKey);
        if (saved) this.mine = JSON.parse(saved);
        const mode = localStorage.getItem(this.storageKey + ':mode');
        if (mode === 'mine') this.mode = 'mine';
        const ui = JSON.parse(localStorage.getItem(this.storageKey + ':ui') ?? 'null');
        if (ui && typeof ui === 'object') this.ui = { cols: Number(ui.cols) || 0, collapsed: ui.collapsed ?? {} };
      } catch {
        /* storage unavailable (private mode etc.) - fall back to owner view */
      }
      // Jumping to a section from the sidebar (or a shared #section-N link) opens it if it was collapsed.
      this.expandFromHash();
      window.addEventListener('hashchange', () => this.expandFromHash());
    },

    /* ---- layout ---- */

    expandFromHash() {
      const match = /^#section-(\d+)$/.exec(location.hash);
      if (!match) return;
      const index = Number(match[1]) - 1;
      if (index >= 0 && this.isCollapsed(index)) this.ui.collapsed[index] = false;
    },

    get cols(): number {
      return Math.min(3, Math.max(1, this.ui.cols || options.columns || 1));
    },

    setCols(n: number) {
      this.ui.cols = n;
      this.persistUi();
    },

    isCollapsed(index: number): boolean {
      return this.ui.collapsed[index] ?? Boolean(options.collapsed);
    },

    toggleSection(index: number) {
      this.ui.collapsed[index] = !this.isCollapsed(index);
      this.persistUi();
    },

    setAllCollapsed(collapsed: boolean) {
      (options.sections ?? []).forEach((_, index) => {
        this.ui.collapsed[index] = collapsed;
      });
      this.persistUi();
    },

    /** Done count for one section in the current mode (the owner's data or the reader's own ticks). */
    sectionDone(index: number): number {
      const section = options.sections?.[index];
      if (!section) return 0;
      return this.mode === 'owner' ? section.done : section.ids.filter((id) => this.mine[id]).length;
    },

    sectionTotal(index: number): number {
      return options.sections?.[index]?.ids.length ?? 0;
    },

    /** Ticks (or unticks) every item of one section in the reader's own progress. Unticking asks first. */
    setSection(index: number, done: boolean) {
      const section = options.sections?.[index];
      if (this.mode !== 'mine' || !section) return;
      const ticked = this.sectionDone(index);
      if (!done && ticked > 0 && !confirm(`Untick ${ticked === 1 ? 'the 1 item' : `all ${ticked} items`} in this section?`)) return;
      for (const id of section.ids) {
        if (done) this.mine[id] = true;
        else delete this.mine[id];
      }
      this.persist();
    },

    persistUi() {
      try {
        localStorage.setItem(this.storageKey + ':ui', JSON.stringify(this.ui));
      } catch {
        /* ignore */
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

  /**
   * "Show all / Show less" for long lists (achievements on a game page). The page renders every
   * item; the ones past the preview carry x-show="expanded", so the list starts short. Put it on
   * the wrapper that should scroll back into view when the list is folded up again.
   */
  Alpine.data('showMore', () => ({
    expanded: false,

    toggle() {
      this.expanded = !this.expanded;
      // Folding a long list from its bottom would strand the reader in whatever comes after it.
      if (!this.expanded && this.$root.getBoundingClientRect().top < 0) {
        this.$root.scrollIntoView({ block: 'start' });
      }
    },
  }));
};
