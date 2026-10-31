import { BALANCE, CO2_PER_LITER } from '../config/constants.js';

const volumeOf = (i) => i.w * i.h * i.d;

/** Ocupação de volume e peso considerando todos os itens cadastrados. */
export function loadTotals(items, truck) {
    const truckVolume = truck.w * truck.h * truck.d;
    const volume = items.reduce((s, i) => s + volumeOf(i), 0);
    const weight = items.reduce((s, i) => s + Number(i.weight), 0);
    return {
        truckVolume,
        volume,
        weight,
        volumePct: (volume / truckVolume) * 100,
        weightPct: (weight / truck.payload) * 100,
        overVolume: volume > truckVolume,
        overWeight: weight > truck.payload,
    };
}

/**
 * Distribuição de peso por modelo de alavanca: cada caixa divide seu peso entre
 * frente/traseira (e esquerda/direita) proporcionalmente à posição do seu centro.
 */
export function weightDistribution(placed, truck) {
    const total = placed.reduce((s, p) => s + p.weight, 0);
    if (total <= 0) {
        return { total: 0, front: 50, rear: 50, left: 50, right: 50, imbalance: 0, axis: null, status: 'empty', cog: null };
    }

    let front = 0, left = 0, cx = 0, cy = 0, cz = 0;
    for (const p of placed) {
        const x = p.x + p.w / 2, y = p.y + p.h / 2, z = p.z + p.d / 2;
        front += p.weight * (1 - z / truck.d); // z=0 é a cabine (frente)
        left += p.weight * (1 - x / truck.w);
        cx += x * p.weight; cy += y * p.weight; cz += z * p.weight;
    }

    const frontPct = Math.round((front / total) * 100);
    const leftPct = Math.round((left / total) * 100);
    const longGap = Math.abs(2 * frontPct - 100);
    const latGap = Math.abs(2 * leftPct - 100);
    const level = (gap, lim) => (gap > lim.danger ? 2 : gap >= lim.warn ? 1 : 0);
    const longLevel = level(longGap, BALANCE.longitudinal);
    const latLevel = level(latGap, BALANCE.lateral);
    const axis = latLevel > 0 && latLevel >= longLevel ? 'lateral' : longLevel > 0 ? 'longitudinal' : null;
    const status = ['ok', 'warn', 'danger'][Math.max(longLevel, latLevel)];
    const imbalance = Math.max(longGap, latGap);

    return {
        total,
        front: frontPct, rear: 100 - frontPct,
        left: leftPct, right: 100 - leftPct,
        imbalance,
        axis,
        status,
        cog: { x: cx / total, y: cy / total, z: cz / total },
    };
}

/** Paradas agrupadas e ordenadas, com itens, peso e distância informada. */
export function groupStops(items, stopKm = {}) {
    const map = new Map();
    for (const it of items) {
        if (!map.has(it.stop)) map.set(it.stop, { stop: it.stop, items: [], weight: 0, volume: 0, address: '' });
        const g = map.get(it.stop);
        g.items.push(it);
        g.weight += Number(it.weight);
        g.volume += volumeOf(it);
        if (!g.address && it.address) g.address = it.address;
    }
    return [...map.values()]
        .sort((a, b) => a.stop - b.stop)
        .map(g => ({ ...g, km: Number(stopKm[g.stop]) || 0 }));
}

/** Custos da rota a partir dos km informados por parada. */
export function routeMetrics(stops, truck, settings) {
    const km = stops.reduce((s, g) => s + g.km, 0);
    const liters = km / truck.kmPerLiter;
    const cost = liters * settings.fuelPrice;
    const co2 = liters * (CO2_PER_LITER[truck.fuel] ?? CO2_PER_LITER.diesel);

    const baseline = Number(settings.baselineKm) > 0 ? Number(settings.baselineKm) : null;
    let savings = null;
    if (baseline !== null) {
        const savedKm = baseline - km;
        const savedLiters = savedKm / truck.kmPerLiter;
        savings = {
            km: savedKm,
            pct: (savedKm / baseline) * 100,
            liters: savedLiters,
            money: savedLiters * settings.fuelPrice,
            co2: savedLiters * (CO2_PER_LITER[truck.fuel] ?? CO2_PER_LITER.diesel),
        };
    }
    const min = stops.reduce((s, g) => s + (g.min || 0), 0);
    return { km, min, liters, cost, co2, savings, missingKm: stops.filter(s => !s.km).length };
}
