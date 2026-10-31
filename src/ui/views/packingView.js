import { colorForStop } from '../../config/constants.js';
import { actions, getDerived, getState, watch } from '../../state/store.js';
import { createScene } from '../../scene/scene3d.js';
import { newId } from '../../core/io.js';
import { $, h, render } from '../dom.js';
import { icon } from '../icons.js';
import { dims, int, UNPLACED_REASON } from '../format.js';
import { toast } from '../toast.js';
import { openItemDialog } from './itemDialog.js';

let scene = null;

export const getScene = () => scene;

function openItemsPanel(open) {
    $('#items-panel').dataset.open = String(open);
    $('#items-backdrop').hidden = !open;
    $('#btn-toggle-items').setAttribute('aria-expanded', String(open));
}

// ---------- Tooltip ----------
function showTooltip(id, x, y) {
    const tip = $('#tooltip');
    const item = id && getState().items.find(i => i.id === id);
    if (!item) { tip.hidden = true; return; }
    const p = getDerived().placedById.get(id);
    render(tip,
        h('p', { class: 'font-semibold text-slate-100' }, item.label),
        h('p', { class: 'mt-0.5 font-mono text-slate-400' }, `${dims(item)} · ${int(item.weight)} kg`),
        h('p', { class: 'mt-1 flex flex-wrap gap-1' },
            h('span', { class: 'chip bg-slate-800 text-slate-200' }, `Parada #${item.stop}`),
            item.fragile && h('span', { class: 'chip bg-amber-500/15 text-amber-300' }, 'Frágil'),
            p?.rotated && h('span', { class: 'chip bg-slate-800 text-slate-300' }, 'Girada 90°'),
        ),
        item.address && h('p', { class: 'mt-1 text-slate-400' }, item.address),
    );
    tip.hidden = false;
    const pad = 14;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(x + pad, window.innerWidth - r.width - 8)}px`;
    tip.style.top = `${Math.min(y + pad, window.innerHeight - r.height - 8)}px`;
}

// ---------- Painel de distribuição de peso ----------
const STATUS = {
    ok: { cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', icon: 'ok', title: 'Distribuição adequada' },
    warn: { cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300', icon: 'warn', title: 'Atenção' },
    danger: { cls: 'border-red-500/30 bg-red-500/10 text-red-300', icon: 'danger', title: 'Perigo' },
    empty: { cls: 'border-slate-700 bg-slate-800/50 text-slate-400', icon: 'info', title: 'Baú vazio' },
};

/** Mensagem conforme o eixo mais desequilibrado. */
function balanceMessage(dist) {
    if (dist.status === 'empty') return 'Adicione cargas para ver a distribuição.';
    if (dist.status === 'ok') return 'Carga equilibrada.';
    const critical = dist.status === 'danger';
    if (dist.axis === 'lateral') {
        const side = dist.left > dist.right ? 'esquerdo' : 'direito';
        return critical ? `Peso concentrado no lado ${side}. Risco de tombamento em curvas.`
            : `Peso maior no lado ${side}. Cuidado nas curvas.`;
    }
    const where = dist.front > dist.rear ? 'na frente (eixo dianteiro)' : 'na traseira (eixo traseiro)';
    return critical ? `Peso muito concentrado ${where}. Redistribua para não sobrecarregar o eixo.`
        : `Peso concentrado ${where}.`;
}

function balanceRow(leftLabel, rightLabel, left, right, leftColor, rightColor) {
    return h('div', {},
        h('div', { class: 'mb-1 flex justify-between text-[11px] text-slate-400' },
            h('span', {}, leftLabel),
            h('span', { class: 'font-mono text-slate-200' }, `${left}% / ${right}%`),
            h('span', {}, rightLabel)),
        h('div', { class: 'bar', role: 'meter', 'aria-valuenow': left, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${leftLabel}: ${left}%` },
            h('div', { class: `h-full transition-all ${leftColor}`, style: { width: `${left}%` } }),
            h('div', { class: `h-full transition-all ${rightColor}`, style: { width: `${right}%` } })),
    );
}

function renderWeightPanel(dist) {
    const st = STATUS[dist.status];
    render($('#weight-body'),
        h('div', { class: `mb-3 flex items-start gap-2 rounded-lg border p-2 text-xs ${st.cls}` },
            icon(st.icon, 'mt-px size-4'),
            h('span', {}, h('strong', {}, `${st.title}: `), balanceMessage(dist))),
        h('div', { class: 'space-y-2.5' },
            balanceRow('Frente (cabine)', 'Traseira', dist.front, dist.rear, 'bg-indigo-500', 'bg-emerald-500'),
            balanceRow('Esquerda', 'Direita', dist.left, dist.right, 'bg-blue-500', 'bg-amber-500'),
        ),
        dist.cog && h('p', { class: 'mt-2 flex items-center gap-1.5 text-[10px] text-slate-500' },
            h('span', { class: 'inline-block size-2 rounded-full border border-red-500' }),
            'Esfera vermelha = centro de gravidade'),
    );
}

