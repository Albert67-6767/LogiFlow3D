// Geometria simples sobre coordenadas { lat, lon }. Sem rede, sem tela (testável).

const R = 6371008.8; // raio médio da Terra (m)
const rad = (d) => (d * Math.PI) / 180;

/** Distância em metros entre dois pontos. */
export function haversine(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Chave estável para guardar a posição de um endereço. */
export const addressKey = (address) =>
    String(address ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Chave curta de uma coordenada (≈1 m de precisão). */
export const pointKey = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/** Decodifica polyline (formato Google; o Valhalla usa precisão 6). Retorna [[lat, lon], ...]. */
export function decodePolyline(str, precision = 6) {
    const factor = 10 ** precision;
    const out = [];
    let index = 0, lat = 0, lon = 0;
    while (index < str.length) {
        for (const which of [0, 1]) {
            let result = 0, shift = 0, byte;
            do {
                byte = str.charCodeAt(index++) - 63;
                result |= (byte & 0x1f) << shift;
                shift += 5;
            } while (byte >= 0x20);
            const delta = result & 1 ? ~(result >> 1) : result >> 1;
            if (which === 0) lat += delta; else lon += delta;
        }
        out.push([lat / factor, lon / factor]);
    }
    return out;
}

/** Comprimento (m) de uma linha [[lat, lon], ...]. */
export function lineLength(shape) {
    let total = 0;
    for (let i = 1; i < shape.length; i++) total += haversine(toPoint(shape[i - 1]), toPoint(shape[i]));
    return total;
}

const toPoint = ([lat, lon]) => ({ lat, lon });

export const insideArea = (p, area) => haversine(p, area) <= area.radius;

/**
 * Metros da linha que ficam dentro de uma área circular { lat, lon, radius }.
 * Trechos longos são subdivididos a cada ~25 m para medir a entrada e a saída.
 */
export function lengthInside(shape, area) {
    let inside = 0;
    for (let i = 1; i < shape.length; i++) {
        const a = toPoint(shape[i - 1]), b = toPoint(shape[i]);
        const len = haversine(a, b);
        if (len === 0) continue;
        // Descarta rápido: os dois extremos longe demais do círculo.
        if (haversine(a, area) > area.radius + len && haversine(b, area) > area.radius + len) continue;
        const steps = Math.max(1, Math.ceil(len / 25));
        for (let s = 0; s < steps; s++) {
            const t = (s + 0.5) / steps;
            const mid = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
            if (insideArea(mid, area)) inside += len / steps;
        }
    }
    return inside;
}

/** Aproxima um círculo por um polígono [[lon, lat], ...] (formato aceito pelo Valhalla). */
export function circlePolygon(area, sides = 16) {
    const ring = [];
    const dLat = (area.radius / R) * (180 / Math.PI);
    const dLon = dLat / Math.cos(rad(area.lat));
    for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * 2 * Math.PI;
        ring.push([+(area.lon + dLon * Math.cos(a)).toFixed(6), +(area.lat + dLat * Math.sin(a)).toFixed(6)]);
    }
    return ring;
}

/** Reduz o número de pontos mantendo início e fim (para salvar no navegador). */
export function thin(shape, maxPoints = 600) {
    if (shape.length <= maxPoints) return shape;
    const step = (shape.length - 1) / (maxPoints - 1);
    const out = [];
    for (let i = 0; i < maxPoints; i++) out.push(shape[Math.round(i * step)]);
    return out;
}

/**
 * Sugere a ordem de visita por proximidade (vizinho mais próximo + melhoria 2-opt),
 * partindo de `start`. Retorna os índices de `points` na nova ordem.
 * É uma estimativa em linha reta, não usa a malha viária.
 */
export function suggestOrder(start, points) {
    const n = points.length;
    if (n < 2) return points.map((_, i) => i);
    const all = [start, ...points];
    const dist = all.map(a => all.map(b => haversine(a, b)));

    // Vizinho mais próximo
    const order = [];
    const used = new Set();
    let current = 0;
    for (let k = 0; k < n; k++) {
        let best = -1;
        for (let j = 1; j <= n; j++) {
            if (!used.has(j) && (best < 0 || dist[current][j] < dist[current][best])) best = j;
        }
        used.add(best);
        order.push(best);
        current = best;
    }

    // 2-opt (caminho aberto: começa na base e termina na última parada)
    const path = [0, ...order];
    const cost = (p) => p.reduce((s, v, i) => (i ? s + dist[p[i - 1]][v] : 0), 0);
    let improved = true;
    while (improved) {
        improved = false;
        for (let i = 1; i < path.length - 1; i++) {
            for (let j = i + 1; j < path.length; j++) {
                const candidate = [...path.slice(0, i), ...path.slice(i, j + 1).reverse(), ...path.slice(j + 1)];
                if (cost(candidate) + 1e-6 < cost(path)) {
                    path.splice(0, path.length, ...candidate);
                    improved = true;
                }
            }
        }
    }
    return path.slice(1).map(v => v - 1);
}
