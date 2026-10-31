import { DEFAULT_SETTINGS, SAMPLE_ITEMS, SAMPLE_STOP_KM, SAMPLE_DEPOT } from '../config/constants.js';
import * as fleet from '../core/fleet.js';
import { newId } from '../core/io.js';
import { packCargo } from '../core/packer.js';
import { loadTotals, weightDistribution, groupStops, routeMetrics } from '../core/metrics.js';
import { addressKey } from '../core/geo.js';
import { evaluateRoute, profileFor } from '../core/routing.js';
import { driveTimeFactor } from '../core/navigation.js';

/*
 * Fonte única de verdade. Toda mudança passa por setState(); as telas usam
 * watch(selector, callback) para reagir apenas ao que lhes interessa.
 * Os dados do projeto são salvos automaticamente no navegador.
 */

const STORAGE_KEY = 'logiflow3d:v2';
const PERSISTED = [
    'trucks', 'truckKey', 'items', 'stopKm', 'settings', 'wallsOpaque', 'activeTab',
    'theme', 'mapStyle', 'depot', 'riskAreas', 'geo', 'routePlan', 'deliveries',
];

const systemTheme = () => (globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

function sampleState() {
    return {
        truckKey: 'hr',
        items: SAMPLE_ITEMS.map(i => ({ ...i })),
        stopKm: { ...SAMPLE_STOP_KM },
        settings: { ...DEFAULT_SETTINGS },
        depot: { ...SAMPLE_DEPOT },
    };
}

function initialState() {
    const base = {
        ...sampleState(),
        trucks: fleet.defaultFleet(),
        wallsOpaque: false,
        activeTab: 'packing',
        selectedId: null,
        theme: systemTheme(),
        mapStyle: 'map', // 'map' (ruas) ou 'satellite'
        riskAreas: [],
        geo: {},          // posição de cada endereço já localizado (chave: addressKey)
        routePlan: null,  // caminhos buscados no serviço de rotas
        routeStatus: { busy: false, message: '' }, // não é salvo
        deliveries: {},  // status de cada parada na viagem: { [nº]: { status: 'done' | 'pending', reason, note, at } }
    };
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (saved && Array.isArray(saved.items)) {
            for (const k of PERSISTED) if (saved[k] !== undefined) base[k] = saved[k];
            base.settings = { ...DEFAULT_SETTINGS, ...base.settings };
            base.trucks = fleet.sanitizeFleet(base.trucks);
        }
        if (saved?.theme === 'light' || saved?.theme === 'dark') base.theme = saved.theme;
        if (!Array.isArray(base.riskAreas)) base.riskAreas = [];
        if (!base.geo || typeof base.geo !== 'object') base.geo = {};
        if (!base.deliveries || typeof base.deliveries !== 'object') base.deliveries = {};
    } catch { /* armazenamento indisponível: segue com o exemplo */ }
    if (!base.trucks[base.truckKey]) base.truckKey = Object.keys(base.trucks)[0];
    return base;
}

let state = initialState();
let derived = null;
let packCache = { items: null, truck: null, result: null };
let routeCache = { deps: [], result: null };
const watchers = new Set();
let saveTimer = null;

function computeDerived(s) {
    // Referência estável: só muda ao trocar de veículo ou editar o veículo atual.
    const truck = s.trucks[s.truckKey];
    if (packCache.items !== s.items || packCache.truck !== truck) {
        packCache = { items: s.items, truck, result: packCargo(s.items, truck) };
    }
    const packing = packCache.result;

    // Paradas com posição no mapa (quando o endereço já foi localizado).
    const stops = groupStops(s.items, s.stopKm).map(st => {
        const g = s.geo[addressKey(st.address)];
        return { ...st, point: g && Number.isFinite(g.lat) ? g : null };
    });
    const depotPoint = Number.isFinite(s.depot?.lat) ? s.depot : null;
    const waypoints = [depotPoint, ...stops.map(st => st.point)];
    const profile = profileFor(truck);
    const timeFactor = driveTimeFactor(truck, profile); // tempo ajustado ao tipo de veículo

    const deps = [s.routePlan, s.riskAreas, s.settings.routePriority, profile,
        waypoints.map(w => (w ? `${w.lat},${w.lon}` : '-')).join(';')];
    if (deps.some((d, i) => d !== routeCache.deps[i])) {
        routeCache = { deps, result: evaluateRoute(s.routePlan, waypoints, s.riskAreas, s.settings.routePriority, profile) };
    }
    const routeEval = routeCache.result;

    // Trechos calculados no mapa substituem os km digitados à mão.
    routeEval.legs.forEach((leg, i) => {
        if (!leg?.alternatives?.length) return;
        const alt = leg.alternatives[leg.chosen];
        stops[i] = { ...stops[i], km: alt.km, min: alt.min * timeFactor, autoKm: true };
    });

    return {
        truck,
        packing,
        unplacedById: new Map(packing.unplaced.map(u => [u.id, u.reason])),
        placedById: new Map(packing.placed.map(p => [p.id, p])),
        totals: loadTotals(s.items, truck),
        distribution: weightDistribution(packing.placed, truck),
        stops,
        depotPoint,
        profile,
        timeFactor,
        routeEval,
        route: routeMetrics(stops, truck, s.settings),
    };
}

