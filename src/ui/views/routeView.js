import { PRIORITIES, RISK_LEVELS, ROAD_BLOCK, colorForStop } from '../../config/constants.js';
import { actions, getDerived, getState, setState, watch } from '../../state/store.js';
import { addressKey, suggestOrder } from '../../core/geo.js';
import { QUALITY_LABELS } from '../../core/routing.js';
import { blocksFor, blocksVersion } from '../../core/roadBlocks.js';
import { toNumber } from '../../core/validation.js';
import { planRoute, areasVersion } from '../../services/planner.js';
import { $, h, render } from '../dom.js';
import { icon } from '../icons.js';
import { num, int, money, duration, UNPLACED_REASON } from '../format.js';
import { toast } from '../toast.js';
import { keepFocus } from './keepFocus.js';
import { createRouteMap } from './routeMap.js';
import { openAreaDialog, mountAreaDialog } from './areaDialog.js';
import { openBlockDialog } from './blockDialog.js';
import { startNavigation } from './navigationView.js';

let map = null;
let pickMode = null; // { type: 'depot' | 'stop' | 'area' | 'block', address?, label }
const openLegs = new Set(); // trechos com a lista de caminhos aberta

const QUALITY_COLORS = { good: 'bg-emerald-500', fair: 'bg-amber-500', bad: 'bg-red-500', unknown: 'bg-slate-600' };

// ---------- Marcar ponto no mapa ----------

