import L from 'leaflet';
import { NAVIGATION, PENDING_REASONS, ROAD_BLOCK, colorForStop } from '../../config/constants.js';
import { buildNav, snap, progress, pointAt, spokenDistance, isDestination } from '../../core/navigation.js';
import { haversine } from '../../core/geo.js';
import { blocksFor, blockPolygons } from '../../core/roadBlocks.js';
import { openBlockDialog } from './blockDialog.js';
import { fetchAlternatives } from '../../services/mapApi.js';
import { actions, getDerived, getState, watch } from '../../state/store.js';
import { toast } from '../toast.js';
import { $, h, render } from '../dom.js';
import { icon } from '../icons.js';
import { int } from '../format.js';
import { attachBaseLayers } from './routeMap.js';

/*
 * Modo navegação (tela cheia), pensado para o motorista: seta grande da próxima
 * manobra, distância, voz em português, horário de chegada com descargas e,
 * ao chegar, a lista do que descarregar. Funciona com GPS, simulação ou
 * avançando as instruções à mão.
 */

// ---------- Ícone de cada tipo de manobra (códigos do Valhalla) ----------
const MANEUVER_ICON = {
    2: 'arrow-up-right', 3: 'arrow-up-left',
    9: 'arrow-up-right', 18: 'arrow-up-right', 20: 'arrow-up-right', 23: 'arrow-up-right', 37: 'arrow-up-right',
    16: 'arrow-up-left', 19: 'arrow-up-left', 21: 'arrow-up-left', 24: 'arrow-up-left', 38: 'arrow-up-left',
    10: 'turn-right', 11: 'turn-right', 14: 'turn-left', 15: 'turn-left',
    12: 'uturn-right', 13: 'uturn-left',
    26: 'rotate-ccw', 27: 'rotate-ccw',
    25: 'merge', 28: 'ship', 29: 'ship',
    4: 'flag', 5: 'flag', 6: 'flag',
};
const maneuverIcon = (type, cls) => icon(MANEUVER_ICON[type] ?? 'arrow-up', cls);

const clock = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const minutes = (s) => {
    const m = Math.max(1, Math.round(s / 60));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};
const km = (m) => (m < 995 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);

// ---------- Estado da viagem ----------
let nav = null;          // rota montada por buildNav
let alts = [];           // caminho de cada trecho (pode ser trocado ao recalcular)
let stops = [];
let legIdx = 0;
let along = 0;
let pos = null;          // última posição { lat, lon }
let heading = 0;
let follow = true;
let voiceOn = true;
let simTimer = null;
let watchId = null;
let gps = 'off';         // off | waiting | ok | denied | unavailable
let offCount = 0;
let lastReroute = 0;
let rerouting = false;
let spoken = new Set();
let arrivalOpen = false;
let dismissedLeg = -1;   // "Ainda não cheguei": não reabre sozinho neste trecho
let wakeLock = null;

let map = null, base = null;
const layers = {};
let posMarker = null;

// ---------- Voz ----------
function say(text) {
    if (!voiceOn || !('speechSynthesis' in window) || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    u.rate = 1.05;
    const voice = speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('pt-br'))
        ?? speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('pt'));
    if (voice) u.voice = voice;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
}

