import { PRIORITIES, RISK_LEVELS, HEAVY_PAYLOAD } from '../config/constants.js';
import { lengthInside, pointKey } from './geo.js';

/*
 * Avalia caminhos alternativos de cada trecho e escolhe o melhor considerando
 * distância, tempo, qualidade do piso, ruas estreitas e áreas de atenção.
 * Tudo puro: os dados chegam prontos de services/mapApi.js.
 */

/** Qualidade do piso informada pelo Valhalla (OpenStreetMap). */
export const SURFACE_QUALITY = {
    paved_smooth: 'good',
    paved: 'good',
    paved_rough: 'fair',
    compacted: 'fair',
    dirt: 'bad',
    gravel: 'bad',
    path: 'bad',
    impassable: 'bad',
};

/** Vias locais/estreitas: pior para veículos grandes. */
export const LOCAL_ROADS = new Set(['residential', 'service_other', 'unclassified', 'living_street']);

export const QUALITY_LABELS = { good: 'Asfalto bom', fair: 'Irregular', bad: 'Terra/cascalho', unknown: 'Sem dado' };

/** Perfil de roteamento conforme o veículo. */
export const profileFor = (truck) => (truck.payload >= HEAVY_PAYLOAD ? 'truck' : 'auto');

export const legKey = (from, to, profile) => `${pointKey(from)}>${pointKey(to)}|${profile}`;

/**
 * Resume as arestas do trace_attributes em km por qualidade, km em vias locais,
 * ruas principais e os trechos ruins/irregulares (para desenhar no mapa).
 */
export function summarizeEdges(edges, shape) {
    const surface = { good: 0, fair: 0, bad: 0, unknown: 0 };
    let localKm = 0;
    const streetKm = new Map();
    const segments = { bad: [], fair: [] };
    let open = null; // trecho contínuo da mesma qualidade (ruim ou irregular)

    for (const e of edges) {
        const km = Number(e.length) || 0;
        const q = SURFACE_QUALITY[e.surface] ?? 'unknown';
        surface[q] += km;
        if (LOCAL_ROADS.has(e.road_class)) localKm += km;
        const name = e.names?.[0];
        if (name) streetKm.set(name, (streetKm.get(name) ?? 0) + km);

        const b = e.begin_shape_index, f = e.end_shape_index;
        if ((q === 'bad' || q === 'fair') && Number.isInteger(b) && Number.isInteger(f)) {
            if (open && open.q === q && open.end >= b) open.end = f;
            else {
                if (open) segments[open.q].push(shape.slice(open.start, open.end + 1));
                open = { q, start: b, end: f };
            }
        } else if (open) {
            segments[open.q].push(shape.slice(open.start, open.end + 1));
            open = null;
        }
    }
    if (open) segments[open.q].push(shape.slice(open.start, open.end + 1));

    const streets = [...streetKm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n);
    return { surface, localKm, streets, segments };
}

/** Quanto do caminho passa por cada área de atenção. */
export function riskExposure(shape, areas) {
    const hits = [];
    let km = 0, weighted = 0;
    for (const area of areas) {
        const inside = lengthInside(shape, area) / 1000;
        if (inside < 0.02) continue; // ignora raspões (< 20 m)
        const level = RISK_LEVELS[area.level] ?? RISK_LEVELS[1];
        hits.push({ id: area.id, name: area.name, level: area.level, km: inside });
        km += inside;
        weighted += inside * level.weight;
    }
    hits.sort((a, b) => b.level - a.level || b.km - a.km);
    return { km, weighted, areas: hits };
}

/**
 * Pontuação em "km equivalentes" (menor é melhor):
 * base (distância + tempo) + piso ruim/irregular + vias locais + áreas de atenção,
 * cada parte multiplicada pelo peso da prioridade escolhida.
 */
export function scoreAlternative(alt, risk, priorityKey = 'equilibrada', heavy = false) {
    const w = PRIORITIES[priorityKey] ?? PRIORITIES.equilibrada;
    const s = alt.surface ?? { bad: 0, fair: 0 };
    const parts = {
        base: alt.km * 0.6 + alt.min * 0.2, // 1 min ≈ 0,5 km rodando a 30 km/h
        quality: w.quality * (s.bad * 2 + s.fair * 0.5),
        local: w.local * (alt.localKm ?? 0) * (heavy ? 2 : 1),
        risk: w.risk * risk.weighted,
    };
    return { score: parts.base + parts.quality + parts.local + parts.risk, parts };
}