function setPick(mode) {
    pickMode = mode;
    map.setPicking(!!mode);
    const banner = $('#map-pick-banner');
    banner.hidden = !mode;
    if (mode) {
        render(banner, icon('crosshair', 'size-4 text-emerald-400'), h('span', {}, mode.label),
            h('button', { class: 'btn-ghost px-2 py-1 text-xs', onclick: () => setPick(null) }, 'Cancelar'));
        // No celular o mapa fica em cima: rola até ele.
        $('#route-map').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function handlePick(p) {
    const mode = pickMode;
    setPick(null);
    if (!mode) return;
    if (mode.type === 'depot') {
        actions.setDepot({ lat: p.lat, lon: p.lon, label: 'Marcado no mapa' });
        toast('Base marcada no mapa.', { tone: 'ok' });
    } else if (mode.type === 'stop') {
        actions.setGeo(mode.address, { lat: p.lat, lon: p.lon, label: 'Marcado no mapa', bairro: '', manual: true });
        toast(`Parada #${mode.stop} marcada no mapa.`, { tone: 'ok' });
    } else if (mode.type === 'area') {
        openAreaDialog({ at: p });
    } else if (mode.type === 'block') {
        openBlockDialog({ at: p, scope: getDerived().profile === 'truck' ? 'truck' : 'all' });
    }
}

// ---------- Ações ----------

async function calculate({ quiet = false } = {}) {
    const s = getState();
    if (!s.depot?.address && !Number.isFinite(s.depot?.lat)) {
        toast('Informe o endereço da base de saída (ou marque no mapa).', { tone: 'warn' });
        $('#depot-address')?.focus();
        return;
    }
    if (!getDerived().stops.length) return toast('Adicione cargas para montar a rota.', { tone: 'warn' });
    try {
        const r = await planRoute();
        if (!quiet || !r.ok) toast(r.message || 'Rota calculada com a melhor combinação de distância, piso e segurança.', { tone: r.ok ? 'ok' : 'warn', duration: 7000 });
        map.fit();
    } catch (err) {
        toast(err.message || 'Não foi possível calcular a rota.', { tone: 'danger', duration: 8000 });
    }
}

/** Abre a navegação; se faltar algo (rota antiga sem instruções de curva), recalcula antes. */
async function start() {
    const ready = () => {
        const ev = getDerived().routeEval;
        return ev.status === 'ok' && ev.legs.every(l => l.alternatives[l.chosen].maneuvers);
    };
    if (!ready()) {
        toast('Preparando as instruções de navegação…');
        await calculate({ quiet: true });
    }
    if (!ready() || !startNavigation()) toast('Não foi possível iniciar: calcule a rota de todas as paradas.', { tone: 'warn' });
}

function suggest() {
    const d = getDerived();
    if (!d.depotPoint || d.stops.some(st => !st.point)) {
        return toast('Localize a base e todas as paradas antes (botão "Calcular melhor rota").', { tone: 'warn' });
    }
    const order = suggestOrder(d.depotPoint, d.stops.map(st => st.point));
    if (order.every((v, i) => v === i)) return toast('A ordem atual já é a mais próxima.', { tone: 'ok' });

    const labels = order.map(i => `#${d.stops[i].stop}`).join(' → ');
    if (!confirm(`Ordem sugerida por proximidade: ${labels}\n\nAs paradas serão renumeradas e o baú rearrumado (LIFO). Continuar?`)) return;
    const prev = { items: getState().items, stopKm: getState().stopKm };
    actions.reorderStops(order.map(i => d.stops[i].stop));
    toast('Paradas reordenadas. Calcule a rota novamente.', {
        tone: 'ok', duration: 8000, action: { label: 'Desfazer', run: () => setState(prev) },
    });
}

// ---------- Blocos da tela ----------

function qualityBar(q, cls = 'h-1.5') {
    const total = q.good + q.fair + q.bad + q.unknown;
    if (total <= 0) return null;
    return h('div', { class: `bar ${cls}`, title: Object.keys(QUALITY_LABELS).map(k => `${QUALITY_LABELS[k]}: ${num(q[k])} km`).join(' · ') },
        ...['good', 'fair', 'bad', 'unknown'].map(k => q[k] > 0 && h('div', { class: QUALITY_COLORS[k], style: { width: `${(q[k] / total) * 100}%` } })));
}

const qualityLegend = (q) => h('p', { class: 'mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400' },
    ...['good', 'fair', 'bad', 'unknown'].filter(k => q[k] > 0.005).map(k =>
        h('span', { class: 'flex items-center gap-1' }, h('span', { class: `size-2 rounded-sm ${QUALITY_COLORS[k]}` }), `${QUALITY_LABELS[k]} ${num(q[k])} km`)));

function controls(s, d) {
    const status = s.routeStatus;
    const ev = d.routeEval;
    const priority = s.settings.routePriority ?? 'equilibrada';
    const depotOk = !!d.depotPoint;
    const outdatedAreas = s.routePlan?.legs?.some(l => l.alternatives?.length && l.areasVersion !== areasVersion(s.riskAreas));
    const blocksV = blocksVersion(blocksFor(s.roadBlocks, d.profile));
    const outdatedBlocks = s.routePlan?.legs?.some(l => l.alternatives?.length && (l.blocksVersion ?? '') !== blocksV);

    return h('div', { class: 'card space-y-3 p-4' },
        h('div', {},
            h('label', { for: 'depot-address', class: 'label' }, 'Base de saída'),
            h('div', { class: 'flex gap-1.5' },
                h('input', {
                    id: 'depot-address', class: 'input', maxlength: 160, autocomplete: 'off',
                    placeholder: 'Endereço do depósito / CD', value: s.depot?.address ?? '',
                    onchange: (e) => actions.setDepot({ address: e.target.value.trim(), lat: null, lon: null, label: '' }),
                }),
                h('button', {
                    class: 'btn-subtle shrink-0', title: 'Marcar a base no mapa', 'aria-label': 'Marcar a base no mapa',
                    onclick: () => setPick({ type: 'depot', label: 'Toque no mapa onde fica a base' }),
                }, icon('crosshair', 'size-4')),
            ),
            h('p', { class: `mt-1 flex items-center gap-1 text-[11px] ${depotOk ? 'text-emerald-400' : 'text-slate-500'}` },
                icon(depotOk ? 'map-pin' : 'info', 'size-3'),
                depotOk ? (s.depot.bairro ? `Localizada · ${s.depot.bairro}` : 'Localizada') : 'Será localizada ao calcular a rota'),
        ),

        h('div', {},
            h('p', { class: 'label' }, 'Prioridade do trajeto'),
            h('div', { class: 'grid grid-cols-3 gap-1 rounded-lg border border-slate-800 bg-slate-950 p-1', role: 'group' },
                Object.entries(PRIORITIES).map(([key, p]) => h('button', {
                    class: 'seg-btn justify-center px-1', 'aria-pressed': String(key === priority),
                    onclick: () => actions.updateSettings({ routePriority: key }),
                }, key === 'segura' && icon('shield', 'size-3.5'), p.label))),
            h('p', { class: 'mt-1 text-[11px] text-slate-500' }, PRIORITIES[priority].hint),
        ),

        h('div', { class: 'flex items-center justify-between gap-3' },
            h('label', { for: 'unload-min', class: 'text-xs text-slate-400' }, 'Tempo de descarga por parada'),
            h('div', { class: 'flex items-center gap-1.5' },
                h('input', {
                    id: 'unload-min', class: 'input w-20 py-1 text-right font-mono', type: 'number', min: 0, max: 240, step: 5,
                    value: String(s.settings.unloadMin ?? 15),
                    onchange: (e) => actions.updateSettings({ unloadMin: Math.min(240, Math.max(0, Math.round(Number(e.target.value) || 0))) }),
                }),
                h('span', { class: 'text-xs text-slate-500' }, 'min')),
        ),

        // Rota pronta: o botão principal vira "Iniciar rota" (navegação curva a curva).
        ev.status === 'ok' && !status.busy && h('button', { class: 'btn-primary w-full py-3 text-base', onclick: start },
            icon('navigation', 'size-5'), 'Iniciar rota'),
        h('div', { class: 'flex flex-wrap gap-2' },
            h('button', { class: ev.status === 'ok' && !status.busy ? 'btn-subtle flex-1 justify-center' : 'btn-primary flex-1', disabled: status.busy, onclick: calculate },
                icon(status.busy ? 'loader' : ev.status === 'ok' ? 'refresh' : 'route', `size-4 ${status.busy ? 'animate-spin' : ''}`),
                status.busy ? (status.message || 'Calculando…') : ev.status === 'ok' ? 'Recalcular' : 'Calcular melhor rota'),
            h('button', { class: 'btn-subtle', disabled: status.busy || d.stops.length < 2, onclick: suggest, title: 'Reordena as paradas pela proximidade (linha reta)' },
                icon('reorder', 'size-3.5'), 'Sugerir ordem'),
        ),

        ev.status === 'partial' && !status.busy && h('p', { class: 'flex items-center gap-1.5 text-xs text-amber-300' },
            icon('warn', 'size-3.5'), 'Algumas paradas mudaram desde o último cálculo. Clique em Recalcular.'),
        outdatedAreas && !status.busy && h('p', { class: 'flex items-center gap-1.5 text-xs text-amber-300' },
            icon('shield', 'size-3.5'), 'Áreas de atenção mudaram. Recalcule para procurar desvios.'),
        outdatedBlocks && !status.busy && h('p', { class: 'flex items-center gap-1.5 text-xs text-amber-300' },
            icon('ban', 'size-3.5'), 'Há observações novas de ruas sem passagem. Recalcule para desviar delas.'),
    );
}

function summary(s, d) {
    const { route, routeEval: ev, stops } = d;
    if (!stops.length) return null;
    const t = ev.totals;
    const calculated = ev.status === 'ok' || ev.status === 'partial';
    return h('div', { class: 'card space-y-3 p-4' },
        h('div', { class: 'grid grid-cols-2 gap-3 sm:grid-cols-4' },
            [
                ['Distância', `${num(route.km)} km`],
                ['Tempo (c/ descargas)', route.min ? duration(route.min + stops.length * (s.settings.unloadMin ?? 0)) : '—'],
                ['Combustível', `${num(route.liters)} L`],
                ['Custo', money(route.cost)],
            ].map(([label, value]) => h('div', {},
                h('p', { class: 'text-[11px] text-slate-400' }, label),
                h('p', { class: 'font-mono text-base font-bold text-slate-100' }, value)))),
        calculated && h('div', {},
            h('p', { class: 'mb-1 text-[11px] font-medium text-slate-400' }, 'Qualidade do piso'),
            qualityBar(t, 'h-2'), qualityLegend(t)),
        calculated && (t.areas.length
            ? h('p', { class: 'flex items-start gap-1.5 text-xs text-amber-300' }, icon('shield', 'mt-0.5 size-3.5'),
                `${num(t.riskKm)} km em áreas de atenção: ${t.areas.join(', ')}.`)
            : s.riskAreas.length > 0 && h('p', { class: 'flex items-center gap-1.5 text-xs text-emerald-400' }, icon('ok', 'size-3.5'),
                'A rota não passa por nenhuma área de atenção.')),
        calculated && truckNote(ev),
        !calculated && route.missingKm > 0 && h('p', { class: 'flex items-center gap-2 text-xs text-slate-400' },
            icon('info', 'size-3.5'), 'Calcule a rota para obter distâncias reais ou digite os km de cada trecho.'),
        deliverySummary(s, d),
    );
}

/** Como a rota tratou as restrições de caminhão. */
function truckNote(ev) {
    const t = ev.totals;
    if (!ev.heavy) {
        return h('p', { class: 'flex items-start gap-1.5 text-[11px] text-slate-500' }, icon('info', 'mt-0.5 size-3.5'),
            'Veículo leve: rota calculada como carro (sem restrições de caminhão).');
    }
    if (t.carOnly) {
        return h('p', { class: 'flex items-start gap-1.5 text-xs text-red-300' }, icon('warn', 'mt-0.5 size-3.5'),
            `${t.carOnly} trecho(s) sem caminho liberado para caminhão: usando o caminho de carro. Confira proibições e limites de altura/peso.`);
    }
    return h('p', { class: `flex items-start gap-1.5 text-xs ${t.narrowKm > 0.03 ? 'text-amber-300' : 'text-emerald-400'}` },
        icon(t.narrowKm > 0.03 ? 'warn' : 'ok', 'mt-0.5 size-3.5'),
        'Rota para caminhão: evita ruas com proibição de caminhão e limite de altura, largura ou peso menor que o veículo',
        t.narrowKm > 0.03 ? `. Ainda passa por ${num(t.narrowKm)} km de ruas estreitas (em roxo no mapa).` : '.');
}

function locationChip(st, s) {
    if (!st.address) return h('span', { class: 'chip bg-amber-500/15 text-amber-300' }, 'Sem endereço');
    const g = s.geo[addressKey(st.address)];
    if (st.point) {
        return h('span', { class: 'chip bg-emerald-500/10 text-emerald-400' },
            st.point.manual ? 'Marcado no mapa' : st.point.bairro || 'Localizado');
    }
    if (g?.notFound) return h('span', { class: 'chip bg-red-500/15 text-red-300' }, 'Não encontrado');
    return h('span', { class: 'chip bg-slate-800 text-slate-400' }, 'A localizar');
}

function altRow(leg, alt) {
    const chosen = alt.index === leg.chosen;
    const tags = [
        alt.index === leg.best && 'melhor nota',
        alt.index === leg.shortest && 'mais curto',
        alt.detour && 'desvio',
        leg.heavy && !alt.carOnly && 'liberado p/ caminhão',
    ].filter(Boolean);
    return h('li', { class: `flex items-center gap-2 rounded-lg border p-2 text-xs ${chosen ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-800'}` },
        h('div', { class: 'min-w-0 flex-1' },
            h('p', { class: 'font-medium text-slate-200' }, `Caminho ${alt.index + 1}`,
                tags.length > 0 && h('span', { class: 'ml-1.5 font-normal text-slate-500' }, `(${tags.join(', ')})`)),
            h('p', { class: 'mt-0.5 font-mono text-[11px] text-slate-400' },
                `${num(alt.km)} km · ${duration(alt.min)}`,
                alt.surface.bad > 0.05 && ` · ${num(alt.surface.bad)} km sem asfalto`,
                alt.risk.km > 0.02 && ` · ${num(alt.risk.km)} km em áreas`,
                leg.heavy && alt.narrowKm > 0.03 && ` · ${num(alt.narrowKm)} km em ruas estreitas`,
                leg.heavy && alt.carOnly && ' · caminho de carro'),
            alt.streets?.length > 0 && h('p', { class: 'truncate text-[11px] text-slate-500' }, `Via ${alt.streets.join(', ')}`),
            qualityBar(alt.surface, 'mt-1 h-1'),
        ),
        chosen
            ? h('span', { class: 'chip bg-emerald-500/15 text-emerald-400' }, 'Em uso')
            : h('button', { class: 'btn-subtle', onclick: () => actions.chooseAlternative(leg.key, alt.index) }, 'Usar'),
    );
}

function legBlock(leg, i, st) {
    if (leg?.error) {
        return h('p', { class: 'mt-3 flex items-center gap-1.5 text-xs text-red-300' }, icon('warn', 'size-3.5'), `Sem caminho para este trecho: ${leg.error}`);
    }
    if (!leg?.alternatives) {
        const inputId = `km-${st.stop}`;
        return h('div', { class: 'mt-3 flex items-center justify-end gap-2' },
            h('label', { for: inputId, class: 'text-[11px] text-slate-400' }, i === 0 ? 'km desde a base' : 'km desde a anterior'),
            h('input', {
                id: inputId, class: 'input w-24 py-1 text-right font-mono', inputmode: 'decimal',
                value: st.km ? String(st.km).replace('.', ',') : '', placeholder: '0,0',
                onchange: (e) => {
                    const km = toNumber(e.target.value);
                    actions.setStopKm(st.stop, Number.isFinite(km) && km >= 0 ? km : 0);
                },
            }));
    }
    const alt = leg.alternatives[leg.chosen];
    const many = leg.alternatives.length > 1;
    return h('div', { class: 'mt-3 space-y-1.5 border-t border-slate-800 pt-3' },
        h('div', { class: 'flex items-center gap-2 text-xs' },
            icon('route', 'size-3.5 text-slate-500'),
            h('span', { class: 'font-mono font-semibold text-slate-200' }, `${num(alt.km)} km`),
            h('span', { class: 'font-mono text-slate-400' }, duration(alt.min)),
            h('span', { class: 'text-slate-500' }, i === 0 ? 'desde a base' : 'desde a anterior'),
            leg.manual && h('span', { class: 'chip ml-auto bg-blue-500/10 text-blue-400' }, 'Escolha manual'),
        ),
        qualityBar(alt.surface),
        leg.notes.length > 0 && h('ul', { class: 'space-y-0.5 text-[11px] text-slate-400' }, leg.notes.map(n => h('li', {}, n))),
        many && h('details', {
            class: 'group', open: openLegs.has(leg.key),
            ontoggle: (e) => { if (e.target.open) openLegs.add(leg.key); else openLegs.delete(leg.key); },
        },
            h('summary', { class: 'flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-emerald-400' },
                icon('chevron-down', 'size-3.5 transition group-open:rotate-180'), `Ver ${leg.alternatives.length} caminhos`),
            h('ul', { class: 'mt-2 space-y-1.5' }, leg.alternatives.map(a => altRow(leg, a))),
            leg.manual && h('button', { class: 'mt-1.5 text-[11px] text-slate-400 underline', onclick: () => actions.chooseAlternative(leg.key, null) },
                'Voltar à escolha automática'),
        ),
    );
}

function stopCard(st, i, s, d) {
    const color = colorForStop(st.stop);
    const unplaced = st.items.filter(it => d.unplacedById.has(it.id));
    const g = st.address && s.geo[addressKey(st.address)];
    return h('li', { class: 'card p-3' },
        h('div', { class: 'flex items-start gap-3' },
            h('div', {
                class: 'flex size-9 shrink-0 items-center justify-center rounded-lg border font-mono text-sm font-bold',
                style: { color, borderColor: `${color}55`, backgroundColor: `${color}1a` },
            }, `#${st.stop}`),
            h('div', { class: 'min-w-0 flex-1' },
                h('p', { class: 'text-sm font-semibold text-slate-200' },
                    st.address || h('span', { class: 'italic text-slate-500' }, 'Endereço não informado')),
                h('div', { class: 'mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400' },
                    locationChip(st, s),
                    h('span', {}, `${st.items.length} ${st.items.length === 1 ? 'item' : 'itens'} · ${int(st.weight)} kg`),
                    unplaced.length > 0 && h('span', { class: 'chip bg-red-500/15 text-red-300', title: unplaced.map(u => `${u.label}: ${UNPLACED_REASON[d.unplacedById.get(u.id)]}`).join('\n') },
                        `${unplaced.length} fora do baú`),
                ),
            ),
            st.address && h('button', {
                class: `icon-btn ${g?.notFound ? 'text-amber-300' : ''}`,
                title: 'Marcar/ajustar no mapa', 'aria-label': `Marcar parada ${st.stop} no mapa`,
                onclick: () => setPick({ type: 'stop', address: st.address, stop: st.stop, label: `Toque no mapa onde fica a parada #${st.stop}` }),
            }, icon('crosshair', 'size-4')),
        ),
        legBlock(d.routeEval.legs[i], i, st),
        deliveryBlock(st, s),
    );
}

const hour = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Resultado da entrega registrado na navegação (feita ou pendente com motivo). */
function deliveryBlock(st, s) {
    const dl = s.deliveries?.[st.stop];
    if (!dl) return null;
    if (dl.status === 'done') {
        return h('div', { class: 'mt-3 flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400' },
            icon('ok', 'size-4'), h('span', { class: 'flex-1 font-medium' }, `Entregue às ${hour(dl.at)}`),
            h('button', { class: 'text-slate-400 underline', onclick: () => actions.clearDelivery(st.stop) }, 'Desfazer'));
    }
    return h('div', { class: 'mt-3 space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs' },
        h('p', { class: 'flex items-center gap-2 font-semibold text-amber-300' }, icon('warn', 'size-4'),
            `Pendente: ${dl.reason}`, h('span', { class: 'ml-auto font-normal text-slate-400' }, hour(dl.at))),
        dl.note && h('p', { class: 'text-slate-300' }, dl.note),
        h('div', { class: 'flex flex-wrap gap-1.5' },
            h('button', { class: 'btn-subtle', onclick: () => actions.setDelivery(st.stop, { status: 'done' }) }, icon('ok', 'size-3.5'), 'Marcar como entregue'),
            h('button', { class: 'btn-subtle', onclick: () => actions.clearDelivery(st.stop) }, icon('refresh', 'size-3.5'), 'Tentar de novo')),
    );
}

/** Resumo da viagem: entregues × pendentes. */
function deliverySummary(s, d) {
    const list = d.stops.map(st => s.deliveries?.[st.stop]).filter(Boolean);
    if (!list.length) return null;
    const done = list.filter(x => x.status === 'done').length;
    const pending = list.filter(x => x.status === 'pending').length;
    const left = d.stops.length - done - pending;
    return h('div', { class: 'flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3 text-xs' },
        h('span', { class: 'chip bg-emerald-500/10 text-emerald-400' }, `${done} entregue${done === 1 ? '' : 's'}`),
        pending > 0 && h('span', { class: 'chip bg-amber-500/15 text-amber-300' }, `${pending} pendente${pending === 1 ? '' : 's'}`),
        left > 0 && h('span', { class: 'chip bg-slate-800 text-slate-400' }, `${left} a fazer`),
        h('button', {
            class: 'ml-auto text-slate-400 underline',
            onclick: () => { if (confirm('Limpar o status de todas as entregas desta viagem?')) actions.clearDeliveries(); },
        }, 'Limpar status'),
    );
}

function areasCard(s) {
    return h('div', { class: 'card space-y-2 p-4' },
        h('div', { class: 'flex items-center justify-between gap-2' },
            h('h3', { class: 'flex items-center gap-1.5 text-sm font-semibold text-slate-200' }, icon('shield', 'size-4 text-amber-400'), 'Áreas de atenção'),
            h('button', { class: 'btn-subtle', onclick: () => setPick({ type: 'area', label: 'Toque no centro da área (bairro/trecho)' }) },
                icon('plus', 'size-3.5'), 'Marcar no mapa'),
        ),
        h('p', { class: 'text-[11px] leading-snug text-slate-500' },
            'Marque bairros ou trechos que sua equipe considera arriscados. O cálculo evita passar por eles conforme a prioridade escolhida e procura desvios.'),
        s.riskAreas.length === 0
            ? h('p', { class: 'rounded-lg border border-dashed border-slate-800 p-3 text-center text-xs text-slate-500' }, 'Nenhuma área marcada.')
            : h('ul', { class: 'space-y-1' }, s.riskAreas.map(a => {
                const lvl = RISK_LEVELS[a.level] ?? RISK_LEVELS[1];
                return h('li', { class: 'flex items-center gap-2 rounded-lg px-1 py-1 text-xs hover:bg-slate-800/50' },
                    h('span', { class: 'size-2.5 shrink-0 rounded-full', style: { backgroundColor: lvl.color } }),
                    h('button', { class: 'min-w-0 flex-1 truncate text-left text-slate-200', onclick: () => map.focus(a, 14), title: 'Ver no mapa' }, a.name),
                    h('span', { class: 'text-slate-500' }, `${lvl.label} · ${num(a.radius / 1000, 1)} km`),
                    h('button', { class: 'icon-btn p-1', 'aria-label': `Editar ${a.name}`, onclick: () => openAreaDialog({ id: a.id }) }, icon('pencil', 'size-3.5')),
                );
            })),
    );
}

const shortDate = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Observações dos motoristas: ruas onde o veículo não passou. */
function blocksCard(s) {
    const list = [...s.roadBlocks].sort((a, b) => b.at - a.at);
    return h('div', { class: 'card space-y-2 p-4' },
        h('div', { class: 'flex items-center justify-between gap-2' },
            h('h3', { class: 'flex items-center gap-1.5 text-sm font-semibold text-slate-200' }, icon('ban', 'size-4 text-red-400'), 'Ruas sem passagem'),
            h('button', { class: 'btn-subtle', onclick: () => setPick({ type: 'block', label: 'Toque na rua onde não dá para passar' }) },
                icon('plus', 'size-3.5'), 'Marcar no mapa'),
        ),
        h('p', { class: 'text-[11px] leading-snug text-slate-500' },
            'Observações dos motoristas (botão "Não passa" na navegação) ou marcadas aqui. As próximas rotas desviam desses pontos.'),
        list.length === 0
            ? h('p', { class: 'rounded-lg border border-dashed border-slate-800 p-3 text-center text-xs text-slate-500' }, 'Nenhuma observação ainda.')
            : h('ul', { class: 'space-y-1' }, list.map(b => h('li', { class: 'flex items-start gap-2 rounded-lg px-1 py-1 text-xs hover:bg-slate-800/50' },
                icon('ban', 'mt-0.5 size-3.5 text-red-400'),
                h('button', { class: 'min-w-0 flex-1 text-left', onclick: () => map.focus(b, 17), title: 'Ver no mapa' },
                    h('p', { class: 'font-medium text-slate-200' }, b.reason),
                    b.note && h('p', { class: 'text-slate-400' }, b.note),
                    h('p', { class: 'text-[10px] text-slate-500' }, `${ROAD_BLOCK.scopes[b.scope]} · ${shortDate(b.at)}`)),
                h('button', { class: 'icon-btn p-1', 'aria-label': `Editar observação: ${b.reason}`, onclick: () => openBlockDialog({ id: b.id }) }, icon('pencil', 'size-3.5')),
            ))),
    );
}

export function mountRouteView() {
    mountAreaDialog();
    map = createRouteMap($('#route-map'), {
        onPick: handlePick,
        onChooseAlt: (key, idx) => actions.chooseAlternative(key, idx),
        onAreaClick: (id) => openAreaDialog({ id }),
        onBlockClick: (id) => openBlockDialog({ id }),
    });
    $('#btn-fit-map').addEventListener('click', () => map.fit());

    watch(s => [s.theme], (s) => map.setTheme(s.theme));

    // Mapa de ruas × satélite
    const styleBtns = [...document.querySelectorAll('[data-map-style]')];
    styleBtns.forEach(b => b.addEventListener('click', () => actions.setMapStyle(b.dataset.mapStyle)));
    watch(s => [s.mapStyle], (s) => {
        map.setStyle(s.mapStyle);
        styleBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mapStyle === s.mapStyle)));
    });
    watch(s => [s.activeTab], (s) => {
        if (s.activeTab === 'route') requestAnimationFrame(() => { map.invalidate(); map.fit(); });
        else if (pickMode) setPick(null);
    });

    // Mapa: só redesenha quando a geometria muda.
    watch((s, d) => [d.routeEval, s.riskAreas, s.roadBlocks, s.depot, s.geo, s.items], (s, d) => map.update({
        depot: d.depotPoint && { ...d.depotPoint, address: s.depot.address },
        stops: d.stops,
        legs: d.routeEval.legs,
        areas: s.riskAreas,
        heavy: d.profile === 'truck',
        blocks: s.roadBlocks,
    }));

    // Painel
    watch((s, d) => [s.items, s.geo, s.depot, s.riskAreas, s.roadBlocks, d.routeEval, s.settings, d.truck, s.routeStatus, s.stopKm, s.deliveries], (s, d) => keepFocus(() => {
        render($('#route-controls'), controls(s, d));
        render($('#route-summary'), summary(s, d));
        render($('#route-stops'), d.stops.length === 0
            ? h('li', { class: 'card p-8 text-center text-sm text-slate-400' }, 'Nenhuma parada. Adicione cargas para montar a rota.')
            : d.stops.map((st, i) => stopCard(st, i, s, d)));
        render($('#risk-areas'), areasCard(s));
        render($('#road-blocks'), blocksCard(s));
    }));
}
