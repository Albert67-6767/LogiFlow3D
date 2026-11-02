import { colorForStop } from '../../config/constants.js';
import { actions, getDerived, getState, watch } from '../../state/store.js';
import { createScene } from '../../scene/scene3d.js';
import { newId } from '../../core/io.js';
import { lifoIssues } from '../../core/manualLayout.js';
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
    if (dist.status === 'ok') {
        return dist.front > dist.rear ? 'Carga bem posicionada, com mais peso junto à cabine.' : 'Carga equilibrada.';
    }
    const critical = dist.status === 'danger';
    if (dist.axis === 'lateral') {
        const side = dist.left > dist.right ? 'esquerdo' : 'direito';
        return critical ? `Peso concentrado no lado ${side}. Risco de tombamento em curvas.`
            : `Peso maior no lado ${side}. Cuidado nas curvas.`;
    }
    if (dist.front > dist.rear) {
        return 'Quase todo o peso está colado na cabine. Confira se o eixo dianteiro aguenta.';
    }
    return critical
        ? 'Peso concentrado na traseira: a direção fica leve e o eixo traseiro sobrecarrega. Coloque os volumes mais pesados perto da cabine.'
        : 'Peso maior na traseira. O ideal é ter mais peso perto da cabine.';
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
        onMove: (id, pos) => afterMove(id, pos),
        onEditMessage: (text, tone) => toast(text, { tone }),
    });

    watch(s => [s.theme], (s) => scene.setTheme(s.theme));
    watch((s, d) => [d.truck, s.wallsOpaque], (s, d) => scene.setTruck(d.truck, s.wallsOpaque));
    watch((s, d) => [d.packing, d.truck], (s, d) => {
        scene.setBoxes(d.packing.placed, new Map(s.items.map(i => [i.id, i])));
        scene.setCenterOfGravity(d.distribution.cog);
        renderWeightPanel(d.distribution);
        renderLegend(d.stops);
        renderUnplacedAlert(d.packing.unplaced);
    });
    watch((s, d) => [s.items, d.packing, d.truck, s.selectedId], renderItemsList);
    mountLayoutTools();
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
    mountFirstPersonHud(container);
    $('#btn-toggle-items').addEventListener('click', () => openItemsPanel(true));
    $('#btn-close-items').addEventListener('click', () => openItemsPanel(false));
    $('#items-backdrop').addEventListener('click', () => openItemsPanel(false));
}

// ---------- Arrumação manual (cadeado) ----------
const itemLabel = (id) => getState().items.find(i => i.id === id)?.label ?? 'Caixa';

/** Depois de mover: avisa se alguma entrega ficou bloqueada (regra LIFO). */
function afterMove(id, pos) {
    actions.moveBox(id, pos);
    const issue = lifoIssues(getDerived().packing.placed).find(i => i.blocker.id === id || i.blocked.id === id);
    if (issue) {
        toast(`Atenção: "${itemLabel(issue.blocker.id)}" (parada #${issue.blocker.stop}) ficou na frente de "${itemLabel(issue.blocked.id)}" (parada #${issue.blocked.stop}). Na entrega #${issue.blocked.stop} vai precisar tirar ela antes.`, { tone: 'warn', duration: 9000 });
    }
}

function rotateSelected() {
    const id = getState().selectedId;
    if (!id) return toast('Toque numa caixa para selecionar e depois em Girar.', { tone: 'warn' });
    const problem = scene.rotateBox(id);
    if (problem) toast(problem, { tone: 'warn' });
}

function mountLayoutTools() {
    const lockBtn = $('#btn-lock');
    const tools = $('#layout-tools');
    lockBtn.addEventListener('click', () => actions.setLayoutUnlocked(!getState().layoutUnlocked));

    watch((s, d) => [s.layoutUnlocked, d.packing, s.selectedId], (s, d) => {
        const open = s.layoutUnlocked;
        scene.setEditMode(open);
        lockBtn.setAttribute('aria-pressed', String(open));
        render(lockBtn, icon(open ? 'unlock' : 'lock', 'size-3.5'), open ? 'Travar caixas' : 'Destravar caixas');
        lockBtn.classList.toggle('!text-amber-300', open);

        const manual = !!d.packing.manual;
        const issues = manual ? lifoIssues(d.packing.placed).length : 0;
        tools.hidden = !open && !manual;
        if (tools.hidden) return;
        render(tools,
            open
                ? h('p', { class: 'flex items-start gap-1.5 text-amber-300' }, icon('unlock', 'mt-0.5 size-3.5'),
                    'Arraste uma caixa para mover. Ela fica vermelha onde não pode (sem apoio, frágil embaixo, sem altura).')
                : h('p', { class: 'flex items-center gap-1.5 text-slate-300' }, icon('lock', 'size-3.5'), 'Arrumação manual travada.'),
            issues > 0 && h('p', { class: 'flex items-start gap-1.5 text-amber-300' }, icon('warn', 'mt-0.5 size-3.5'),
                `${issues} caixa(s) bloqueando entregas anteriores (fora da ordem LIFO).`),
            h('div', { class: 'flex flex-wrap gap-1.5' },
                open && h('button', { class: 'btn-subtle', disabled: !s.selectedId, onclick: rotateSelected, title: 'Girar a caixa selecionada (tecla R)' },
                    icon('rotate-cw', 'size-3.5'), 'Girar'),
                manual && h('button', { class: 'btn-subtle', onclick: () => {
                    const undo = actions.resetLayout();
                    toast('Voltou para a arrumação automática.', { action: { label: 'Desfazer', run: undo } });
                } }, icon('refresh', 'size-3.5'), 'Arrumação automática'),
                open && h('button', { class: 'btn-subtle !text-emerald-300', onclick: () => actions.setLayoutUnlocked(false) },
                    icon('lock', 'size-3.5'), 'Travar'),
            ),
        );
    });

    // Tecla R gira a caixa selecionada (só com o cadeado aberto e fora de campos de texto).
    window.addEventListener('keydown', (e) => {
        if (!getState().layoutUnlocked || getState().activeTab !== 'packing') return;
        if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rotateSelected(); }
        if (e.key === 'Escape') actions.setLayoutUnlocked(false);
    });
}

