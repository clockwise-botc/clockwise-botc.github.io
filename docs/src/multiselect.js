// Searchable multi-select dropdown with checkboxes.
//
//   [ Players        ⌄ ]   closed: the label, or the selection ("delphine", "delphine +2")
//   [ Search…        ⌕ ]   open: type to filter, then
//     ☐ Selected (2)        show only what's picked
//     ☑ All                 ticked when nothing is picked (no filter); click to clear
//     ☑ delphine            click / Enter to toggle; the list stays open for more
//     ☐ wren
//
// cfg: { label, options: () => [{ value, label, sub }], selected: () => [values], onChange: (values) => void, nameOf: (value) => text,
//        single }  single: pick one; no checkboxes or Selected/All rows, and the list closes on a pick.
import { esc } from './ui.js?v=1ce00c94af';

const CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SEARCH = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

export function multiSelect(root, cfg) {
  root.classList.add('ms');
  root.innerHTML = `<div class="ms-field">
      <input type="text" autocomplete="off" spellcheck="false" aria-label="${esc(cfg.label)}" aria-haspopup="listbox" aria-expanded="false">
      <button type="button" class="ms-icon" tabindex="-1" aria-label="Open ${esc(cfg.label)}"></button>
    </div>
    <div class="ms-panel" hidden><ul role="listbox" aria-multiselectable="${!cfg.single}" aria-label="${esc(cfg.label)}"></ul></div>`;
  const input = root.querySelector('input');
  const icon = root.querySelector('.ms-icon');
  const panel = root.querySelector('.ms-panel');
  const list = root.querySelector('ul');
  let open = false, query = '', onlySelected = false, active = 0, items = [];

  const summary = () => {
    const s = cfg.selected();
    if (!s.length) return cfg.label;
    const first = cfg.nameOf(s[0]);
    return s.length === 1 ? first : `${first} +${s.length - 1}`;
  };

  function draw() {
    const s = cfg.selected();
    root.classList.toggle('has-value', s.length > 0);
    root.classList.toggle('open', open);
    input.setAttribute('aria-expanded', String(open));
    input.placeholder = open ? 'Search…' : summary();
    icon.innerHTML = open ? SEARCH : CHEVRON;
    root.title = s.length > 1 ? s.map(cfg.nameOf).join(', ') : '';
    if (!open) { input.value = ''; query = ''; }
    panel.hidden = !open;
    if (!open) return;
    // Open toward the left when there isn't room for the list on the right.
    root.classList.toggle('align-right', root.getBoundingClientRect().left + Math.max(root.offsetWidth, 270) + 16 > document.documentElement.clientWidth);
    let opts = cfg.options();
    if (onlySelected) opts = opts.filter((o) => s.includes(o.value));
    if (query) opts = opts.filter((o) => o.label.toLowerCase().includes(query));
    const meta = cfg.single ? [] : [
      { act: 'only', label: `Selected (${s.length})`, on: onlySelected },
      { act: 'all', label: 'All', on: s.length === 0 },
    ];
    items = [...meta, ...opts.slice(0, 300).map((o) => ({ value: o.value, label: o.label, sub: o.sub, on: s.includes(o.value) }))];
    active = Math.max(0, Math.min(active, items.length - 1));
    list.innerHTML = items.map((it, i) => `<li role="option" aria-selected="${it.on}" data-i="${i}" class="${i === active ? 'active' : ''}${it.act ? ' ms-meta' : ''}${it.act === 'all' ? ' ms-sep' : ''}">
        ${cfg.single ? '' : '<span class="cb" aria-hidden="true"></span>'}<span class="ms-label">${esc(it.label)}</span>${it.sub ? `<span class="ms-sub">${esc(it.sub)}</span>` : ''}</li>`).join('')
      + (items.length === meta.length ? '<li class="ms-empty">No matches</li>' : '');
  }

  function choose(i) {
    const it = items[i];
    if (!it) return;
    active = i;
    if (it.act === 'only') { onlySelected = !onlySelected; draw(); return; }
    if (it.act === 'all') { cfg.onChange([]); return; }
    if (cfg.single) { cfg.onChange([it.value]); setOpen(false); input.blur(); return; }
    const s = cfg.selected();
    cfg.onChange(s.includes(it.value) ? s.filter((v) => v !== it.value) : [...s, it.value]);
  }

  function setOpen(v) {
    if (open === v) return;
    open = v;
    if (open) { active = cfg.single ? 0 : 2; onlySelected = false; }
    draw();
  }

  input.addEventListener('focus', () => setOpen(true));
  input.addEventListener('click', () => setOpen(true));
  input.addEventListener('input', () => { query = input.value.trim().toLowerCase(); active = cfg.single ? 0 : 2; draw(); });
  icon.addEventListener('click', () => { if (open) setOpen(false); else input.focus(); });
  // Keep focus in the search box while clicking options, so the list stays open.
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) choose(Number(li.dataset.i)); });
  input.addEventListener('keydown', (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); e.preventDefault(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      list.querySelectorAll('li[data-i]').forEach((li) => li.classList.toggle('active', Number(li.dataset.i) === active));
      const cur = list.querySelector('li.active');
      cur && cur.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      setOpen(false);
      if (e.key === 'Escape') input.blur();
    }
  });
  document.addEventListener('mousedown', (e) => { if (open && !root.contains(e.target)) setOpen(false); });
  window.addEventListener('resize', () => { if (open) draw(); });

  draw();
  return { refresh: draw, close: () => setOpen(false) };
}