function renderLegend(stops) {
    const root = $('#stop-legend');
    root.hidden = stops.length === 0;
    if (!stops.length) return;
    render(root,
        h('div', { class: 'flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500' },
            h('span', {}, 'Porta · 1ª parada'), h('span', {}, 'Cabine · última')),
        h('div', { class: 'mt-1.5 flex flex-wrap gap-1' },
            stops.map(s => h('span', {
                class: 'chip bg-slate-800 text-slate-200',
                title: s.address || `Parada ${s.stop}`,
            }, h('span', { class: 'size-2 rounded-full', style: { backgroundColor: colorForStop(s.stop) } }), `#${s.stop}`))),
    );
}

function renderUnplacedAlert(unplaced) {
    const root = $('#unplaced-alert');
    root.hidden = unplaced.length === 0;
    if (!unplaced.length) return;
    render(root, h('button', {
        class: 'overlay flex w-full items-center gap-2 border-red-500/40 px-3 py-2 text-left text-xs text-red-300 hover:bg-slate-800',
        onclick: () => openItemsPanel(true),
    },
        icon('package-x', 'size-4'),
        h('span', {}, h('strong', {}, `${unplaced.length} ${unplaced.length === 1 ? 'item não coube' : 'itens não couberam'}`),
            ' no baú. Veja a lista.'),
    ));
}

// ---------- Lista de itens ----------
function itemCard(item, state, derived) {
    const reason = derived.unplacedById.get(item.id);
    const placed = derived.placedById.get(item.id);
    const selected = state.selectedId === item.id;

    const remove = (e) => {
        e.stopPropagation();
        const undo = actions.removeItem(item.id);
        toast(`"${item.label}" removido.`, { action: undo && { label: 'Desfazer', run: undo } });
    };
    const duplicate = (e) => {
        e.stopPropagation();
        actions.addItems([{ ...item, id: newId() }]);
    };
    const edit = (e) => {
        e.stopPropagation();
        openItemDialog({ item });
    };

    return h('li', {
        class: `group rounded-xl border p-3 text-xs transition data-hover:border-emerald-400/50 data-hover:bg-slate-800 ${selected
            ? 'border-emerald-400/70 bg-slate-800 ring-1 ring-emerald-400/40'
            : reason ? 'border-red-500/40 bg-red-500/5 hover:bg-slate-800' : 'border-slate-700/60 bg-slate-800/50 hover:border-slate-600 hover:bg-slate-800'}`,
        dataset: { id: item.id },
        onmouseenter: () => scene?.setHovered(item.id),
        onmouseleave: () => scene?.setHovered(null),
    },
        h('button', {
            class: 'flex w-full min-w-0 items-start gap-3 text-left focus-visible:outline-none',
            'aria-pressed': String(selected),
            onclick: () => actions.select(selected ? null : item.id),
        },
            h('span', { class: 'mt-1 size-3 shrink-0 rounded-full', style: { backgroundColor: colorForStop(item.stop) } }),
            h('span', { class: 'min-w-0 flex-1' },
                h('span', { class: 'block truncate font-semibold text-slate-200', title: item.label }, item.label),
                h('span', { class: 'block truncate font-mono text-[11px] text-slate-400' }, `${dims(item)} · ${int(item.weight)} kg`),
            ),
        ),
        h('div', { class: 'mt-2 flex items-center gap-1 pl-6' },
            h('span', { class: 'flex min-w-0 flex-1 flex-wrap gap-1' },
                h('span', { class: 'chip bg-slate-900 text-emerald-400' }, `Parada #${item.stop}`),
                item.fragile && h('span', { class: 'chip bg-amber-500/15 text-amber-300' }, 'Frágil'),
                placed?.rotated && h('span', { class: 'chip bg-slate-900 text-slate-400' }, 'Girada'),
                reason && h('span', { class: 'chip bg-red-500/15 text-red-300' }, UNPLACED_REASON[reason]),
            ),
            h('span', { class: 'flex shrink-0 gap-0.5 transition xl:opacity-0 xl:group-focus-within:opacity-100 xl:group-hover:opacity-100 xl:group-data-hover:opacity-100' },
                h('button', { class: 'icon-btn', title: 'Editar', 'aria-label': `Editar ${item.label}`, onclick: edit }, icon('pencil', 'size-3.5')),
                h('button', { class: 'icon-btn', title: 'Duplicar', 'aria-label': `Duplicar ${item.label}`, onclick: duplicate }, icon('copy', 'size-3.5')),
                h('button', { class: 'icon-btn hover:text-red-400', title: 'Remover', 'aria-label': `Remover ${item.label}`, onclick: remove }, icon('trash', 'size-3.5')),
            ),
        ),
    );
}