// ---------- Primeira pessoa ----------
function mountFirstPersonHud(container) {
    const hud = $('#fp-hud');
    const title = $('#fp-title');
    const touch = window.matchMedia('(pointer: coarse)').matches;
    render($('#fp-help'), touch
        ? 'Controle redondo anda · arraste a tela para olhar · mire numa caixa e toque em Pegar.'
        : h('span', {}, h('b', {}, 'W A S D'), ' anda · ', h('b', {}, 'Shift'), ' corre · ', h('b', {}, 'Espaço'), ' pula · ',
            h('b', {}, 'C'), ' agacha · ', h('b', {}, 'E'), ' pega/devolve caixa · ', h('b', {}, 'arraste'), ' olha · ', h('b', {}, 'Esc'), ' sai'));
    const fp = scene.firstPerson;
    const itemOf = (id) => getState().items.find(i => i.id === id);

    $('#btn-fp').addEventListener('click', () => {
        if (!getDerived().truck) return;
        scene.enterFirstPerson();
    });
    $('#btn-fp-exit').addEventListener('click', () => scene.exitFirstPerson());

    // Mira, caixa na mão e avisos
    const prompt = $('#fp-prompt');
    const crosshair = $('#fp-crosshair');
    const heldCard = $('#fp-held');
    const msg = $('#fp-msg');
    const pickBtn = $('#fp-pick');
    let msgTimer = 0;
    fp.on('target', (t) => {
        const item = t && itemOf(t.id);
        crosshair.classList.toggle('on-target', Boolean(item));
        prompt.hidden = !item;
        if (item) prompt.textContent = touch ? `Pegar: ${item.label}` : `E  ·  pegar ${item.label}`;
    });
    fp.on('held', (hd) => {
        const item = hd && itemOf(hd.id);
        heldCard.hidden = !item;
        render(pickBtn, icon('package', 'size-6'), h('span', {}, item ? 'Devolver' : 'Pegar'));
        pickBtn.setAttribute('aria-pressed', String(Boolean(item)));
        if (!item) return;
        render(heldCard,
            h('p', { class: 'mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400' }, 'Na sua mão'),
            h('p', { class: 'flex items-center gap-2 text-sm font-semibold text-slate-100' },
                h('span', { class: 'size-2.5 shrink-0 rounded-full', style: { background: colorForStop(item.stop) } }), item.label),
            h('p', { class: 'mt-1 font-mono text-slate-400' }, `Parada #${item.stop} · ${dims(item)} · ${int(item.weight)} kg`),
            item.fragile && h('p', { class: 'mt-1 font-semibold text-amber-300' }, 'Frágil: cuidado!'),
            item.weight > 25 && h('p', { class: 'mt-1 text-amber-300' }, `${int(item.weight)} kg: na vida real, use carrinho ou peça ajuda.`),
            item.address && h('p', { class: 'mt-1 truncate text-slate-400' }, item.address),
            h('p', { class: 'mt-2 text-slate-500' }, touch ? 'Toque em Devolver para pôr no lugar.' : 'E devolve ao lugar.'),
        );
    });
    fp.on('message', (text) => {
        clearTimeout(msgTimer);
        msg.hidden = !text;
        if (text) {
            msg.textContent = text;
            msgTimer = setTimeout(() => { msg.hidden = true; }, 2600);
        }
    });

    // Botões de ação (celular): respondem no toque, sem esperar o "clique".
    const press = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
    press($('#fp-jump'), () => fp.jump());
    press(pickBtn, () => fp.pick());
    press($('#fp-crouch'), () => {
        fp.toggleCrouch();
        $('#fp-crouch').setAttribute('aria-pressed', String(fp.isCrouching()));
    });

    fp.on('mode', (mode) => {
        if (mode === 'orbit') delete container.dataset.fp;
        else container.dataset.fp = mode;
        hud.hidden = mode === 'orbit';
        if (mode === 'entering') $('#fp-crouch').setAttribute('aria-pressed', 'false');
        if (mode === 'walking') {
            title.classList.remove('show');
            void title.offsetWidth; // reinicia a animação
            title.classList.add('show');
        }
    });

    // Joystick na tela (celular/tablet).
    const stick = $('#fp-stick');
    const knob = $('#fp-knob');
    let pointer = null;
    const update = (e) => {
        const r = stick.getBoundingClientRect();
        const max = r.width / 2 - 14;
        let dx = e.clientX - (r.left + r.width / 2);
        let dy = e.clientY - (r.top + r.height / 2);
        const len = Math.hypot(dx, dy);
        if (len > max) { dx *= max / len; dy *= max / len; }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        scene.setStick(dx / max, dy / max);
    };
    const release = () => {
        pointer = null;
        knob.style.transform = '';
        scene.setStick(0, 0);
    };
    stick.addEventListener('pointerdown', (e) => {
        pointer = e.pointerId;
        stick.setPointerCapture(e.pointerId);
        update(e);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === pointer) update(e); });
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
}

export { openItemsPanel };