/** Avalia as alternativas de um trecho e escolhe a melhor (ou a escolhida pelo usuário). */
export function evaluateLeg(leg, areas, priorityKey, heavy, choice = null) {
    const alternatives = leg.alternatives.map((alt, index) => {
        const risk = riskExposure(alt.shape, areas);
        return { ...alt, index, risk, ...scoreAlternative(alt, risk, priorityKey, heavy) };
    });
    if (!alternatives.length) return { ...leg, alternatives, best: -1, chosen: -1, manual: false, notes: [] };

    const best = alternatives.reduce((b, a) => (a.score < alternatives[b].score ? a.index : b), 0);
    const manual = Number.isInteger(choice) && choice >= 0 && choice < alternatives.length;
    const chosen = manual ? choice : best;
    const shortest = alternatives.reduce((b, a) => (a.km < alternatives[b].km ? a.index : b), 0);
    return { ...leg, alternatives, best, chosen, manual, shortest, notes: explain(alternatives[chosen], alternatives[shortest]) };
}

/** Frases curtas explicando o caminho escolhido em comparação ao mais curto. */
export function explain(chosen, shortest) {
    const notes = [];
    const total = (s) => s.good + s.fair + s.bad + s.unknown;
    if (chosen.index !== shortest.index) {
        const extra = chosen.km - shortest.km;
        const reasons = [];
        if (shortest.risk.weighted - chosen.risk.weighted > 0.05) {
            const avoided = shortest.risk.areas.filter(a => !chosen.risk.areas.some(c => c.id === a.id)).map(a => a.name);
            reasons.push(avoided.length ? `evita ${avoided.join(', ')}` : 'passa menos por áreas de atenção');
        }
        if (shortest.surface.bad - chosen.surface.bad > 0.05) reasons.push('evita trecho sem asfalto');
        else if (shortest.surface.fair - chosen.surface.fair > 0.1) reasons.push('tem piso melhor');
        if (shortest.localKm - chosen.localKm > 0.2) reasons.push('usa menos ruas estreitas');
        if (chosen.min < shortest.min - 0.5) reasons.push('é mais rápido');
        notes.push(`${extra >= 0.05 ? `+${extra.toFixed(1).replace('.', ',')} km que o mais curto` : 'Mesma distância do mais curto'}${reasons.length ? `: ${reasons.join(', ')}` : ''}.`);
    }
    if (chosen.surface.bad >= 0.05) notes.push(`${chosen.surface.bad.toFixed(1).replace('.', ',')} km sem asfalto (terra/cascalho).`);
    if (chosen.risk.areas.length) notes.push(`Passa por: ${chosen.risk.areas.map(a => a.name).join(', ')}.`);
    if (total(chosen.surface) > 0 && chosen.surface.unknown / total(chosen.surface) > 0.5) notes.push('Piso sem informação na maior parte do trajeto.');
    return notes;
}

/**
 * Avalia a rota inteira (base → paradas). `waypoints` traz a base e as paradas
 * em ordem, cada uma com { lat, lon } ou null se ainda não localizada.
 */
export function evaluateRoute(plan, waypoints, areas, priorityKey, profile) {
    const heavy = profile === 'truck';
    const missing = waypoints.filter(w => !w).length;
    const legs = [];
    let ready = 0;
    const byKey = new Map((plan?.legs ?? []).map(l => [l.key, l]));

    for (let i = 1; i < waypoints.length; i++) {
        const from = waypoints[i - 1], to = waypoints[i];
        if (!from || !to) { legs.push(null); continue; }
        const key = legKey(from, to, profile);
        const leg = byKey.get(key);
        if (!leg || !leg.alternatives?.length) { legs.push(leg?.error ? { key, error: leg.error } : null); continue; }
        legs.push(evaluateLeg(leg, areas, priorityKey, heavy, plan.choice?.[key]));
        ready++;
    }

    const totals = { km: 0, min: 0, good: 0, fair: 0, bad: 0, unknown: 0, riskKm: 0, areas: new Set() };
    for (const leg of legs) {
        if (!leg?.alternatives) continue;
        const alt = leg.alternatives[leg.chosen];
        totals.km += alt.km;
        totals.min += alt.min;
        for (const q of ['good', 'fair', 'bad', 'unknown']) totals[q] += alt.surface?.[q] ?? 0;
        totals.riskKm += alt.risk.km;
        alt.risk.areas.forEach(a => totals.areas.add(a.name));
    }

    const needed = waypoints.length - 1;
    const status = needed <= 0 ? 'empty' : ready === needed ? 'ok' : ready === 0 ? 'none' : 'partial';
    return { status, legs, totals: { ...totals, areas: [...totals.areas] }, missing };
}
