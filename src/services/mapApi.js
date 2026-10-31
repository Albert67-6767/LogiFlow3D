import { MAP_SERVICES } from '../config/constants.js';
import { decodePolyline, thin } from '../core/geo.js';
import { summarizeEdges } from '../core/routing.js';

/*
 * Acesso à rede (único lugar do app que chama serviços externos):
 *   - Nominatim: endereço → coordenada e bairro
 *   - Valhalla: caminhos alternativos + qualidade do piso de cada trecho
 * Ambos são gratuitos e baseados no OpenStreetMap; respeitamos ~1 chamada/s.
 */

const queues = new Map(); // host → promessa da última chamada

function throttled(host, fn) {
    const prev = queues.get(host) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
        const started = Date.now();
        try { return await fn(); }
        finally {
            const wait = MAP_SERVICES.minIntervalMs - (Date.now() - started);
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
        }
    });
    queues.set(host, next);
    return next;
}

async function request(url, options = {}, timeoutMs = 25000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: ctrl.signal });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            const err = new Error(body?.error || `Serviço respondeu ${res.status}`);
            err.status = res.status;
            err.code = body?.error_code;
            throw err;
        }
        return body;
    } catch (err) {
        if (err.name === 'AbortError') throw new Error('O serviço de mapas demorou demais para responder.');
        if (err instanceof TypeError) throw new Error('Sem conexão com o serviço de mapas.');
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

// ---------- Endereços ----------

/**
 * Procura um endereço no Brasil. Retorna { lat, lon, label, bairro } ou null.
 * Com `near` ({lat, lon}, normalmente a base), procura primeiro num raio de
 * ~50 km: "Rua Augusta - SP" existe em várias cidades do estado.
 */
export async function geocode(address, near = null) {
    if (near) {
        const d = 0.45; // ≈ 50 km
        const box = [near.lon - d, near.lat + d, near.lon + d, near.lat - d].map(v => v.toFixed(4)).join(',');
        const hit = await searchAddress(address, { viewbox: box, bounded: '1' });
        if (hit) return hit;
    }
    return searchAddress(address);
}

function searchAddress(address, extra = {}) {
    const params = new URLSearchParams({
        q: address, format: 'jsonv2', limit: '1', addressdetails: '1', countrycodes: 'br', 'accept-language': 'pt-BR', ...extra,
    });
    return throttled('nominatim', async () => {
        const list = await request(`${MAP_SERVICES.geocoding}/search?${params}`);
        const hit = list?.[0];
        if (!hit) return null;
        const a = hit.address ?? {};
        return {
            lat: +Number(hit.lat).toFixed(6),
            lon: +Number(hit.lon).toFixed(6),
            label: hit.display_name,
            bairro: a.suburb || a.neighbourhood || a.quarter || a.city_district || '',
            city: a.city || a.town || a.municipality || '',
        };
    });
}

// ---------- Caminhos ----------

const post = (path, body) => request(`${MAP_SERVICES.routing}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

/** Medidas externas aproximadas a partir do baú (o Valhalla evita vias incompatíveis). */
function truckOptions(truck) {
    return {
        truck: {
            height: +(truck.h + 1.1).toFixed(2),  // baú + chassi
            width: +(truck.w + 0.2).toFixed(2),
            length: +(truck.d + 2.5).toFixed(2),  // baú + cabine
            weight: +((truck.payload * 2) / 1000).toFixed(1), // peso bruto ≈ 2× a carga (t)
        },
    };
}

const round = ([lat, lon]) => [+lat.toFixed(5), +lon.toFixed(5)];

/** Manobras (curvas) com o índice convertido para a linha reduzida por thin(). */
function maneuversOf(leg, fullLength, maxPoints) {
    const step = fullLength > maxPoints ? (fullLength - 1) / (maxPoints - 1) : 1;
    return (leg.maneuvers ?? []).map(m => ({
        type: m.type,
        text: m.instruction,
        alert: m.verbal_transition_alert_instruction || m.verbal_pre_transition_instruction || m.instruction,
        street: m.street_names?.[0] ?? '',
        exit: m.roundabout_exit_count ?? null,
        s: Math.round(m.begin_shape_index / step),
        km: +Number(m.length).toFixed(3),
        min: +(Number(m.time) / 60).toFixed(2),
    }));
}

async function describeTrip(trip, profile, extra) {
    const leg = trip.legs[0];
    const full = decodePolyline(leg.shape, 6);
    const alt = {
        km: +leg.summary.length.toFixed(3),
        min: +(leg.summary.time / 60).toFixed(1),
        toll: !!leg.summary.has_toll,
        ...extra,
    };
    let summary;
    try {
        const attrs = await throttled('valhalla', () => post('/trace_attributes', {
            encoded_polyline: leg.shape,
            costing: profile,
            shape_match: 'edge_walk',
            filters: {
                attributes: ['edge.surface', 'edge.length', 'edge.road_class', 'edge.names', 'edge.begin_shape_index', 'edge.end_shape_index'],
                action: 'include',
            },
        }));
        summary = summarizeEdges(attrs.edges ?? [], full);
    } catch {
        // Sem detalhes do piso: o caminho continua válido, só sem avaliação de qualidade.
        summary = { surface: { good: 0, fair: 0, bad: 0, unknown: alt.km }, localKm: 0, streets: [], segments: { bad: [], fair: [] } };
    }
    return {
        ...alt,
        surface: summary.surface,
        localKm: +summary.localKm.toFixed(3),
        streets: summary.streets,
        shape: thin(full, 600).map(round),
        maneuvers: maneuversOf(leg, full.length, 600),
        segments: {
            bad: summary.segments.bad.map(s => thin(s, 120).map(round)),
            fair: summary.segments.fair.map(s => thin(s, 120).map(round)),
        },
    };
}

/**
 * Busca até 3 caminhos entre dois pontos. Com `avoid` (polígonos [[lon,lat],...]),
 * busca um único caminho que desvia dessas áreas.
 */
export async function fetchAlternatives(from, to, { profile = 'auto', truck, avoid = null, alternates = 2 } = {}) {
    const body = {
        locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
        costing: profile,
        directions_type: 'instructions', // curvas em português para a navegação
        language: 'pt-BR',
        units: 'kilometers',
        alternates: avoid ? 0 : alternates,
    };
    if (profile === 'truck' && truck) body.costing_options = truckOptions(truck);
    if (avoid?.length) body.exclude_polygons = avoid;

    const data = await throttled('valhalla', () => post('/route', body));
    const trips = [data.trip, ...(data.alternates ?? []).map(a => a.trip)].filter(Boolean);
    const out = [];
    for (const trip of trips) out.push(await describeTrip(trip, profile, { detour: !!avoid }));
    return out;
}
