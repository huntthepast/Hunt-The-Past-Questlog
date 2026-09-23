/* QuestLog admin UI. Plain Alpine.js components talking to the local JSON API in admin/server.js. */

const VIEWS = ['dashboard', 'games', 'guides', 'trackers', 'sets', 'ra', 'settings', 'publish'];
const SITE_DEV_URL = 'http://localhost:4321';

async function api(method, url, body, { raw = false } = {}) {
  const init = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new Error(data?.error || `${method} ${url} failed (${res.status})`);
  return data;
}

function slugify(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

const COLOR_CHIP = {
  zinc: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30',
  sky: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  orange: 'bg-orange-500/15 text-orange-300 ring-orange-500/30',
  teal: 'bg-teal-500/15 text-teal-300 ring-teal-500/30',
  emerald: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  violet: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  amber: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  rose: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
};

const fmtDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
};

/**
 * SweetAlert2 dialogs. window.dialog is built from the shared module (src/lib/dialogs.js) by the
 * module tag in index.html, which runs before Alpine starts - so it is always there when a handler fires.
 */
const confirmDiscard = async (dirty) =>
  !dirty ||
  window.dialog.danger('Discard unsaved changes?', {
    text: 'Everything you changed since the last save is lost.',
    confirmText: 'Discard',
    cancelText: 'Keep editing',
  });