derived = computeDerived(state);

export const getState = () => state;
export const getDerived = () => derived;

/** Atualiza o estado com um objeto parcial ou função (state) => parcial. */
export function setState(patch) {
    const next = typeof patch === 'function' ? patch(state) : patch;
    if (!next) return;
    state = { ...state, ...next };
    derived = computeDerived(state);
    for (const w of watchers) w.check();
    scheduleSave();
}

/**
 * Executa `callback(state, derived)` quando qualquer valor retornado por
 * `selector(state, derived)` (um array de dependências) mudar.
 */
export function watch(selector, callback, { immediate = true } = {}) {
    let prev = null;
    const watcher = {
        check() {
            const deps = selector(state, derived);
            if (prev && deps.length === prev.length && deps.every((d, i) => Object.is(d, prev[i]))) return;
            prev = deps;
            callback(state, derived);
        },
    };
    watchers.add(watcher);
    if (immediate) watcher.check();
    else prev = selector(state, derived);
    return () => watchers.delete(watcher);
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            const data = Object.fromEntries(PERSISTED.map(k => [k, state[k]]));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch { /* sem armazenamento: ignora */ }
    }, 250);
}

// ---------- Ações ----------

export const actions = {
    addItems(newItems) {
        setState(s => ({ items: [...s.items, ...newItems] }));
    },
    updateItem(id, patch) {
        setState(s => ({ items: s.items.map(i => (i.id === id ? { ...i, ...patch } : i)) }));
    },
    removeItem(id) {
        const index = state.items.findIndex(i => i.id === id);
        if (index < 0) return null;
        const removed = state.items[index];
        setState(s => ({
            items: s.items.filter(i => i.id !== id),
            selectedId: s.selectedId === id ? null : s.selectedId,
        }));
        return () => setState(s => {
            const items = [...s.items];
            items.splice(Math.min(index, items.length), 0, removed);
            return { items };
        });
    },
    select(id) {
        if (state.selectedId !== id) setState({ selectedId: id });
    },
    setTruck(truckKey) {
        if (state.trucks[truckKey]) setState({ truckKey });
    },

    // ----- Frota (lançam Error / fleet.ValidationError com dados inválidos) -----

    /** Cadastra e seleciona um veículo novo. Retorna o id. */
    addTruck(data) {
        const id = newId();
        setState(s => ({ trucks: fleet.addTruck(s.trucks, id, data), truckKey: id }));
        return id;
    },
    updateTruck(id, data) {
        setState(s => ({ trucks: fleet.updateTruck(s.trucks, id, data) }));
    },
    /** Remove um veículo; se era o selecionado, seleciona o primeiro. Retorna função de desfazer. */
    removeTruck(id) {
        const before = state.trucks;
        const wasSelected = state.truckKey === id;
        const trucks = fleet.removeTruck(before, id);
        setState({ trucks, truckKey: wasSelected ? Object.keys(trucks)[0] : state.truckKey });
        return () => setState(s => ({
            // Recoloca na posição original, preservando veículos criados depois.
            trucks: { ...Object.fromEntries(Object.entries(before).filter(([k]) => k === id || s.trucks[k])), ...s.trucks, [id]: before[id] },
            truckKey: wasSelected ? id : s.truckKey,
        }));
    },
    resetFleet() {
        setState(s => {
            const trucks = fleet.defaultFleet();
            return { trucks, truckKey: trucks[s.truckKey] ? s.truckKey : 'hr' };
        });
    },
    setTab(activeTab) {
        setState({ activeTab });
    },
    toggleWalls() {
        setState(s => ({ wallsOpaque: !s.wallsOpaque }));
    },
    setStopKm(stop, km) {
        setState(s => ({ stopKm: { ...s.stopKm, [stop]: km } }));
    },
    updateSettings(patch) {
        setState(s => ({ settings: { ...s.settings, ...patch } }));
    },
    loadProject(project) {
        setState(s => ({
            trucks: project.trucks,
            truckKey: project.truckKey,
            items: project.items,
            stopKm: project.stopKm,
            settings: { ...DEFAULT_SETTINGS, ...project.settings },
            depot: project.depot ?? s.depot,
            riskAreas: project.riskAreas ?? s.riskAreas,
            geo: { ...s.geo, ...project.geo },
            selectedId: null,
        }));
    },
    resetSample() {
        setState({ ...sampleState(), selectedId: null, deliveries: {} });
    },
    clearAll() {
        setState({ items: [], stopKm: {}, selectedId: null, deliveries: {} });
    },

    // ----- Tema -----
    setTheme(theme) {
        setState({ theme: theme === 'light' ? 'light' : 'dark' });
    },
    setMapStyle(mapStyle) {
        setState({ mapStyle: mapStyle === 'satellite' ? 'satellite' : 'map' });
    },
    toggleTheme() {
        setState(s => ({ theme: s.theme === 'light' ? 'dark' : 'light' }));
    },

    // ----- Rotas -----

    /** Base de saída. `patch` pode trazer address e/ou lat/lon. */
    setDepot(patch) {
        setState(s => ({ depot: { ...s.depot, ...patch } }));
    },
    /** Guarda a posição de um endereço (localizado no serviço ou marcado no mapa). */
    setGeo(address, value) {
        const key = addressKey(address);
        if (!key) return;
        setState(s => ({ geo: { ...s.geo, [key]: value } }));
    },
    addRiskArea(data) {
        const area = { id: newId(), ...data };
        setState(s => ({ riskAreas: [...s.riskAreas, area] }));
        return area.id;
    },
    updateRiskArea(id, patch) {
        setState(s => ({ riskAreas: s.riskAreas.map(a => (a.id === id ? { ...a, ...patch } : a)) }));
    },
    /** Remove uma área de atenção. Retorna função de desfazer. */
    removeRiskArea(id) {
        const index = state.riskAreas.findIndex(a => a.id === id);
        if (index < 0) return null;
        const removed = state.riskAreas[index];
        setState(s => ({ riskAreas: s.riskAreas.filter(a => a.id !== id) }));
        return () => setState(s => {
            const list = [...s.riskAreas];
            list.splice(Math.min(index, list.length), 0, removed);
            return { riskAreas: list };
        });
    },
    setRoutePlan(routePlan) {
        setState({ routePlan });
    },
    setRouteStatus(routeStatus) {
        setState({ routeStatus: { busy: false, message: '', ...routeStatus } });
    },
    /** Escolhe manualmente um caminho alternativo (null volta à escolha automática). */
    chooseAlternative(legKey, index) {
        setState(s => {
            if (!s.routePlan) return null;
            const choice = { ...s.routePlan.choice };
            if (index === null) delete choice[legKey]; else choice[legKey] = index;
            return { routePlan: { ...s.routePlan, choice } };
        });
    },
    /**
     * Renumera as paradas na ordem informada (lista dos números atuais).
     * Como a regra LIFO depende da ordem, o baú é rearrumado automaticamente.
     */
    /** Registra entrega feita ou pendente (com motivo) de uma parada. */
    setDelivery(stop, data) {
        setState(s => ({ deliveries: { ...s.deliveries, [stop]: { ...data, at: Date.now() } } }));
    },
    clearDelivery(stop) {
        setState(s => {
            const deliveries = { ...s.deliveries };
            delete deliveries[stop];
            return { deliveries };
        });
    },
    clearDeliveries() {
        setState({ deliveries: {} });
    },
    reorderStops(order) {
        const map = new Map(order.map((oldStop, i) => [oldStop, i + 1]));
        setState(s => ({
            items: s.items.map(i => (map.has(i.stop) ? { ...i, stop: map.get(i.stop) } : i)),
            stopKm: {}, // as distâncias digitadas valiam para a ordem antiga
            deliveries: {}, // os números das paradas mudaram
        }));
    },
};
