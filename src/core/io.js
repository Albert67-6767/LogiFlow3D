import { sanitizeFleet, defaultFleet } from './fleet.js';
import { validateItem } from './validation.js';

const SCHEMA = 'logiflow3d';
const VERSION = 2;

export const newId = () =>
    (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);

// ---------- JSON (projeto completo) ----------

export function exportProject(state) {
    return JSON.stringify({
        schema: SCHEMA,
        version: VERSION,
        exportedAt: new Date().toISOString(),
        trucks: state.trucks,
        truckKey: state.truckKey,
        items: state.items,
        stopKm: state.stopKm,
        settings: state.settings,
        depot: state.depot,
        riskAreas: state.riskAreas,
        geo: state.geo,
    }, null, 2);
}

/** Lê um projeto JSON. Lança Error com mensagem amigável se inválido. */
export function importProject(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Arquivo JSON inválido.'); }
    if (!data || data.schema !== SCHEMA || !Array.isArray(data.items)) {
        throw new Error('Este arquivo não é um projeto do LogiFlow 3D.');
    }
    const items = sanitizeItems(data.items);
    // Arquivos antigos (sem frota) usam a frota padrão.
    const trucks = data.trucks ? sanitizeFleet(data.trucks) : defaultFleet();
    return {
        trucks,
        truckKey: trucks[data.truckKey] ? data.truckKey : Object.keys(trucks)[0],
        items,
        stopKm: sanitizeStopKm(data.stopKm),
        settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
        depot: sanitizeDepot(data.depot),
        riskAreas: sanitizeAreas(data.riskAreas),
        geo: sanitizeGeo(data.geo),
    };
}

const isLat = (v) => Number.isFinite(v) && Math.abs(v) <= 90;
const isLon = (v) => Number.isFinite(v) && Math.abs(v) <= 180;
const text = (v, max) => String(v ?? '').slice(0, max);

function sanitizeDepot(d) {
    if (!d || typeof d !== 'object') return undefined;
    const ok = isLat(d.lat) && isLon(d.lon);
    return { address: text(d.address, 160), lat: ok ? d.lat : null, lon: ok ? d.lon : null };
}

function sanitizeAreas(list) {
    if (!Array.isArray(list)) return undefined;
    return list
        .filter(a => a && isLat(a.lat) && isLon(a.lon) && Number(a.radius) > 0)
        .map(a => ({
            id: typeof a.id === 'string' && a.id ? a.id : newId(),
            name: text(a.name, 60) || 'Área de atenção',
            lat: a.lat, lon: a.lon,
            radius: Math.min(20000, Math.max(50, Number(a.radius))),
            level: [1, 2, 3].includes(Number(a.level)) ? Number(a.level) : 1,
        }));
}

function sanitizeGeo(obj) {
    if (!obj || typeof obj !== 'object') return undefined;
    const out = {};
    for (const [k, g] of Object.entries(obj)) {
        if (g && isLat(g.lat) && isLon(g.lon)) {
            out[k.slice(0, 200)] = { lat: g.lat, lon: g.lon, label: text(g.label, 300), bairro: text(g.bairro, 80), manual: !!g.manual };
        }
    }
    return out;
}

function sanitizeItems(list) {
    const items = [];
    list.forEach((raw, idx) => {
        const { value, errors } = validateItem({ ...raw, quantity: 1 });
        if (!value) throw new Error(`Item ${idx + 1} inválido: ${Object.values(errors)[0]}`);
        const { quantity, ...item } = value;
        items.push({ id: typeof raw.id === 'string' && raw.id ? raw.id : newId(), ...item });
    });
    return items;
}

function sanitizeStopKm(obj) {
    const out = {};
    if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
            const n = Number(v);
            if (Number.isInteger(Number(k)) && Number.isFinite(n) && n >= 0) out[k] = n;
        }
    }
    return out;
}

// ---------- CSV (lista de itens, compatível com Excel pt-BR) ----------

const CSV_COLUMNS = [
    ['label', 'descricao'],
    ['address', 'endereco'],
    ['w', 'largura_m'],
    ['h', 'altura_m'],
    ['d', 'profundidade_m'],
    ['weight', 'peso_kg'],
    ['stop', 'parada'],
    ['fragile', 'fragil'],
];

const csvCell = (v) => {
    let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
    if (typeof v === 'boolean') s = v ? 'sim' : 'nao';
    // Evita que planilhas interpretem o texto como fórmula.
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function itemsToCSV(items) {
    const header = CSV_COLUMNS.map(c => c[1]).join(';');
    const rows = items.map(it => CSV_COLUMNS.map(([key]) => csvCell(it[key])).join(';'));
    return '﻿' + [header, ...rows].join('\r\n');
}

function parseCSVRows(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    const src = text.replace(/^﻿/, '');
    const delim = (src.split(/\r?\n/)[0].match(/;/g)?.length ?? 0) >= (src.split(/\r?\n/)[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quoted) {
            if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === delim) { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && src[i + 1] === '\n') i++;
            row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** Lê itens de um CSV. Lança Error indicando a linha com problema. */
export function itemsFromCSV(text) {
    const rows = parseCSVRows(text);
    if (rows.length < 2) throw new Error('CSV vazio ou sem linhas de dados.');
    const header = rows[0].map(h => h.trim().toLowerCase());
    const index = Object.fromEntries(CSV_COLUMNS.map(([key, name]) => [key, header.indexOf(name)]));
    const missing = CSV_COLUMNS.filter(([key]) => key !== 'address' && key !== 'fragile' && index[key] < 0);
    if (missing.length) throw new Error(`Colunas ausentes: ${missing.map(m => m[1]).join(', ')}`);

    return rows.slice(1).map((r, n) => {
        const get = (k) => (index[k] >= 0 ? (r[index[k]] ?? '').trim().replace(/^'/, '') : '');
        const raw = {
            label: get('label'), address: get('address'),
            w: get('w'), h: get('h'), d: get('d'), weight: get('weight'), stop: get('stop'),
            fragile: /^(sim|s|true|1|x)$/i.test(get('fragile')),
        };
        const { value, errors } = validateItem(raw);
        if (!value) throw new Error(`Linha ${n + 2}: ${Object.entries(errors).map(([k, e]) => `${k} – ${e}`).join('; ')}`);
        const { quantity, ...item } = value;
        return { id: newId(), ...item };
    });
}