function renderItemsList(state, derived) {
    $('#items-count').textContent = state.items.length;
    $('#items-count-badge').textContent = `(${state.items.length})`;
    const root = $('#items-list');

    if (!state.items.length) {
        render(root, h('div', { class: 'flex flex-col items-center gap-3 px-4 py-12 text-center text-sm text-slate-400' },
            icon('package', 'size-8 text-slate-600'),
            h('p', {}, 'Nenhuma carga cadastrada.'),
            h('button', { class: 'btn-primary', onclick: () => openItemDialog() }, icon('plus'), 'Adicionar carga'),
        ));
        return;
    }

    const sorted = [...state.items].sort((a, b) => a.stop - b.stop || a.label.localeCompare(b.label));
    const unplaced = sorted.filter(i => derived.unplacedById.has(i.id));
    const placed = sorted.filter(i => !derived.unplacedById.has(i.id));

    render(root,
        unplaced.length > 0 && h('section', { class: 'space-y-2' },
            h('h3', { class: 'flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-red-400' },
                icon('package-x', 'size-3.5'), `Fora do baú (${unplaced.length})`),
            h('ul', { class: 'space-y-2' }, unplaced.map(i => itemCard(i, state, derived))),
        ),
        h('section', { class: 'space-y-2' },
            unplaced.length > 0 && h('h3', { class: 'px-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500' }, `No baú (${placed.length})`),
            h('ul', { class: 'space-y-2' }, placed.map(i => itemCard(i, state, derived))),
        ),
    );
}

// ---------- Montagem ----------
export function mountPackingView() {
    const container = $('#canvas-container');
    scene = createScene(container, {
        onHover: (id, x, y) => {
            showTooltip(id, x, y);
            document.querySelectorAll('#items-list li[data-hover]').forEach(el => delete el.dataset.hover);
            if (id) document.querySelector(`#items-list li[data-id="${CSS.escape(id)}"]`)?.setAttribute('data-hover', '');
        },
        onSelect: (id) => actions.select(id),
    });

    watch(s => [s.theme], (s) => scene.setTheme(s.theme));
    watch((s, d) => [d.truck, s.wallsOpaque], (s, d) => scene.setTruck(d.truck, s.wallsOpaque));
    watch((s, d) => [s.items, d.truck], (s, d) => {
        scene.setBoxes(d.packing.placed, new Map(s.items.map(i => [i.id, i])));
        scene.setCenterOfGravity(d.distribution.cog);
        renderWeightPanel(d.distribution);
        renderLegend(d.stops);
        renderUnplacedAlert(d.packing.unplaced);
    });
    watch((s, d) => [s.items, d.truck, s.selectedId], renderItemsList);
    watch(s => [s.selectedId], (s) => {
        scene.setSelected(s.selectedId);
        if (s.selectedId) {
            document.querySelector(`#items-list li[data-id="${CSS.escape(s.selectedId)}"]`)
                ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    });
    watch(s => [s.activeTab], (s) => scene.setActive(s.activeTab === 'packing'));

    // Barra de ferramentas
    const wallsBtn = $('#btn-toggle-walls');
    wallsBtn.addEventListener('click', actions.toggleWalls);
    watch(s => [s.wallsOpaque], (s) => {
        wallsBtn.setAttribute('aria-pressed', String(s.wallsOpaque));
        render(wallsBtn, icon(s.wallsOpaque ? 'eye-off' : 'eye', 'size-3.5'),
            h('span', { class: 'hidden sm:inline' }, s.wallsOpaque ? 'Paredes opacas' : 'Paredes transparentes'));
    });
    $('#btn-reset-cam').addEventListener('click', () => scene.fitCamera());
    $('#btn-toggle-items').addEventListener('click', () => openItemsPanel(true));
    $('#btn-close-items').addEventListener('click', () => openItemsPanel(false));
    $('#items-backdrop').addEventListener('click', () => openItemsPanel(false));
}

export { openItemsPanel };