document.addEventListener('alpine:init', () => {
  /* ---------------- global store ---------------- */

  let toastId = 0;
  Alpine.store('app', {
    view: 'dashboard',
    param: null,
    meta: null,
    ready: false,
    error: null,
    toasts: [],

    async init() {
      window.addEventListener('hashchange', () => this.route());
      try {
        await this.refreshMeta();
        this.ready = true;
      } catch (err) {
        this.error = err.message;
      }
      this.route();
    },

    async refreshMeta() {
      this.meta = await api('GET', '/api/meta');
    },

    route() {
      const [view, param] = location.hash.replace(/^#\/?/, '').split('/');
      this.view = VIEWS.includes(view) ? view : 'dashboard';
      this.param = param ? decodeURIComponent(param) : null;
    },

    go(view, param) {
      location.hash = param ? `#/${view}/${encodeURIComponent(param)}` : `#/${view}`;
    },

    /* Games / guides / trackers: hide the picker list while editing to get a wider, quieter editor. Remembered. */
    listHidden: (() => {
      try {
        return localStorage.getItem('questlog-admin:list-hidden') === '1';
      } catch {
        return false;
      }
    })(),

    toggleList() {
      this.listHidden = !this.listHidden;
      try {
        localStorage.setItem('questlog-admin:list-hidden', this.listHidden ? '1' : '0');
      } catch {
        /* ignore */
      }
    },

    toast(message, type = 'ok') {
      const id = ++toastId;
      this.toasts.push({ id, message, type });
      setTimeout(() => this.dismiss(id), type === 'error' ? 8000 : 4000);
    },

    dismiss(id) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },

    /* lookups used by templates */
    status(id) {
      return this.meta?.statuses.find((s) => s.id === id) ?? { id, label: id, color: 'zinc' };
    },
    platform(id) {
      return this.meta?.platforms.find((p) => p.id === id) ?? { id, name: id, short: id };
    },
    guideType(id) {
      return this.meta?.guideTypes.find((t) => t.id === id) ?? { id, label: id, color: 'zinc' };
    },
    trackerType(id) {
      return this.meta?.trackerTypes.find((t) => t.id === id) ?? { id, label: id, color: 'zinc' };
    },
    chip(color) {
      return COLOR_CHIP[color] ?? COLOR_CHIP.zinc;
    },
    siteUrl(path = '') {
      return SITE_DEV_URL + path;
    },
    fmtDate,
  });

  /* ---------------- dashboard ---------------- */

  Alpine.data('dashboardView', () => ({
    data: null,
    error: null,
    async init() {
      try {
        this.data = await api('GET', '/api/dashboard');
      } catch (err) {
        this.error = err.message;
      }
    },
  }));

  /* ---------------- games ---------------- */

  const blankGame = () => ({
    slug: '',
    title: '',
    platform: '',
    cover: '',
    genres: '',
    developer: '',
    publisher: '',
    releaseYear: '',
    ownership: 'owned',
    favorite: false,
    status: 'unplayed',
    rating: '',
    hoursPlayed: '',
    startedAt: '',
    finishedAt: '',
    raGameId: '',
    steamAppId: '',
    subsets: [],
    review: '',
    notes: '',
    tags: '',
  });

  Alpine.data('gamesView', () => ({
    games: [],
    q: '',
    filterStatus: '',
    filterOwnership: '',
    filterPlatform: '',
    selected: null,
    isNew: false,
    form: null,
    dirty: false,
    saving: false,
    busy: false,
    covers: { uploading: false },

    async init() {
      await this.load();
      const param = Alpine.store('app').param;
      if (param === 'new') this.create();
      else if (param) await this.open(param);
      this.$watch('form', () => {
        if (this._loading) return;
        this.dirty = true;
      });
    },

    get filtered() {
      const q = this.q.trim().toLowerCase();
      return this.games.filter((g) => {
        if (this.filterStatus && g.status !== this.filterStatus) return false;
        if (this.filterOwnership && g.ownership !== this.filterOwnership) return false;
        if (this.filterPlatform && g.platform !== this.filterPlatform) return false;
        if (q && !`${g.title} ${g.platform} ${(g.genres || []).join(' ')} ${(g.tags || []).join(' ')}`.toLowerCase().includes(q)) return false;
        return true;
      });
    },

    get slugPreview() {
      return this.form?.slug?.trim() || slugify(this.form?.title ?? '');
    },

    async load() {
      this.games = await api('GET', '/api/games');
    },

    setForm(value) {
      this._loading = true;
      this.form = value;
      this.dirty = false;
      this.$nextTick(() => {
        this._loading = false;
      });
    },

    async create() {
      if (!(await confirmDiscard(this.dirty))) return;
      this.selected = null;
      this.isNew = true;
      this.setForm(blankGame());
    },

    async open(slug) {
      if (!(await confirmDiscard(this.dirty))) return;
      try {
        const g = await api('GET', `/api/games/${slug}`);
        this.selected = slug;
        this.isNew = false;
        this.setForm({
          ...blankGame(),
          ...g,
          cover: g.cover ?? '',
          developer: g.developer ?? '',
          publisher: g.publisher ?? '',
          releaseYear: g.releaseYear ?? '',
          rating: g.rating ?? '',
          hoursPlayed: g.hoursPlayed ?? '',
          startedAt: g.startedAt ?? '',
          finishedAt: g.finishedAt ?? '',
          raGameId: g.raGameId ?? '',
          steamAppId: g.steamAppId ?? '',
          subsets: (g.subsets ?? []).map((sub) => ({ raGameId: Number(sub.raGameId), rating: sub.rating ?? '', hoursPlayed: sub.hoursPlayed ?? '', startedAt: sub.startedAt ?? '', finishedAt: sub.finishedAt ?? '', review: sub.review ?? '', notes: sub.notes ?? '' })),
          review: g.review ?? '',
          notes: g.notes ?? '',
          genres: (g.genres ?? []).join(', '),
          tags: (g.tags ?? []).join(', '),
        });
        await this.loadSubsets();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    /* ---- RA subsets of this game: one journal row (rating, hours, dates) each ---- */

    raSubsets: [],

    async loadSubsets() {
      this.raSubsets = [];
      const id = Number(this.form?.raGameId);
      if (!id) return;
      try {
        this.raSubsets = await api('GET', '/api/ra/subsets-of/' + id);
      } catch {
        this.raSubsets = [];
      }
      // Make sure every attached subset has a row to edit; rows are only written when they hold a value.
      const loading = this._loading;
      this._loading = true;
      for (const sub of this.raSubsets) {
        if (!this.form.subsets.some((row) => Number(row.raGameId) === sub.raGameId)) this.form.subsets.push({ raGameId: sub.raGameId, rating: '', hoursPlayed: '', startedAt: '', finishedAt: '', review: '', notes: '' });
      }
      this.$nextTick(() => {
        this._loading = loading;
      });
    },

    subsetRow(raGameId) {
      return this.form.subsets.find((row) => Number(row.raGameId) === Number(raGameId));
    },

    async close() {
      if (!(await confirmDiscard(this.dirty))) return;
      this.form = null;
      this.selected = null;
      this.isNew = false;
      this.dirty = false;
    },

    async save() {
      if (!this.form) return;
      this.saving = true;
      try {
        // Subset rows are only stored when they hold something; blank rows exist just to be editable.
        const payload = { ...this.form, subsets: this.form.subsets.filter((row) => ['rating', 'hoursPlayed', 'startedAt', 'finishedAt', 'review', 'notes'].some((key) => row[key] !== '' && row[key] != null)) };
        const saved = this.isNew ? await api('POST', '/api/games', payload) : await api('PUT', `/api/games/${this.selected}`, payload);
        Alpine.store('app').toast(`Saved "${saved.title}"`);
        await this.load();
        this.dirty = false;
        await this.open(saved.slug);
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.saving = false;
      }
    },

    async remove() {
      if (!this.selected) return;
      if (!(await window.dialog.danger(`Delete "${this.form.title}"?`, { text: `This removes src/content/games/${this.selected}.json.` }))) return;
      try {
        await api('DELETE', `/api/games/${this.selected}`);
        Alpine.store('app').toast('Game deleted');
        this.form = null;
        this.selected = null;
        this.dirty = false;
        await this.load();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    /** Pull title/platform/cover/etc. from RetroAchievements for the entered game id. */
    /** Pre-fills title / art / developer / publisher / genres / year from the Steam store (no key needed). */
    async lookupSteam() {
      const appId = Number(this.form.steamAppId);
      if (!appId) return;
      this.busy = true;
      try {
        const info = await api('GET', `/api/steam/app/${appId}`);
        if (!this.form.title) this.form.title = info.title;
        if (!this.form.cover) this.form.cover = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
        if (!this.form.developer && info.developers.length) this.form.developer = info.developers.join(', ');
        if (!this.form.publisher && info.publishers.length) this.form.publisher = info.publishers.join(', ');
        if (!this.form.genres && info.genres.length) this.form.genres = info.genres.join(', ');
        if (!this.form.releaseYear && info.releaseYear) this.form.releaseYear = info.releaseYear;
        if (!this.form.platform) {
          const pc = (Alpine.store('app').meta.platforms ?? []).find((p) => p.id === 'pc' || String(p.short).toUpperCase() === 'PC');
          if (pc) this.form.platform = pc.id;
        }
        Alpine.store('app').toast(`Steam: ${info.title}${info.achievementsTotal ? ` (${info.achievementsTotal} achievements)` : ''}`);
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.busy = false;
      }
    },

    async lookupRa() {
      const id = Number(this.form.raGameId);
      if (!id) return Alpine.store('app').toast('Enter a RetroAchievements game id first', 'error');
      this.busy = true;
      try {
        const info = await api('GET', `/api/ra/game/${id}`);
        const f = this.form;
        if (!f.title) f.title = info.title;
        if (!f.platform && info.platform) f.platform = info.platform;
        if (!f.cover && info.cover) f.cover = info.cover;
        if (!f.developer && info.developer) f.developer = info.developer;
        if (!f.publisher && info.publisher) f.publisher = info.publisher;
        if (!f.genres && info.genres.length) f.genres = info.genres.join(', ');
        if (!f.releaseYear && info.releaseYear) f.releaseYear = info.releaseYear;
        if (info.tag && !f.tags.includes(info.tag)) f.tags = f.tags ? `${f.tags}, ${info.tag}` : info.tag;
        const note = info.platform ? '' : ` (no platform matched "${info.consoleName}" - pick one or import RA consoles under Settings)`;
        Alpine.store('app').toast(`Filled from RA: ${info.title}${note}`, info.platform ? 'ok' : 'error');
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.busy = false;
      }
    },

    async uploadCover(event) {
      const file = event.target.files?.[0];
      if (!file || !this.selected) return;
      const body = new FormData();
      body.append('file', file);
      this.covers.uploading = true;
      try {
        const game = await api('POST', `/api/games/${this.selected}/cover`, body);
        this.form.cover = game.cover;
        this.dirty = false;
        await this.load();
        Alpine.store('app').toast('Cover uploaded to public/covers');
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.covers.uploading = false;
        event.target.value = '';
      }
    },

    async localizeCover() {
      if (!this.selected || !this.form.cover) return;
      this.covers.uploading = true;
      try {
        const game = await api('POST', `/api/games/${this.selected}/cover-from-url`, { url: this.form.cover });
        this.form.cover = game.cover;
        await this.load();
        Alpine.store('app').toast('Cover downloaded into public/covers');
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.covers.uploading = false;
      }
    },

  }));

  /* ---------------- guides ---------------- */

  const blankGuide = () => ({ slug: '', title: '', type: 'Walkthrough', game: '', summary: '', version: '', order: 0, series: '', checklistColumns: 1, checklistCollapsed: false, tags: '', draft: false, gallery: [], downloads: [], body: '' });

  /* GameFAQs-style skeleton. Headings feed the auto-generated table of contents. */
  const WALKTHROUGH_TEMPLATE = `## Introduction

What this game is, what this guide covers and how to use it.

## Controls

| Button | Action |
| --- | --- |
| A | Confirm / talk |
| B | Cancel / run |

## Characters

### Character name

Who they are, when they join and what they are good at.

## Part 1: Area or chapter name

### Map

![Area map](/guides/{{slug}}/area-map.png)

### Checklist

- [ ] Item or event in this area
- [ ] Another one

### Walkthrough

Step by step through the area.

## Part 2: Next area

### Map

### Checklist

### Walkthrough

## Credits & Version History

- 1.0 - First version.
`;

  Alpine.data('guidesView', () => ({
    guides: [],
    games: [],
    q: '',
    selected: null,
    isNew: false,
    form: null,
    dirty: false,
    saving: false,
    preview: false,
    panel: null,
    attachments: [],
    uploading: false,
    linkGuides: [],
    linkGuide: '',
    linkHeadings: [],

    async init() {
      await this.load();
      this.games = await api('GET', '/api/games');
      const param = Alpine.store('app').param;
      if (param === 'new') this.create();
      else if (param) await this.open(param);
      this.$watch('form', () => {
        if (this._loading) return;
        this.dirty = true;
      });
      // Dialogs (gallery, link, downloads) and the outline drawer lock page scrolling and close on Escape.
      this.$watch('panel', (open) => document.body.classList.toggle('overflow-hidden', Boolean(open)));
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.panel) this.panel = null;
      });
    },

    get filtered() {
      const q = this.q.trim().toLowerCase();
      return this.guides.filter((g) => !q || `${g.title} ${g.type} ${g.game ?? ''}`.toLowerCase().includes(q));
    },

    get slugPreview() {
      return this.form?.slug?.trim() || slugify(this.form?.title ?? '');
    },

    get rendered() {
      return window.marked ? marked.parse(this.form?.body ?? '') : '';
    },

    /** Suggested types: the built-in list plus every type already used by a guide. */
    get typeSuggestions() {
      const used = this.guides.map((g) => g.type).filter(Boolean);
      return [...new Set([...(Alpine.store('app').meta.guideTypes ?? []), ...used])];
    },

    /** Series names already used by other guides of the selected game, so parts get the exact same spelling. */
    get seriesSuggestions() {
      const game = this.form?.game;
      if (!game) return [];
      return [...new Set(this.guides.filter((g) => g.game === game && g.series).map((g) => g.series))];
    },

    /** The other parts of the series being edited, in reading order - shown under the field as a preview. */
    get seriesParts() {
      const series = (this.form?.series ?? '').trim().toLowerCase();
      if (!series || !this.form?.game) return [];
      return this.guides
        .filter((g) => g.game === this.form.game && g.slug !== this.form.slug && String(g.series ?? '').trim().toLowerCase() === series)
        .map((g) => ({ slug: g.slug, title: g.title, order: Number(g.order) || 0 }))
        .concat([{ slug: this.form.slug || '(this guide)', title: this.form.title || 'This guide', order: Number(this.form.order) || 0, current: true }])
        .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    },

    async load() {
      this.guides = await api('GET', '/api/guides');
    },

    setForm(value) {
      this._loading = true;
      this.form = value;
      this.dirty = false;
      this.$nextTick(() => {
        this._loading = false;
      });
    },

    async create() {
      if (!(await confirmDiscard(this.dirty))) return;
      this.selected = null;
      this.isNew = true;
      this.preview = false;
      this.panel = null;
      this.attachments = [];
      this.setForm(blankGuide());
    },

    async open(slug) {
      if (!(await confirmDiscard(this.dirty))) return;
      try {
        const g = await api('GET', `/api/guides/${slug}`);
        this.selected = slug;
        this.isNew = false;
        this.panel = null;
        this.setForm({
          ...blankGuide(),
          ...g,
          game: g.game ?? '',
          summary: g.summary ?? '',
          version: g.version ?? '',
          order: g.order ?? 0,
          series: g.series ?? '',
          checklistColumns: g.checklistColumns ?? 1,
          checklistCollapsed: Boolean(g.checklistCollapsed),
          tags: (g.tags ?? []).join(', '),
          gallery: (g.gallery ?? []).map((item) => ({ ...item, caption: item.caption ?? '' })),
          downloads: (g.downloads ?? []).map((item) => ({ ...item, note: item.note ?? '' })),
        });
        await this.loadAttachments();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    async close() {
      if (!(await confirmDiscard(this.dirty))) return;
      this.form = null;
      this.selected = null;
      this.dirty = false;
      this.panel = null;
    },

    payload() {
      return {
        ...this.form,
        gallery: this.form.gallery.map((g) => ({ src: g.src, title: g.title, caption: g.caption || undefined })),
        downloads: this.form.downloads.map((d) => ({ label: d.label, url: d.url, note: d.note || undefined })),
      };
    },

    async save() {
      if (!this.form) return;
      this.saving = true;
      try {
        const saved = this.isNew ? await api('POST', '/api/guides', this.payload()) : await api('PUT', `/api/guides/${this.selected}`, this.payload());
        Alpine.store('app').toast(`Saved "${saved.title}"`);
        await this.load();
        this.dirty = false;
        await this.open(saved.slug);
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.saving = false;
      }
    },

    async remove() {
      if (!this.selected) return;
      if (!(await window.dialog.danger(`Delete guide "${this.form.title}"?`, { text: `Its images in public/guides/${this.selected}/ are deleted too.` }))) return;
      try {
        await api('DELETE', `/api/guides/${this.selected}`);
        Alpine.store('app').toast('Guide deleted');
        this.form = null;
        this.selected = null;
        this.dirty = false;
        await this.load();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    /* ---- text helpers ---- */

    insert(snippet) {
      const el = this.$refs.body;
      if (!el) return;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      this.form.body = el.value.slice(0, start) + snippet + el.value.slice(end);
      this.$nextTick(() => {
        el.focus();
        el.selectionStart = el.selectionEnd = start + snippet.length;
      });
    },

    /* ---- table dialog ---- */

    table: { cols: 3, rows: 3, header: true, paste: '' },
    dragging: false,

    /** Builds a Markdown table of the chosen size (header row + `rows` body rows) and drops it at the cursor. */
    insertTable() {
      const cols = Math.min(12, Math.max(1, Number(this.table.cols) || 1));
      const rows = Math.min(50, Math.max(1, Number(this.table.rows) || 1));
      const cell = (text) => ` ${text} `;
      const line = (cells) => `|${cells.join('|')}|`;
      const head = line(Array.from({ length: cols }, (_, i) => cell(this.table.header ? `Column ${i + 1}` : ' ')));
      const rule = line(Array.from({ length: cols }, () => ' --- '));
      const body = Array.from({ length: rows }, () => line(Array.from({ length: cols }, () => cell(' ')))).join('\n');
      this.insertBlock(`${head}\n${rule}\n${body}`);
      this.panel = null;
    },

    /**
     * Turns rows pasted from a spreadsheet (tab-, semicolon- or comma-separated, first line = header)
     * into a Markdown table at the cursor. On the site every table is sortable and filterable.
     */
    insertPastedTable() {
      const lines = String(this.table.paste ?? '')
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+$/, ''))
        .filter((l) => l.trim());
      if (lines.length < 2) {
        Alpine.store('app').toast('Paste at least a header line and one row', 'error');
        return;
      }
      const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
      const split = (line) => line.split(delimiter).map((c) => c.trim().replace(/^"(.*)"$/, '$1').replace(/\|/g, '\\|'));
      const header = split(lines[0]);
      const rows = lines.slice(1).map(split).map((r) => header.map((_, i) => r[i] ?? ''));
      const line = (cells) => `| ${cells.join(' | ')} |`;
      this.insertBlock([line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n'));
      this.table.paste = '';
      this.panel = null;
      Alpine.store('app').toast(`Table with ${rows.length} rows inserted`);
    },

    /** Wraps the selection (or a placeholder) in markers: **bold**, *italic*, <u>underline</u>, ~~strike~~. */
    wrap(before, after = before, placeholder = 'text') {
      const el = this.$refs.body;
      if (!el) return;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const inner = el.value.slice(start, end) || placeholder;
      this.form.body = el.value.slice(0, start) + before + inner + after + el.value.slice(end);
      this.$nextTick(() => {
        el.focus();
        el.selectionStart = start + before.length;
        el.selectionEnd = start + before.length + inner.length;
      });
    },

    /**
     * Puts a line prefix (## , > , - [ ] ) in front of every selected line - or the cursor's line -
     * and removes it again when every one of those lines already carries it.
     */
    prefixLines(prefix) {
      const el = this.$refs.body;
      if (!el) return;
      const lines = el.value.split('\n');
      const lineAt = (offset) => el.value.slice(0, offset).split('\n').length - 1;
      const from = lineAt(el.selectionStart ?? 0);
      const to = lineAt(el.selectionEnd ?? el.selectionStart ?? 0);
      const remove = lines.slice(from, to + 1).every((l) => l.startsWith(prefix));
      for (let i = from; i <= to; i++) lines[i] = remove ? lines[i].slice(prefix.length) : prefix + lines[i];
      const start = lines.slice(0, from).join('\n').length + (from > 0 ? 1 : 0);
      const end = lines.slice(0, to + 1).join('\n').length;
      this.form.body = lines.join('\n');
      this.$nextTick(() => {
        el.focus();
        el.selectionStart = from === to ? end : start;
        el.selectionEnd = end;
      });
    },

    /**
     * Ticks or unticks the `- [ ]` lines in the selection - or, with no selection, the whole task
     * list around the cursor (contiguous `- [ ]` lines).
     */
    setTasks(checked) {
      const el = this.$refs.body;
      if (!el) return;
      const TASK = /^(\s*[-*+]\s+\[)( |x|X)(\])/;
      const value = el.value;
      const lines = value.split('\n');
      const lineAt = (offset) => value.slice(0, offset).split('\n').length - 1;
      let from = lineAt(el.selectionStart ?? 0);
      let to = lineAt(el.selectionEnd ?? el.selectionStart ?? 0);
      if (from === to && el.selectionStart === el.selectionEnd) {
        if (!TASK.test(lines[from])) {
          Alpine.store('app').toast('Put the cursor on a "- [ ]" line, or select the lines to change', 'error');
          return;
        }
        while (from > 0 && TASK.test(lines[from - 1])) from--;
        while (to < lines.length - 1 && TASK.test(lines[to + 1])) to++;
      }
      let count = 0;
      for (let i = from; i <= to; i++) {
        if (!TASK.test(lines[i])) continue;
        lines[i] = lines[i].replace(TASK, `$1${checked ? 'x' : ' '}$3`);
        count++;
      }
      if (!count) {
        Alpine.store('app').toast('No "- [ ]" lines in the selection', 'error');
        return;
      }
      const start = lines.slice(0, from).join('\n').length + (from > 0 ? 1 : 0);
      const end = lines.slice(0, to + 1).join('\n').length;
      this.form.body = lines.join('\n');
      this.$nextTick(() => {
        el.focus();
        el.selectionStart = start;
        el.selectionEnd = end;
      });
      Alpine.store('app').toast(`${checked ? 'Ticked' : 'Unticked'} ${count} item${count === 1 ? '' : 's'}`);
    },

    /** The body's ## / ### headings with their line numbers - the Outline panel. Code fences are skipped. */
    get outline() {
      const out = [];
      let fence = false;
      String(this.form?.body ?? '')
        .split('\n')
        .forEach((line, index) => {
          if (/^\s*(```|~~~)/.test(line)) fence = !fence;
          if (fence) return;
          const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
          if (m) out.push({ line: index, depth: m[1].length, text: m[2] });
        });
      return out;
    },

    /** Puts the cursor on a line of the body and scrolls the editor so that line sits near the top. */
    jumpToLine(line) {
      const el = this.$refs.body;
      if (!el) return;
      this.preview = false;
      this.$nextTick(() => {
        const lines = el.value.split('\n');
        const start = lines.slice(0, line).join('\n').length + (line > 0 ? 1 : 0);
        // Measure where the line lands by laying the text before it out in a hidden copy of the textarea.
        const cs = getComputedStyle(el);
        const mirror = document.createElement('div');
        for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'tabSize']) mirror.style[p] = cs[p];
        Object.assign(mirror.style, { position: 'absolute', top: '0', left: '0', visibility: 'hidden', border: '0', boxSizing: 'border-box', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: `${el.clientWidth}px` });
        mirror.textContent = `${el.value.slice(0, start)}​`;
        document.body.append(mirror);
        const lineHeight = parseFloat(cs.lineHeight) || 22;
        const top = mirror.offsetHeight - parseFloat(cs.paddingBottom) - lineHeight;
        mirror.remove();
        el.scrollTop = Math.max(0, top - lineHeight);
        el.setSelectionRange(start, start + (lines[line] ?? '').length);
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'nearest' });
      });
    },

    /** Inserts a block (image, template) on its own paragraph. */
    insertBlock(text) {
      const el = this.$refs.body;
      const before = el ? el.value.slice(0, el.selectionStart ?? el.value.length) : this.form.body;
      const prefix = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      this.insert(`${prefix}${text}\n\n`);
    },

    async insertTemplate() {
      if (this.form.body.trim() && !(await window.dialog.confirm('Insert the walkthrough skeleton?', { text: 'It goes in at the cursor; your existing text is kept.', confirmText: 'Insert' }))) return;
      const slug = this.isNew ? this.slugPreview || 'your-guide' : this.selected;
      this.insertBlock(WALKTHROUGH_TEMPLATE.replaceAll('{{slug}}', slug).trimEnd());
    },

    togglePanel(name) {
      this.panel = this.panel === name ? null : name;
      if (this.panel === 'link') this.openLinkPicker();
    },

    /* ---- attachments & gallery ---- */

    async loadAttachments() {
      if (!this.selected) return;
      try {
        this.attachments = await api('GET', `/api/guides/${this.selected}/attachments`);
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    /** Upload from the file picker (change event) or a drop (dragging files onto the Gallery dialog). */
    async uploadAttachments(event) {
      const files = Array.from(event.target?.files ?? event.dataTransfer?.files ?? []);
      if (event.target && 'value' in event.target) event.target.value = '';
      await this.uploadFiles(files);
    },

    async uploadFiles(files) {
      const images = files.filter((file) => file.type.startsWith('image/'));
      if (!images.length || !this.selected) {
        if (files.length && !images.length) Alpine.store('app').toast('Only images can be uploaded here (PNG, JPEG, WebP, GIF, SVG)', 'error');
        return;
      }
      const body = new FormData();
      for (const file of images) body.append('files', file);
      this.uploading = true;
      try {
        const result = await api('POST', `/api/guides/${this.selected}/attachments`, body);
        this.attachments = result.files;
        Alpine.store('app').toast(`Uploaded ${result.added.length} image(s)`);
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.uploading = false;
      }
    },

    async deleteAttachment(file) {
      if (!(await window.dialog.danger(`Delete ${file.name}?`, { text: 'Any place in the text or gallery that uses it will break.' }))) return;
      try {
        const result = await api('DELETE', `/api/guides/${this.selected}/attachments/${encodeURIComponent(file.name)}`);
        this.attachments = result.files;
        this.form.gallery = this.form.gallery.filter((g) => g.src !== file.url);
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    insertImage(file) {
      const alt = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
      this.insertBlock(`![${alt}](${file.url})`);
      if (this.preview) this.preview = false;
      this.panel = null;
    },

    inGallery(file) {
      return this.form.gallery.some((g) => g.src === file.url);
    },

    addToGallery(file) {
      if (this.inGallery(file)) return;
      const title = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      this.form.gallery.push({ src: file.url, title, caption: '' });
    },

    move(list, from, to) {
      if (to < 0 || to >= list.length) return;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
    },

    /* ---- links to other guides ---- */

    openLinkPicker() {
      const game = this.form?.game;
      this.linkGuides = this.guides
        .filter((g) => g.slug !== this.selected)
        .sort((a, b) => Number((b.game ?? '') === game) - Number((a.game ?? '') === game) || a.title.localeCompare(b.title));
      if (!this.linkGuide) {
        this.linkHeadings = [];
      }
    },

    async loadHeadings() {
      this.linkHeadings = [];
      if (!this.linkGuide) return;
      try {
        this.linkHeadings = await api('GET', `/api/guides/${this.linkGuide}/headings`);
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    insertLink(heading) {
      const guide = this.guides.find((g) => g.slug === this.linkGuide);
      if (!guide) return;
      const href = heading ? `/guides/${guide.slug}#${heading.slug}` : `/guides/${guide.slug}`;
      const text = heading ? heading.text : guide.title;
      this.insert(`[${text}](${href})`);
    },
  }));

  /* ---------------- trackers ---------------- */

  const blankTracker = () => ({ slug: '', title: '', type: 'checklist', game: '', summary: '', checklistColumns: 1, checklistCollapsed: false, sections: [] });
  // _uid only identifies a section inside the editor (collapse state, jump targets); the schema drops it on save.
  let sectionUid = 0;
  const blankSection = () => ({ _uid: ++sectionUid, title: '', items: [], bulk: '' });
  const blankItem = () => ({ id: '', label: '', note: '', done: false });

  Alpine.data('trackersView', () => ({
    trackers: [],
    games: [],
    q: '',
    selected: null,
    isNew: false,
    form: null,
    dirty: false,
    saving: false,
    /* Editor-only state, kept outside `form` so folding sections never counts as an unsaved change. */
    ui: { collapsed: {}, sections: false },

    async init() {
      await this.load();
      this.games = await api('GET', '/api/games');
      const param = Alpine.store('app').param;
      if (param === 'new') this.create();
      else if (param) await this.open(param);
      this.$watch('form', () => {
        if (this._loading) return;
        this.dirty = true;
      });
      // The Sections drawer locks page scrolling behind it, like the drawers on the public site.
      this.$watch('ui.sections', (open) => document.body.classList.toggle('overflow-hidden', open));
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.ui.sections) this.ui.sections = false;
      });
    },

    get filtered() {
      const q = this.q.trim().toLowerCase();
      return this.trackers.filter((t) => !q || `${t.title} ${t.type} ${t.game ?? ''}`.toLowerCase().includes(q));
    },

    get slugPreview() {
      return this.form?.slug?.trim() || slugify(this.form?.title ?? '');
    },

    progress(tracker) {
      const items = (tracker?.sections ?? []).flatMap((s) => s.items ?? []);
      const done = items.filter((i) => i.done).length;
      return { done, total: items.length, pct: items.length ? Math.round((done / items.length) * 100) : 0 };
    },

    async load() {
      this.trackers = await api('GET', '/api/trackers');
    },

    setForm(value) {
      this._loading = true;
      this.form = value;
      this.dirty = false;
      // Long trackers open folded so the page is a list of section headers, not hundreds of rows.
      const fold = value.sections.length > 1;
      this.ui.collapsed = Object.fromEntries(value.sections.map((s) => [s._uid, fold]));
      this.ui.sections = false;
      this.$nextTick(() => {
        this._loading = false;
      });
    },

    async create() {
      if (!(await confirmDiscard(this.dirty))) return;
      this.selected = null;
      this.isNew = true;
      const form = blankTracker();
      form.sections.push({ ...blankSection(), title: 'Part 1' });
      this.setForm(form);
    },

    /* ---- folding + jumping between sections ---- */

    isCollapsed(section) {
      return Boolean(this.ui.collapsed[section._uid]);
    },
    toggleSection(section) {
      this.ui.collapsed[section._uid] = !this.isCollapsed(section);
    },
    setAllCollapsed(collapsed) {
      for (const section of this.form.sections) this.ui.collapsed[section._uid] = collapsed;
    },
    /** Opens a section and scrolls its card to just below the sticky section strip. */
    jumpTo(section) {
      this.ui.collapsed[section._uid] = false;
      this.ui.sections = false;
      this.$nextTick(() => {
        const card = document.getElementById(`tracker-section-${section._uid}`);
        if (!card) return;
        const strip = this.$root.querySelector('[data-section-strip]');
        const offset = (strip?.offsetHeight ?? 0) + 8;
        window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
      });
    },

    async open(slug) {
      if (!(await confirmDiscard(this.dirty))) return;
      try {
        const t = await api('GET', `/api/trackers/${slug}`);
        this.selected = slug;
        this.isNew = false;
        this.setForm({
          ...blankTracker(),
          ...t,
          game: t.game ?? '',
          summary: t.summary ?? '',
          checklistColumns: t.checklistColumns ?? 1,
          checklistCollapsed: Boolean(t.checklistCollapsed),
          sections: (t.sections ?? []).map((s) => ({ ...blankSection(), ...s, items: (s.items ?? []).map((i) => ({ ...blankItem(), ...i, note: i.note ?? '' })) })),
        });
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    async close() {
      if (!(await confirmDiscard(this.dirty))) return;
      this.form = null;
      this.selected = null;
      this.dirty = false;
      this.ui.sections = false;
    },

    addSection() {
      const section = { ...blankSection(), title: `Part ${this.form.sections.length + 1}` };
      this.form.sections.push(section);
      this.jumpTo(section);
    },
    async removeSection(i) {
      if (this.form.sections[i].items.length && !(await window.dialog.danger(`Remove "${this.form.sections[i].title || `section ${i + 1}`}"?`, { text: `Its ${this.form.sections[i].items.length} item(s) go with it.`, confirmText: 'Remove' }))) return;
      this.form.sections.splice(i, 1);
    },
    move(list, from, to) {
      if (to < 0 || to >= list.length) return;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
    },
    addItem(section) {
      section.items.push(blankItem());
      this.$nextTick(() => {
        const inputs = this.$root.querySelectorAll('[data-item-label]');
        inputs[inputs.length - 1]?.focus();
      });
    },
    addBulk(section) {
      const lines = String(section.bulk ?? '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        const [label, ...rest] = line.split(' | ');
        section.items.push({ ...blankItem(), label: label.trim(), note: rest.join(' | ').trim() });
      }
      section.bulk = '';
    },
    removeItem(section, i) {
      section.items.splice(i, 1);
    },
    sectionDone(section) {
      return section.items.filter((item) => item.done).length;
    },
    /** Marks every item of one section done (or not). Clearing asks first. */
    async setSectionDone(section, done) {
      const ticked = this.sectionDone(section);
      if (!done && ticked > 0 && !(await window.dialog.confirm(`Untick ${ticked === 1 ? 'the 1 item' : `all ${ticked} items`}?`, { text: `In "${section.title || 'this section'}".`, confirmText: 'Untick', icon: 'warning' }))) return;
      for (const item of section.items) item.done = done;
    },

    payload() {
      return {
        ...this.form,
        sections: this.form.sections.map((s) => ({ title: s.title, items: s.items.map((i) => ({ id: i.id || undefined, label: i.label, note: i.note || undefined, done: Boolean(i.done) })) })),
      };
    },

    async save() {
      if (!this.form) return;
      this.saving = true;
      try {
        const saved = this.isNew ? await api('POST', '/api/trackers', this.payload()) : await api('PUT', `/api/trackers/${this.selected}`, this.payload());
        Alpine.store('app').toast(`Saved "${saved.title}"`);
        await this.load();
        this.dirty = false;
        await this.open(saved.slug);
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.saving = false;
      }
    },

    async remove() {
      if (!this.selected) return;
      if (!(await window.dialog.danger(`Delete tracker "${this.form.title}"?`, { text: `This removes src/content/trackers/${this.selected}.json.` }))) return;
      try {
        await api('DELETE', `/api/trackers/${this.selected}`);
        Alpine.store('app').toast('Tracker deleted');
        this.form = null;
        this.selected = null;
        this.dirty = false;
        await this.load();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },
  }));


  /* ---------------- achievement sets: Steam sync + manual sets ---------------- */

  const blankJournal = () => ({ rating: '', hoursPlayed: '', startedAt: '', finishedAt: '', review: '', notes: '' });
  const blankSet = () => ({ slug: '', title: '', source: 'manual', game: '', appId: '', url: '', playtimeMinutes: '', journal: blankJournal(), achievements: [], bulk: '' });
  const blankAchievement = () => ({ id: '', title: '', description: '', icon: '', iconLocked: '', hidden: false, unlockedAt: '', rarity: '' });
  const today = () => new Date().toISOString().slice(0, 10);

  Alpine.data('setsView', () => ({
    sets: [],
    games: [],
    q: '',
    selected: null,
    isNew: false,
    form: null,
    dirty: false,
    saving: false,
    importingSchema: false,
    steam: {
      status: null,
      job: null,
      polling: null,
      autoStatus: false,
      autoHours: true,
      autoDates: true,
      candidates: null,
      loadingCandidates: false,
      selection: {},
      q: '',
      importing: false,
      importResult: null,
    },

    async init() {
      await this.load();
      this.games = await api('GET', '/api/games');
      await this.refreshSteam();
      if (this.steam.job?.running) this.startPolling();
      const param = Alpine.store('app').param;
      if (param === 'new') this.create();
      else if (param) await this.open(param);
      this.$watch('form', () => {
        if (this._loading) return;
        this.dirty = true;
      });
    },

    get filtered() {
      const q = this.q.trim().toLowerCase();
      return this.sets.filter((s) => !q || `${s.title} ${this.gameTitle(s.game)} ${s.source}`.toLowerCase().includes(q));
    },

    gameTitle(slug) {
      return this.games.find((g) => g.slug === slug)?.title ?? slug;
    },

    progress(set) {
      const list = set?.achievements ?? [];
      const done = list.filter((a) => a.unlockedAt).length;
      return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
    },

    async load() {
      this.sets = await api('GET', '/api/sets');
    },

    setForm(value) {
      this._loading = true;
      this.form = value;
      this.dirty = false;
      this.$nextTick(() => {
        this._loading = false;
      });
    },

    async create() {
      if (!(await confirmDiscard(this.dirty))) return;
      this.selected = null;
      this.isNew = true;
      this.setForm({ ...blankSet(), title: 'GOG' });
    },

    async open(slug) {
      if (!(await confirmDiscard(this.dirty))) return;
      try {
        const set = await api('GET', `/api/sets/${slug}`);
        this.selected = slug;
        this.isNew = false;
        this.setForm({
          ...blankSet(),
          ...set,
          appId: set.appId ?? '',
          url: set.url ?? '',
          playtimeMinutes: set.playtimeMinutes ?? '',
          journal: { ...blankJournal(), ...(set.journal ?? {}) },
          achievements: (set.achievements ?? []).map((a) => ({ ...blankAchievement(), ...a, icon: a.icon ?? '', iconLocked: a.iconLocked ?? '', unlockedAt: a.unlockedAt ?? '', rarity: a.rarity ?? '' })),
        });
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    async close() {
      if (!(await confirmDiscard(this.dirty))) return;
      this.form = null;
      this.selected = null;
      this.isNew = false;
      this.dirty = false;
    },

    async save() {
      if (!this.form) return;
      if (!this.form.game) {
        Alpine.store('app').toast('Pick the game this set belongs to', 'error');
        return;
      }
      this.saving = true;
      try {
        const { bulk: _bulk, ...rest } = this.form;
        const payload = {
          ...rest,
          achievements: rest.achievements.map((a, i) => ({ ...a, id: a.id || slugify(a.title) || `achievement-${i + 1}`, unlockedAt: a.unlockedAt || null, rarity: a.rarity === '' ? null : a.rarity })),
        };
        const saved = this.isNew ? await api('POST', '/api/sets', payload) : await api('PUT', `/api/sets/${this.selected}`, payload);
        Alpine.store('app').toast(`Saved "${saved.title}" for ${this.gameTitle(saved.game)}`);
        await this.load();
        this.dirty = false;
        await this.open(saved.slug);
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.saving = false;
      }
    },

    async remove() {
      if (!this.selected) return;
      if (!(await window.dialog.danger(`Delete the "${this.form.title}" set of ${this.gameTitle(this.form.game)}?`, { text: `This removes src/content/achievement-sets/${this.selected}.json.` }))) return;
      try {
        await api('DELETE', `/api/sets/${this.selected}`);
        Alpine.store('app').toast('Set deleted');
        this.form = null;
        this.selected = null;
        this.dirty = false;
        await this.load();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    /* ---- achievements of a manual set ---- */

    addAchievement() {
      this.form.achievements.push(blankAchievement());
      this.$nextTick(() => {
        const inputs = this.$root.querySelectorAll('[data-achievement-title]');
        inputs[inputs.length - 1]?.focus();
      });
    },

    removeAchievement(i) {
      this.form.achievements.splice(i, 1);
    },

    move(list, from, to) {
      if (to < 0 || to >= list.length) return;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item);
    },

    /** "Title | Description" per line. */
    addBulk() {
      const lines = String(this.form.bulk ?? '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        const [title, ...rest] = line.split(' | ');
        this.form.achievements.push({ ...blankAchievement(), title: title.trim(), description: rest.join(' | ').trim() });
      }
      this.form.bulk = '';
    },

    toggleUnlocked(a) {
      a.unlockedAt = a.unlockedAt ? '' : today();
    },

    async setAllUnlocked(on) {
      const list = this.form.achievements;
      if (!on && list.some((a) => a.unlockedAt) && !(await window.dialog.confirm('Untick every achievement in this set?', { text: 'The unlock dates you typed are cleared.', confirmText: 'Untick', icon: 'warning' }))) return;
      for (const a of list) a.unlockedAt = on ? a.unlockedAt || today() : '';
    },

    /** Pulls the achievement list of a Steam app into this set; existing rows keep their unlock dates. */
    async importSchema() {
      const appId = Number(this.form.appId);
      if (!appId) {
        Alpine.store('app').toast('Enter the Steam app id first (the number in store.steampowered.com/app/<id>)', 'error');
        return;
      }
      this.importingSchema = true;
      try {
        const list = await api('GET', `/api/steam/schema/${appId}`);
        if (!list.length) {
          Alpine.store('app').toast('Steam lists no achievements for that app', 'error');
          return;
        }
        const byId = new Map(this.form.achievements.map((a) => [a.id, a]));
        let added = 0;
        for (const a of list) {
          const row = byId.get(a.id);
          if (row) {
            Object.assign(row, { title: a.title, description: a.description, icon: a.icon ?? '', iconLocked: a.iconLocked ?? '', hidden: a.hidden, rarity: a.rarity ?? '' });
          } else {
            this.form.achievements.push({ ...blankAchievement(), ...a, icon: a.icon ?? '', iconLocked: a.iconLocked ?? '', unlockedAt: '', rarity: a.rarity ?? '' });
            added++;
          }
        }
        if (!this.form.url) this.form.url = `https://store.steampowered.com/app/${appId}`;
        Alpine.store('app').toast(`${list.length} achievements from Steam (${added} new). Tick the ones you have unlocked.`);
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.importingSchema = false;
      }
    },

    /* ---- Steam sync + import ---- */

    async refreshSteam() {
      try {
        this.steam.status = await api('GET', '/api/steam/status');
        this.steam.job = this.steam.status.job;
      } catch {
        this.steam.status = { configured: false, job: null };
      }
    },

    get steamProgressPct() {
      const p = this.steam.job?.progress;
      return p?.total ? Math.round((p.done / p.total) * 100) : 0;
    },

    async sync() {
      try {
        this.steam.job = await api('POST', '/api/steam/sync', { autoStatus: this.steam.autoStatus, autoHours: this.steam.autoHours, autoDates: this.steam.autoDates });
        this.startPolling();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    startPolling() {
      clearInterval(this.steam.polling);
      this.steam.polling = setInterval(async () => {
        try {
          this.steam.job = await api('GET', '/api/steam/sync/status');
          this.$nextTick(() => {
            const el = this.$refs.steamLog;
            if (el) el.scrollTop = el.scrollHeight;
          });
          if (!this.steam.job.running) {
            clearInterval(this.steam.polling);
            this.steam.polling = null;
            await this.load();
            this.games = await api('GET', '/api/games');
            Alpine.store('app').toast(this.steam.job.error ? `Steam sync failed: ${this.steam.job.error}` : 'Steam sync finished', this.steam.job.error ? 'error' : 'ok');
          }
        } catch (err) {
          clearInterval(this.steam.polling);
          this.steam.polling = null;
          Alpine.store('app').toast(err.message, 'error');
        }
      }, 1000);
    },

    async loadCandidates() {
      this.steam.loadingCandidates = true;
      try {
        this.steam.candidates = await api('GET', '/api/steam/import-candidates');
        this.steam.selection = {};
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.steam.loadingCandidates = false;
      }
    },

    get filteredCandidates() {
      const q = this.steam.q.trim().toLowerCase();
      return (this.steam.candidates ?? []).filter((c) => !q || c.title.toLowerCase().includes(q));
    },

    get selectedCount() {
      return Object.values(this.steam.selection).filter(Boolean).length;
    },

    selectAll(on) {
      for (const c of this.filteredCandidates) this.steam.selection[c.appId] = on;
    },

    async importSelected() {
      const picks = (this.steam.candidates ?? []).filter((c) => this.steam.selection[c.appId]).map((c) => ({ appId: c.appId }));
      if (!picks.length) return;
      this.steam.importing = true;
      this.steam.importResult = null;
      try {
        this.steam.importResult = await api('POST', '/api/steam/import', { games: picks });
        Alpine.store('app').toast(`Imported ${this.steam.importResult.created.length} games from Steam`);
        this.games = await api('GET', '/api/games');
        await this.loadCandidates();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.steam.importing = false;
      }
    },

    hours(minutes) {
      return Math.round((Number(minutes || 0) / 60) * 10) / 10;
    },
  }));

  /* ---------------- RetroAchievements ---------------- */

  Alpine.data('raView', () => ({
    status: null,
    job: null,
    autoStatus: false,
    autoHours: true,
    autoDates: true,
    polling: null,
    candidates: null,
    loadingCandidates: false,
    selection: {},
    importing: false,
    importResult: null,
    consolesBusy: false,
    subsets: [],
    merging: null,

    async init() {
      await this.refresh();
      if (this.job?.running) this.startPolling();
      this.loadSubsets();
    },

    /* ---- subsets imported as separate games ---- */

    async loadSubsets() {
      try {
        this.subsets = await api('GET', '/api/ra/subsets');
      } catch {
        this.subsets = [];
      }
    },

    async mergeSubset(entry) {
      const hours = entry.hoursPlayed ? `, ${entry.hoursPlayed} h` : '';
      const merged = await window.dialog.confirm(`Fold "${entry.title}" into "${entry.parent.title}"?`, {
        text: `Its achievements stay, shown as a tab on that game's page.\n\nThe separate library entry (status ${entry.status}${hours}) is removed, and its rating, hours and dates move to the parent. The parent's own stats are not changed.`,
        confirmText: 'Merge',
      });
      if (!merged) return;
      this.merging = entry.slug;
      try {
        const result = await api('POST', '/api/ra/subsets/merge', { slug: entry.slug });
        this.subsets = result.remaining;
        Alpine.store('app').toast('Merged "' + entry.title + '" into "' + entry.parent.title + '"');
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.merging = null;
      }
    },

    async refresh() {
      this.status = await api('GET', '/api/ra/status');
      this.job = this.status.job;
    },

    get progressPct() {
      const p = this.job?.progress;
      return p?.total ? Math.round((p.done / p.total) * 100) : 0;
    },

    async sync() {
      try {
        this.job = await api('POST', '/api/ra/sync', { autoStatus: this.autoStatus, autoHours: this.autoHours, autoDates: this.autoDates });
        this.startPolling();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    startPolling() {
      clearInterval(this.polling);
      this.polling = setInterval(async () => {
        try {
          this.job = await api('GET', '/api/ra/sync/status');
          this.$nextTick(() => {
            const el = this.$refs.log;
            if (el) el.scrollTop = el.scrollHeight;
          });
          if (!this.job.running) {
            clearInterval(this.polling);
            this.polling = null;
            await this.refresh();
            Alpine.store('app').toast(this.job.error ? `Sync failed: ${this.job.error}` : 'RetroAchievements sync finished', this.job.error ? 'error' : 'ok');
            if (this.candidates) await this.loadCandidates();
          }
        } catch (err) {
          clearInterval(this.polling);
          this.polling = null;
          Alpine.store('app').toast(err.message, 'error');
        }
      }, 1000);
    },

    async loadCandidates() {
      this.loadingCandidates = true;
      try {
        this.candidates = await api('GET', '/api/ra/import-candidates');
        this.selection = {};
        for (const c of this.candidates) {
          c.status = c.suggestedStatus;
          c.platform = c.platform ?? '';
        }
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.loadingCandidates = false;
      }
    },

    get selectedCount() {
      return Object.values(this.selection).filter(Boolean).length;
    },

    selectAll(on) {
      for (const c of this.candidates ?? []) this.selection[c.gameId] = on;
    },

    async importSelected() {
      const picks = (this.candidates ?? []).filter((c) => this.selection[c.gameId]).map((c) => ({ gameId: c.gameId, status: c.status, platform: c.platform || undefined }));
      if (!picks.length) return;
      this.importing = true;
      this.importResult = null;
      try {
        this.importResult = await api('POST', '/api/ra/import', { games: picks });
        Alpine.store('app').toast(`Imported ${this.importResult.created.length} games`);
        await Alpine.store('app').refreshMeta();
        await this.loadCandidates();
        await this.refresh();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.importing = false;
      }
    },

    async importConsoles() {
      this.consolesBusy = true;
      try {
        const r = await api('POST', '/api/ra/consoles');
        await Alpine.store('app').refreshMeta();
        Alpine.store('app').toast(`RA consoles: ${r.added} platforms added, ${r.linked} linked`);
        if (this.candidates) await this.loadCandidates();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.consolesBusy = false;
      }
    },

    destroy() {
      clearInterval(this.polling);
    },
  }));

  /* ---------------- trophy shelf order ---------------- */

  Alpine.data('shelfEditor', () => ({
    awards: [],
    manual: false,
    hasDisplayOrder: false,
    loading: true,
    dirty: false,
    saving: false,
    dragFrom: null,
    dragOver: null,
    filter: '',

    async init() {
      await this.load();
    },

    async load() {
      this.loading = true;
      try {
        const state = await api('GET', '/api/shelf');
        this.awards = state.awards;
        this.manual = state.manual;
        this.hasDisplayOrder = state.hasDisplayOrder;
        this.dirty = false;
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.loading = false;
      }
    },

    get visibleCount() {
      return this.awards.filter((a) => !a.hidden).length;
    },

    matches(a) {
      const q = this.filter.trim().toLowerCase();
      return !q || `${a.title} ${a.consoleName}`.toLowerCase().includes(q);
    },

    move(from, to) {
      if (to < 0 || to >= this.awards.length || from === to) return;
      const [item] = this.awards.splice(from, 1);
      this.awards.splice(to, 0, item);
      this.dirty = true;
    },

    toggleHidden(index) {
      const a = this.awards[index];
      a.hidden = !a.hidden;
      this.dirty = true;
    },

    /* native drag and drop between rows */
    onDragStart(index, event) {
      this.dragFrom = index;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    },
    onDrop(index) {
      if (this.dragFrom !== null) this.move(this.dragFrom, index);
      this.dragFrom = null;
      this.dragOver = null;
    },

    async save() {
      this.saving = true;
      try {
        const order = this.awards.filter((a) => !a.hidden).map((a) => a.gameId);
        const hidden = this.awards.filter((a) => a.hidden).map((a) => a.gameId);
        const state = await api('PUT', '/api/shelf', { order, hidden });
        this.awards = state.awards;
        this.manual = state.manual;
        this.dirty = false;
        Alpine.store('app').toast('Trophy shelf order saved');
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.saving = false;
      }
    },

    async followRa() {
      if (!(await window.dialog.confirm('Follow the RetroAchievements order?', { text: 'Your manual arrangement of the trophy shelf is discarded.', confirmText: 'Follow RA', icon: 'warning' }))) return;
      this.saving = true;
      try {
        const state = await api('PUT', '/api/shelf', { order: [], hidden: [] });
        this.awards = state.awards;
        this.manual = state.manual;
        this.dirty = false;
        Alpine.store('app').toast('Shelf now follows RetroAchievements');
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.saving = false;
      }
    },
  }));

  /* ---------------- settings ---------------- */

  Alpine.data('settingsView', () => ({
    site: null,
    platforms: null,
    savingSite: false,
    savingPlatforms: false,
    existingIds: new Set(),

    async init() {
      const [site, platforms] = await Promise.all([api('GET', '/api/site'), api('GET', '/api/platforms')]);
      this.site = { ...site, links: site.links ?? [] };
      this.platforms = platforms.map((p) => ({ ...p, raConsoleId: p.raConsoleId ?? '' }));
      this.existingIds = new Set(platforms.map((p) => p.id));
    },

    addLink() {
      this.site.links.push({ label: '', url: '' });
    },

    async saveSite() {
      this.savingSite = true;
      try {
        this.site = await api('PUT', '/api/site', this.site);
        await Alpine.store('app').refreshMeta();
        Alpine.store('app').toast('Site settings saved');
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.savingSite = false;
      }
    },

    addPlatform() {
      this.platforms.push({ id: '', name: '', short: '', raConsoleId: '' });
    },

    onPlatformName(p) {
      if (!this.existingIds.has(p.id) && !p._idTouched) p.id = slugify(p.name);
    },

    async savePlatforms() {
      this.savingPlatforms = true;
      try {
        const saved = await api('PUT', '/api/platforms', this.platforms.map(({ _idTouched, ...p }) => p));
        this.platforms = saved.map((p) => ({ ...p, raConsoleId: p.raConsoleId ?? '' }));
        this.existingIds = new Set(saved.map((p) => p.id));
        await Alpine.store('app').refreshMeta();
        Alpine.store('app').toast('Platforms saved');
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.savingPlatforms = false;
      }
    },
  }));

  /* ---------------- publish ---------------- */

  Alpine.data('publishView', () => ({
    git: null,
    error: null,
    message: '',
    building: false,
    buildResult: null,
    publishing: false,
    publishResult: null,

    async init() {
      this.message = `Update questlog ${new Date().toISOString().slice(0, 10)}`;
      await this.refresh();
    },

    async refresh() {
      try {
        this.git = await api('GET', '/api/git/status');
        this.error = null;
      } catch (err) {
        this.error = err.message;
      }
    },

    async testBuild() {
      this.building = true;
      this.buildResult = null;
      try {
        this.buildResult = await api('POST', '/api/build');
        Alpine.store('app').toast(this.buildResult.ok ? `Build passed in ${(this.buildResult.ms / 1000).toFixed(1)}s` : 'Build failed - see output', this.buildResult.ok ? 'ok' : 'error');
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.building = false;
      }
    },

    async publish() {
      const go = await window.dialog.confirm('Commit and push everything?', {
        text: `Message: "${this.message}"\n\nPushing to ${this.git?.remote || 'origin'}. Vercel rebuilds the site straight after.`,
        confirmText: 'Commit & push',
      });
      if (!go) return;
      this.publishing = true;
      this.publishResult = null;
      try {
        this.publishResult = await api('POST', '/api/git/publish', { message: this.message });
        Alpine.store('app').toast('Pushed. Vercel will rebuild the site.');
        await this.refresh();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.publishing = false;
      }
    },
  }));
});