// ---------- Tela ----------
function buildScreen() {
    const root = $('#nav-screen');
    render(root,
        h('div', { id: 'nav-top', class: 'shrink-0 bg-emerald-600 px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)] text-white shadow-lg transition-colors' },
            h('div', { class: 'mx-auto flex max-w-3xl items-center gap-3' },
                h('div', { id: 'nav-icon', class: 'flex size-16 shrink-0 items-center justify-center rounded-2xl bg-black/15 sm:size-20' }),
                h('div', { class: 'min-w-0 flex-1' },
                    h('p', { id: 'nav-dist', class: 'font-mono text-4xl font-bold leading-none sm:text-5xl' }),
                    h('p', { id: 'nav-text', class: 'mt-1 text-lg font-semibold leading-snug sm:text-xl' })),
            ),
            h('p', { id: 'nav-after', class: 'mx-auto mt-2 flex max-w-3xl items-center gap-1.5 rounded-lg bg-black/15 px-2.5 py-1.5 text-sm' }),
        ),
        h('div', { class: 'relative isolate min-h-0 flex-1' },
            h('div', { id: 'nav-map', class: 'absolute inset-0' }),
            h('div', { id: 'nav-banner', class: 'absolute inset-x-3 top-3 z-[1000] mx-auto max-w-xl', hidden: true }),
            h('div', { class: 'absolute bottom-3 right-3 z-[1000] flex flex-col gap-2' },
                h('button', { id: 'nav-voice', class: 'overlay flex size-12 items-center justify-center text-slate-200', onclick: toggleVoice }),
                h('button', {
                    id: 'nav-recenter', class: 'overlay flex size-12 items-center justify-center text-emerald-400', title: 'Centralizar', 'aria-label': 'Centralizar no veículo',
                    onclick: () => { follow = true; update(); },
                }, icon('locate', 'size-6')),
            ),
            h('div', { id: 'nav-arrival', class: 'absolute inset-x-3 bottom-3 z-[1001] mx-auto max-w-xl', hidden: true }),
        ),
        h('div', { class: 'shrink-0 border-t border-slate-800 bg-slate-900 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3' },
            h('div', { class: 'mx-auto max-w-3xl' },
                h('div', { class: 'flex items-end justify-between gap-3' },
                    h('div', {},
                        h('p', { id: 'nav-eta-label', class: 'text-xs font-medium text-slate-400' }),
                        h('p', { id: 'nav-eta', class: 'font-mono text-4xl font-bold leading-none text-emerald-400' })),
                    h('div', { class: 'min-w-0 text-right' },
                        h('p', { id: 'nav-remaining', class: 'font-mono text-xl font-semibold text-slate-100' }),
                        h('p', { id: 'nav-stop', class: 'truncate text-xs text-slate-400' })),
                ),
                h('p', { id: 'nav-end', class: 'mt-1.5 text-xs text-slate-500' }),
                h('div', { class: 'mt-3 flex gap-2' },
                    h('button', { class: 'btn-ghost border border-slate-700 px-3 py-3 text-red-400', onclick: () => stop(true) }, icon('x', 'size-5'), 'Encerrar'),
                    h('button', {
                        class: 'btn border border-red-500/40 bg-red-500/10 px-3 py-3 font-semibold text-red-300',
                        onclick: openBlockChooser, title: 'Avisar que o veículo não passa por esta rua',
                    }, icon('ban', 'size-5'), 'Não passa'),
                    h('button', { id: 'nav-arrive', class: 'btn-primary flex-1 py-3 text-base', onclick: () => openArrival() }, icon('package-check', 'size-5'), 'Cheguei'),
                ),
                h('div', { class: 'mt-2 grid grid-cols-4 gap-1.5' },
                    h('button', { id: 'nav-sim', class: 'btn-subtle justify-center py-2', onclick: toggleSim }),
                    h('button', { class: 'btn-subtle justify-center py-2', onclick: () => stepManeuver(-1), 'aria-label': 'Instrução anterior' }, icon('chevron-left', 'size-4'), 'Voltar'),
                    h('button', { class: 'btn-subtle justify-center py-2', onclick: () => stepManeuver(1), 'aria-label': 'Próxima instrução' }, 'Avançar', icon('chevron-right', 'size-4')),
                    h('button', { class: 'btn-subtle justify-center py-2', onclick: openMapsSheet, title: 'Abrir no Google Maps ou Waze' }, icon('external', 'size-3.5'), 'Maps'),
                ),
            ),
        ),
    );

    map = L.map($('#nav-map'), { zoomControl: false, attributionControl: true });
    base = attachBaseLayers(map, $('#nav-map'));
    base.setTheme(getState().theme);
    base.setStyle(getState().mapStyle);
    layers.route = L.layerGroup().addTo(map);
    layers.stops = L.layerGroup().addTo(map);
    map.on('dragstart', () => { follow = false; });
}

