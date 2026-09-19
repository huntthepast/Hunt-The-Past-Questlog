/* QuestLog admin UI. Plain Alpine.js components talking to the local JSON API in admin/server.js. */

const VIEWS = ['dashboard', 'games', 'guides', 'trackers', 'ra', 'settings', 'publish'];
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

const confirmDiscard = (dirty) => !dirty || confirm('You have unsaved changes. Discard them?');

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

    create() {
      if (!confirmDiscard(this.dirty)) return;
      this.selected = null;
      this.isNew = true;
      this.setForm(blankGame());
    },

    async open(slug) {
      if (!confirmDiscard(this.dirty)) return;
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
          review: g.review ?? '',
          notes: g.notes ?? '',
          genres: (g.genres ?? []).join(', '),
          tags: (g.tags ?? []).join(', '),
        });
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    close() {
      if (!confirmDiscard(this.dirty)) return;
      this.form = null;
      this.selected = null;
      this.isNew = false;
      this.dirty = false;
    },

    async save() {
      if (!this.form) return;
      this.saving = true;
      try {
        const payload = { ...this.form };
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
      if (!confirm(`Delete "${this.form.title}"? This removes src/content/games/${this.selected}.json.`)) return;
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

  const blankGuide = () => ({ slug: '', title: '', type: 'Walkthrough', game: '', summary: '', version: '', order: 0, tags: '', draft: false, gallery: [], downloads: [], body: '' });

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

    create() {
      if (!confirmDiscard(this.dirty)) return;
      this.selected = null;
      this.isNew = true;
      this.preview = false;
      this.panel = null;
      this.attachments = [];
      this.setForm(blankGuide());
    },

    async open(slug) {
      if (!confirmDiscard(this.dirty)) return;
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
          tags: (g.tags ?? []).join(', '),
          gallery: (g.gallery ?? []).map((item) => ({ ...item, caption: item.caption ?? '' })),
          downloads: (g.downloads ?? []).map((item) => ({ ...item, note: item.note ?? '' })),
        });
        await this.loadAttachments();
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    close() {
      if (!confirmDiscard(this.dirty)) return;
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
      if (!this.selected || !confirm(`Delete guide "${this.form.title}"? Its images in public/guides/${this.selected}/ are deleted too.`)) return;
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

    /** Inserts a block (image, template) on its own paragraph. */
    insertBlock(text) {
      const el = this.$refs.body;
      const before = el ? el.value.slice(0, el.selectionStart ?? el.value.length) : this.form.body;
      const prefix = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      this.insert(`${prefix}${text}\n\n`);
    },

    insertTemplate() {
      if (this.form.body.trim() && !confirm('Insert the walkthrough skeleton at the cursor? Your existing text is kept.')) return;
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

    async uploadAttachments(event) {
      const files = Array.from(event.target.files ?? []);
      if (!files.length || !this.selected) return;
      const body = new FormData();
      for (const file of files) body.append('files', file);
      this.uploading = true;
      try {
        const result = await api('POST', `/api/guides/${this.selected}/attachments`, body);
        this.attachments = result.files;
        Alpine.store('app').toast(`Uploaded ${result.added.length} image(s)`);
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      } finally {
        this.uploading = false;
        event.target.value = '';
      }
    },

    async deleteAttachment(file) {
      if (!confirm(`Delete ${file.name}? Any place in the text or gallery that uses it will break.`)) return;
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

  const blankTracker = () => ({ slug: '', title: '', type: 'checklist', game: '', summary: '', sections: [] });
  const blankSection = () => ({ title: '', items: [], bulk: '' });
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
      this.$nextTick(() => {
        this._loading = false;
      });
    },

    create() {
      if (!confirmDiscard(this.dirty)) return;
      this.selected = null;
      this.isNew = true;
      const form = blankTracker();
      form.sections.push({ ...blankSection(), title: 'Part 1' });
      this.setForm(form);
    },

    async open(slug) {
      if (!confirmDiscard(this.dirty)) return;
      try {
        const t = await api('GET', `/api/trackers/${slug}`);
        this.selected = slug;
        this.isNew = false;
        this.setForm({
          ...blankTracker(),
          ...t,
          game: t.game ?? '',
          summary: t.summary ?? '',
          sections: (t.sections ?? []).map((s) => ({ ...blankSection(), ...s, items: (s.items ?? []).map((i) => ({ ...blankItem(), ...i, note: i.note ?? '' })) })),
        });
      } catch (err) {
        Alpine.store('app').toast(err.message, 'error');
      }
    },

    close() {
      if (!confirmDiscard(this.dirty)) return;
      this.form = null;
      this.selected = null;
      this.dirty = false;
    },

    addSection() {
      this.form.sections.push({ ...blankSection(), title: `Part ${this.form.sections.length + 1}` });
    },
    removeSection(i) {
      if (this.form.sections[i].items.length && !confirm('Remove this section and all its items?')) return;
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
      if (!this.selected || !confirm(`Delete tracker "${this.form.title}"?`)) return;
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

  /* ---------------- RetroAchievements ---------------- */

  Alpine.data('raView', () => ({
    status: null,
    job: null,
    autoStatus: false,
    autoHours: true,
    polling: null,
    candidates: null,
    loadingCandidates: false,
    selection: {},
    importing: false,
    importResult: null,
    consolesBusy: false,

    async init() {
      await this.refresh();
      if (this.job?.running) this.startPolling();
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
        this.job = await api('POST', '/api/ra/sync', { autoStatus: this.autoStatus, autoHours: this.autoHours });
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
      if (!confirm('Discard the manual arrangement and follow the order from your RetroAchievements profile?')) return;
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
      if (!confirm(`Commit all changes with message "${this.message}" and push to ${this.git?.remote || 'origin'}?`)) return;
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