function drawRoute() {
    layers.route.clearLayers();
    layers.stops.clearLayers();
    nav.legs.forEach((leg, i) => {
        const done = i < legIdx;
        const pts = nav.points.slice(leg.start, leg.end + 1);
        L.polyline(pts, { color: '#ffffff', weight: 11, opacity: done ? 0.3 : 0.9, interactive: false }).addTo(layers.route);
        L.polyline(pts, { color: done ? '#64748b' : colorForStop(leg.stop), weight: 7, opacity: done ? 0.6 : 1, interactive: false }).addTo(layers.route);
        const el = h('div', { class: 'map-pin', style: { width: '30px', height: '30px', background: done ? '#64748b' : colorForStop(leg.stop) } }, String(leg.stop));
        L.marker(nav.points[leg.end], { icon: L.divIcon({ html: el, className: '', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(layers.stops);
    });
    // Ruas sem passagem que valem para este veículo
    for (const b of blocksFor(getState().roadBlocks, getDerived().profile)) {
        const el = h('div', { class: 'map-pin', style: { width: '24px', height: '24px', background: '#dc2626' } }, icon('ban', 'size-3.5'));
        L.marker([b.lat, b.lon], { icon: L.divIcon({ html: el, className: '', iconSize: [24, 24], iconAnchor: [12, 12] }) })
            .bindTooltip(`${b.reason}${b.note ? ` · ${b.note}` : ''}`).addTo(layers.stops);
    }
}

function setBanner(text, tone = 'amber') {
    const el = $('#nav-banner');
    el.hidden = !text;
    if (!text) return;
    const cls = tone === 'red' ? 'border-red-500/40 text-red-300' : 'border-amber-500/40 text-amber-300';
    render(el, h('div', { class: `overlay flex items-center gap-2 px-3 py-2 text-sm font-medium ${cls}` }, icon('warn', 'size-4'), text));
}

function update() {
    if (!nav) return;
    const p = progress(nav, along, legIdx, Date.now(), getState().settings.unloadMin ?? 0);
    along = p.along;
    const leg = nav.legs[legIdx];

    // Instrução principal
    const offRoute = gps === 'ok' && offCount > 0;
    $('#nav-top').className = $('#nav-top').className.replace(/bg-(emerald|amber)-600/, offRoute ? 'bg-amber-600' : 'bg-emerald-600');
    render($('#nav-icon'), maneuverIcon(p.next.type, 'size-11 sm:size-14'));
    $('#nav-dist').textContent = isDestination(p.next.type) && p.toNextM < 30 ? 'Chegando' : spokenDistance(p.toNextM);
    $('#nav-text').textContent = p.next.text;
    const after = $('#nav-after');
    after.hidden = !p.after;
    if (p.after) render(after, h('span', { class: 'opacity-80' }, 'Depois:'), maneuverIcon(p.after.type, 'size-4'), h('span', { class: 'truncate' }, p.after.text));

    // Chegada e tempo
    $('#nav-eta-label').textContent = `Chegada na parada #${leg.stop}`;
    $('#nav-eta').textContent = clock(p.etas[0].at);
    $('#nav-remaining').textContent = `${minutes(p.toStopS)} · ${km(p.toStopM)}`;
    $('#nav-stop').textContent = leg.address || '';
    const remaining = nav.legs.length - legIdx;
    const unload = getState().settings.unloadMin ?? 0;
    $('#nav-end').textContent = remaining > 1
        ? `Fim da rota às ${clock(p.etas.at(-1).at)} · ${remaining} paradas · ${unload} min de descarga em cada`
        : `Última parada${unload ? ` · ${unload} min de descarga` : ''}`;

    // Botões
    render($('#nav-voice'), icon(voiceOn ? 'volume' : 'volume-off', 'size-6'));
    $('#nav-voice').setAttribute('aria-label', voiceOn ? 'Desligar voz' : 'Ligar voz');
    render($('#nav-sim'), icon(simTimer ? 'pause' : 'play', 'size-3.5'), simTimer ? 'Pausar' : 'Simular');
    $('#nav-recenter').hidden = follow;

    // Mapa
    const here = pos ? [pos.lat, pos.lon] : pointAt(nav, along);
    const arrow = h('div', { style: { transform: `rotate(${heading}deg)`, color: '#00a3e0', filter: 'drop-shadow(0 2px 4px rgb(0 0 0 / .5))' } }, icon('arrow', 'size-9 fill-current stroke-white'));
    if (!posMarker) posMarker = L.marker(here, { zIndexOffset: 2000, interactive: false }).addTo(map);
    posMarker.setLatLng(here);
    posMarker.setIcon(L.divIcon({ html: arrow, className: '', iconSize: [36, 36], iconAnchor: [18, 18] }));
    if (follow) map.setView(here, Math.max(map.getZoom() || 0, 16), { animate: true });

    // Voz: aviso antecipado e na hora da manobra
    const key = nav.maneuvers.indexOf(p.next);
    if (p.toNextM <= NAVIGATION.voiceFarM && p.toNextM > NAVIGATION.voiceNearM * 2 && !spoken.has(`${key}f`)) {
        spoken.add(`${key}f`);
        say(`Em ${spokenDistance(p.toNextM)}, ${lowerFirst(p.next.alert)}`);
    } else if (p.toNextM <= NAVIGATION.voiceNearM && !spoken.has(`${key}n`)) {
        spoken.add(`${key}n`);
        spoken.add(`${key}f`);
        say(p.next.alert);
    }

    if (p.arrived && !arrivalOpen && dismissedLeg !== legIdx && (gps === 'ok' || simTimer)) openArrival();
}

// ---------- Chegada / descarga ----------
function openArrival() {
    const leg = nav.legs[legIdx];
    arrivalOpen = true;
    pauseSim();
    const items = leg.items ?? [];
    const unplaced = getDerived().unplacedById;
    const last = legIdx === nav.legs.length - 1;
    say(`Você chegou na parada ${leg.stop}. Descarregue ${items.length} ${items.length === 1 ? 'volume' : 'volumes'}.`);
    const el = $('#nav-arrival');
    el.hidden = false;
    render(el, h('div', { class: 'overlay space-y-3 p-4 shadow-2xl' },
        h('div', { class: 'flex items-center gap-3' },
            h('div', { class: 'flex size-12 shrink-0 items-center justify-center rounded-xl font-mono text-lg font-bold text-white', style: { background: colorForStop(leg.stop) } }, `#${leg.stop}`),
            h('div', { class: 'min-w-0' },
                h('p', { class: 'text-lg font-bold text-slate-100' }, 'Você chegou!'),
                h('p', { class: 'truncate text-sm text-slate-400' }, leg.address || ''))),
        h('div', {},
            h('p', { class: 'mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400' }, 'Descarregar (ficam junto à porta)'),
            h('ul', { class: 'max-h-40 space-y-1 overflow-y-auto' }, items.map(it => h('li', { class: 'flex items-center gap-2 text-sm text-slate-200' },
                icon('package', 'size-4 text-slate-500'),
                h('span', { class: 'min-w-0 flex-1 truncate' }, it.label),
                h('span', { class: 'font-mono text-xs text-slate-400' }, `${int(it.weight)} kg`),
                it.fragile && h('span', { class: 'chip bg-amber-500/15 text-amber-300' }, 'Frágil'),
                unplaced.has(it.id) && h('span', { class: 'chip bg-red-500/15 text-red-300' }, 'Fora do baú'),
            )))),
        h('button', { class: 'btn-primary w-full py-3 text-base', onclick: () => finishStop({ status: 'done' }) },
            icon(last ? 'flag' : 'package-check', 'size-5'),
            last ? 'Entrega feita · Finalizar rota' : `Entrega feita · Ir para #${nav.legs[legIdx + 1].stop}`),
        h('button', {
            class: 'btn w-full border border-amber-500/40 bg-amber-500/10 py-3 text-base font-semibold text-amber-300',
            onclick: openPending,
        }, icon('warn', 'size-5'), 'Não entregue (pendente)'),
        backButton(() => { dismissedLeg = legIdx; closeArrival(); }, 'Ainda não cheguei'),
    ));
}

/** Botão grande de voltar (fácil de acertar com o caminhão parado). */
const backButton = (onclick, label) => h('button', {
    class: 'btn w-full border border-slate-700 bg-slate-800/60 py-3 text-base font-semibold text-slate-100', onclick,
}, icon('chevron-left', 'size-5'), label);

/** Escolha do motivo da pendência: botões grandes, um toque. */
function openPending() {
    const leg = nav.legs[legIdx];
    let reason = null;
    const confirmBtn = h('button', { class: 'btn-primary w-full py-3 text-base', disabled: true, onclick: () => {
        finishStop({ status: 'pending', reason, note: note.value.trim().slice(0, 200) });
    } }, icon('ok', 'size-5'), 'Confirmar pendência');
    const note = h('input', { class: 'input', maxlength: 200, placeholder: 'Observação (opcional): ex. voltar após 14h' });
    const options = PENDING_REASONS.map(r => h('button', {
        class: 'seg-btn justify-start border-slate-700 px-3 py-3 text-sm text-slate-200',
        'aria-pressed': 'false',
        onclick: (e) => {
            reason = r;
            options.forEach(b => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
            confirmBtn.disabled = false;
            if (r === 'Outro motivo') note.focus();
        },
    }, r));
    render($('#nav-arrival'), h('div', { class: 'overlay max-h-[70dvh] space-y-3 overflow-y-auto p-4 shadow-2xl' },
        h('div', { class: 'flex items-center gap-2' },
            icon('warn', 'size-5 text-amber-400'),
            h('p', { class: 'flex-1 text-lg font-bold text-slate-100' }, `Parada #${leg.stop} não entregue`),
            h('button', { class: 'icon-btn', 'aria-label': 'Voltar', onclick: openArrival }, icon('x', 'size-6'))),
        h('p', { class: 'text-sm text-slate-400' }, 'Qual o motivo? A carga continua no baú e a parada fica marcada como pendente.'),
        h('div', { class: 'grid grid-cols-1 gap-1.5 sm:grid-cols-2', role: 'group', 'aria-label': 'Motivo' }, options),
        note,
        confirmBtn,
        backButton(openArrival, 'Voltar'),
    ));
}

// ---------- "Não dá para passar" ----------

/**
 * O motorista avisa que não passa: escolhe onde (a rua da próxima curva ou
 * onde está agora), registra o motivo e a rota é recalculada desviando do ponto.
 */
function openBlockChooser() {
    if (!nav) return;
    arrivalOpen = true; // não abre a tela de chegada por cima
    pauseSim();
    const p = progress(nav, along, legIdx);
    const here = pos ?? toLatLon(pointAt(nav, along));
    const turn = !isDestination(p.next.type) && p.toNextM < 1500
        ? toLatLon(pointAt(nav, Math.min(p.next.dist + ROAD_BLOCK.aheadM, nav.legs[legIdx].endDist - 30)))
        : null;
    const choose = (at) => {
        closeArrival();
        openBlockDialog({ at, scope: getDerived().profile === 'truck' ? 'truck' : 'all', onSaved: afterBlock });
    };
    const option = (label, hint, at, iconName) => h('button', {
        class: 'btn w-full flex-col items-start gap-0.5 border border-slate-700 bg-slate-800/60 px-4 py-3 text-left', onclick: () => choose(at),
    }, h('span', { class: 'flex items-center gap-2 text-base font-semibold text-slate-100' }, icon(iconName, 'size-5'), label),
        h('span', { class: 'text-xs text-slate-400' }, hint));
    const el = $('#nav-arrival');
    el.hidden = false;
    render(el, h('div', { class: 'overlay space-y-2 p-4 shadow-2xl' },
        h('div', { class: 'flex items-center gap-2' },
            icon('ban', 'size-5 text-red-400'),
            h('p', { class: 'flex-1 text-lg font-bold text-slate-100' }, 'Onde não dá para passar?')),
        turn && option('Na próxima rua', p.next.text, turn, MANEUVER_ICON[p.next.type] ?? 'arrow-up'),
        option('Aqui onde estou', pos ? 'Pela posição do GPS' : 'Pela posição na rota', here, 'locate'),
        backButton(closeArrival, 'Cancelar'),
    ));
}

const toLatLon = ([lat, lon]) => ({ lat, lon });

function afterBlock() {
    toast('Observação salva. Procurando outro caminho…', { tone: 'ok' });
    say('Observação salva. Recalculando a rota.');
    drawRoute();
    reroute({ force: true });
}

/** Registra o resultado da parada e segue para a próxima. */
function finishStop(result) {
    const leg = nav.legs[legIdx];
    actions.setDelivery(leg.stop, result);
    if (result.status === 'pending') {
        toast(`Parada #${leg.stop} marcada como pendente: ${result.reason}.`, { tone: 'warn' });
        say(`Parada ${leg.stop} pendente. ${result.reason}.`);
    }
    nextStop();
}

function closeArrival() {
    arrivalOpen = false;
    $('#nav-arrival').hidden = true;
}

function nextStop() {
    closeArrival();
    if (legIdx >= nav.legs.length - 1) {
        const all = Object.values(getState().deliveries);
        const done = all.filter(d => d.status === 'done').length;
        const pending = all.filter(d => d.status === 'pending').length;
        say(`Rota finalizada. ${done} ${done === 1 ? 'entrega feita' : 'entregas feitas'}${pending ? ` e ${pending} ${pending === 1 ? 'pendente' : 'pendentes'}` : ''}.`);
        toast(`Rota finalizada: ${done} entregue(s)${pending ? `, ${pending} pendente(s) — veja na aba Rota` : ''}.`, { tone: pending ? 'warn' : 'ok', duration: 9000 });
        stop(false);
        return;
    }
    legIdx++;
    along = nav.legs[legIdx].startDist;
    offCount = 0;
    drawRoute();
    const first = nav.maneuvers.find(m => m.leg === legIdx);
    say(`Próxima entrega: parada ${nav.legs[legIdx].stop}. ${first?.text ?? ''}`);
    update();
}

// ---------- Posição (GPS ou simulação) ----------
function onPosition(p, { simulated = false } = {}) {
    if (!nav || arrivalOpen && simulated) return;
    if (pos && haversine(pos, p) > 3) {
        const y = Math.sin(((p.lon - pos.lon) * Math.PI) / 180) * Math.cos((p.lat * Math.PI) / 180);
        const x = Math.cos((pos.lat * Math.PI) / 180) * Math.sin((p.lat * Math.PI) / 180)
            - Math.sin((pos.lat * Math.PI) / 180) * Math.cos((p.lat * Math.PI) / 180) * Math.cos(((p.lon - pos.lon) * Math.PI) / 180);
        heading = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    }
    if (Number.isFinite(p.heading)) heading = p.heading;
    pos = { lat: p.lat, lon: p.lon };

    const s = snap(nav, pos, legIdx);
    // Só usa a posição se estiver sobre a rota, e não volta para trás por ruído do GPS.
    if (s.offset <= NAVIGATION.offRouteM && s.along > along - 30) along = s.along;

    if (!simulated && s.offset > NAVIGATION.offRouteM) {
        offCount++;
        setBanner(`Fora da rota (${Math.round(s.offset)} m). Volte para a linha colorida.`);
        if (offCount >= NAVIGATION.rerouteAfter) reroute();
    } else if (offCount) {
        offCount = 0;
        setBanner(null);
    }
    update();
}

async function reroute({ force = false } = {}) {
    if (rerouting || (!force && Date.now() - lastReroute < NAVIGATION.rerouteCooldownS * 1000)) return;
    rerouting = true;
    lastReroute = Date.now();
    setBanner('Recalculando a rota a partir daqui…');
    say('Recalculando a rota.');
    try {
        const d = getDerived();
        const from = pos ?? toLatLon(pointAt(nav, along));
        const to = nav.legs[legIdx].point;
        const blocks = blockPolygons(blocksFor(getState().roadBlocks, d.profile), from, to);
        const [fresh] = await fetchAlternatives(from, to, { profile: d.profile, truck: d.truck, blocks, alternates: 0 });
        alts[legIdx] = fresh;
        const keepLeg = legIdx;
        nav = buildNav(alts, stops, d.timeFactor);
        legIdx = keepLeg;
        along = nav.legs[legIdx].startDist;
        spoken = new Set();
        offCount = 0;
        drawRoute();
        setBanner(null);
        update();
    } catch {
        setBanner(`Sem conexão para recalcular. Siga para a parada #${nav.legs[legIdx].stop}.`, 'red');
    } finally {
        rerouting = false;
    }
}

function startGps() {
    if (!('geolocation' in navigator)) { gps = 'unavailable'; return gpsHelp(); }
    if (!window.isSecureContext) { gps = 'unavailable'; return gpsHelp(); }
    gps = 'waiting';
    setBanner('Procurando sinal de GPS…');
    watchId = navigator.geolocation.watchPosition(
        (e) => {
            if (simTimer) return; // simulação tem prioridade enquanto ligada
            if (gps !== 'ok') setBanner(null);
            gps = 'ok';
            onPosition({ lat: e.coords.latitude, lon: e.coords.longitude, heading: e.coords.heading });
        },
        (err) => { gps = err.code === 1 ? 'denied' : 'unavailable'; gpsHelp(); },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
}

function gpsHelp() {
    const msg = gps === 'denied'
        ? 'GPS bloqueado. Permita a localização no navegador, ou use "Avançar" / "Simular".'
        : !window.isSecureContext
            ? 'GPS indisponível neste endereço (precisa de https). Use "Avançar" ou "Simular".'
            : 'Sem sinal de GPS. Use "Avançar" para ver as próximas instruções.';
    setBanner(msg);
}

// ---------- Simulação (demonstração/treino) ----------
function toggleSim() {
    if (simTimer) return pauseSim(), update();
    if (arrivalOpen) closeArrival();
    setBanner(null);
    const stepM = 20; // ~80 m/s simulados: percorre a rota rapidamente
    simTimer = setInterval(() => {
        const end = nav.legs[legIdx].endDist;
        const nextAlong = Math.min(end, along + stepM);
        const [lat, lon] = pointAt(nav, nextAlong);
        along = nextAlong;
        onPosition({ lat, lon }, { simulated: true });
    }, 250);
    update();
}

function pauseSim() {
    clearInterval(simTimer);
    simTimer = null;
}

/** Sem GPS: pula para a manobra anterior/seguinte. */
function stepManeuver(dir) {
    pauseSim();
    const legMs = nav.maneuvers.filter(m => m.leg === legIdx);
    if (dir > 0) {
        const next = legMs.find(m => m.dist > along + 3);
        if (!next || isDestination(next.type)) return openArrival();
        along = next.dist + 1;
    } else {
        const prev = [...legMs].reverse().find(m => m.dist < along - 5);
        along = prev ? Math.max(nav.legs[legIdx].startDist, prev.dist - 1) : nav.legs[legIdx].startDist;
    }
    pos = null;
    follow = true;
    update();
}

function toggleVoice() {
    voiceOn = !voiceOn;
    try { localStorage.setItem('logiflow3d:voice', voiceOn ? '1' : '0'); } catch { /* sem armazenamento */ }
    if (!voiceOn && 'speechSynthesis' in window) speechSynthesis.cancel();
    else say('Voz ligada.');
    update();
}

// ---------- Abrir em outro app (Google Maps / Waze) ----------
const coord = (p) => `${p.lat},${p.lon}`;

/** Links de navegação externos. No celular abrem direto no app instalado. */
export function externalLinks(remaining) {
    const next = remaining[0].point;
    const last = remaining.at(-1).point;
    // O Google Maps aceita até 9 paradas intermediárias pelo link.
    const via = remaining.slice(0, -1).slice(0, 9).map(l => coord(l.point)).join('|');
    return {
        googleNext: `https://www.google.com/maps/dir/?api=1&destination=${coord(next)}&travelmode=driving`,
        googleAll: `https://www.google.com/maps/dir/?api=1&destination=${coord(last)}${via ? `&waypoints=${encodeURIComponent(via)}` : ''}&travelmode=driving`,
        waze: `https://waze.com/ul?ll=${coord(next)}&navigate=yes`,
    };
}

function openMapsSheet() {
    pauseSim();
    const remaining = nav.legs.slice(legIdx);
    const links = externalLinks(remaining);
    const open = (url) => window.open(url, '_blank', 'noopener');
    const option = (label, sub, url, cls) => h('button', {
        class: `flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${cls}`, onclick: () => open(url),
    },
        icon('external', 'size-5 shrink-0'),
        h('span', { class: 'min-w-0' },
            h('span', { class: 'block text-base font-semibold' }, label),
            h('span', { class: 'block truncate text-xs opacity-75' }, sub)));

    const el = $('#nav-arrival');
    arrivalOpen = true; // o painel ocupa o mesmo espaço da chegada
    el.hidden = false;
    render(el, h('div', { class: 'overlay space-y-2 p-4 shadow-2xl' },
        h('div', { class: 'flex items-center justify-between gap-2' },
            h('p', { class: 'text-lg font-bold text-slate-100' }, 'Abrir em outro aplicativo'),
            h('button', { class: 'icon-btn', 'aria-label': 'Voltar à navegação', onclick: closeArrival }, icon('x', 'size-6'))),
        h('p', { class: 'text-xs text-slate-400' }, 'Use se preferir o seu app de mapas. Volte aqui para marcar as entregas.'),
        option('Google Maps', `Até a parada #${remaining[0].stop}`, links.googleNext, 'border-blue-500/40 bg-blue-500/10 text-blue-400'),
        remaining.length > 1 && option('Google Maps · rota completa', `${remaining.length} paradas restantes na ordem`, links.googleAll, 'border-blue-500/40 bg-blue-500/10 text-blue-400'),
        option('Waze', `Até a parada #${remaining[0].stop}`, links.waze, 'border-slate-700 bg-slate-800/60 text-slate-100'),
        backButton(closeArrival, 'Voltar à navegação'),
    ));
}

async function keepScreenOn() {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* sem suporte */ }
}
const onVisible = () => { if (nav && document.visibilityState === 'visible') keepScreenOn(); };

// ---------- Início / fim ----------

/** Abre a navegação. Requer a rota calculada (todas as paradas com caminho). */
export function startNavigation() {
    const d = getDerived();
    if (d.routeEval.status !== 'ok') return false;
    stops = d.stops;
    alts = d.routeEval.legs.map(l => l.alternatives[l.chosen]);
    nav = buildNav(alts, stops, d.timeFactor);
    legIdx = 0;

    // Viagem anterior com entregas marcadas: recomeçar ou continuar de onde parou.
    const prev = getState().deliveries;
    if (Object.keys(prev).length) {
        const fresh = confirm('Há entregas marcadas de uma viagem anterior.\n\nOK = começar uma nova viagem (limpar)\nCancelar = continuar de onde parou');
        if (fresh) actions.clearDeliveries();
        else {
            const next = nav.legs.findIndex(l => !prev[l.stop]);
            if (next < 0) {
                toast('Todas as paradas já têm resultado. Limpe os status na aba Rota para refazer.', { tone: 'warn' });
                nav = null;
                return true;
            }
            legIdx = next;
        }
    }
    along = nav.legs[legIdx].startDist;
    pos = null;
    heading = 0;
    follow = true;
    offCount = 0;
    spoken = new Set();
    arrivalOpen = false;
    dismissedLeg = -1;
    try { voiceOn = localStorage.getItem('logiflow3d:voice') !== '0'; } catch { voiceOn = true; }

    const root = $('#nav-screen');
    root.hidden = false;
    if (!map) buildScreen();
    closeArrival();
    setBanner(null);
    requestAnimationFrame(() => {
        map.invalidateSize();
        drawRoute();
        map.fitBounds(L.latLngBounds(nav.points), { padding: [40, 40] });
        update();
    });
    keepScreenOn();
    document.addEventListener('visibilitychange', onVisible);
    startGps();
    say(`Rota iniciada. ${nav.legs.length} ${nav.legs.length === 1 ? 'parada' : 'paradas'}. ${nav.maneuvers[0]?.text ?? ''}`);
    return true;
}

function stop(confirmFirst) {
    if (confirmFirst && !confirm('Encerrar a navegação?')) return;
    pauseSim();
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    gps = 'off';
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
    document.removeEventListener('visibilitychange', onVisible);
    if ('speechSynthesis' in window && confirmFirst) speechSynthesis.cancel();
    posMarker?.remove();
    posMarker = null;
    nav = null;
    $('#nav-screen').hidden = true;
}

export function mountNavigation() {
    watch(s => [s.theme, s.mapStyle], (s) => {
        base?.setTheme(s.theme);
        base?.setStyle(s.mapStyle);
    });
}
