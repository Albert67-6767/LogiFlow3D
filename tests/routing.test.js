import { describe, it, expect } from 'vitest';
import { haversine, decodePolyline, lengthInside, suggestOrder, addressKey, circlePolygon, thin } from '../src/core/geo.js';
import { summarizeEdges, riskExposure, evaluateLeg, evaluateRoute, legKey, profileFor } from '../src/core/routing.js';

// Linha reta para leste a partir de (0,0): 0,001° de longitude ≈ 111 m no equador.
const line = (n, step = 0.001) => Array.from({ length: n + 1 }, (_, i) => [0, i * step]);

const alt = (over = {}) => ({
    km: 5, min: 10, localKm: 0, shape: line(10),
    surface: { good: 5, fair: 0, bad: 0, unknown: 0 },
    segments: { bad: [], fair: [] }, streets: [], ...over,
});

describe('geo', () => {
    it('haversine mede distâncias conhecidas', () => {
        expect(haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111195, -2);
    });

    it('decodifica polyline com precisão 6 (Valhalla)', () => {
        // Exemplo oficial do formato (precisão 5)
        const pts = decodePolyline('_p~iF~ps|U_ulLnnqC', 5);
        expect(pts[0]).toEqual([38.5, -120.2]);
        expect(pts[1][0]).toBeCloseTo(40.7, 5);
    });

    it('mede quanto da linha passa dentro de uma área', () => {
        const area = { lat: 0, lon: 0.005, radius: 200 };
        const inside = lengthInside(line(10), area);
        expect(inside).toBeGreaterThan(350);
        expect(inside).toBeLessThan(450); // diâmetro = 400 m
        expect(lengthInside(line(10), { lat: 1, lon: 1, radius: 200 })).toBe(0);
    });

    it('normaliza endereços para a chave', () => {
        expect(addressKey('  Av. Paulista,  1000 - SÃO Paulo ')).toBe('av. paulista, 1000 - sao paulo');
    });

    it('gera polígono fechado e reduz pontos', () => {
        const ring = circlePolygon({ lat: -23.5, lon: -46.6, radius: 500 }, 12);
        expect(ring).toHaveLength(13);
        expect(ring[0]).toEqual(ring[12]);
        const t = thin(line(1000), 50);
        expect(t).toHaveLength(50);
        expect(t.at(-1)).toEqual(line(1000).at(-1));
    });

    it('sugere ordem por proximidade', () => {
        const start = { lat: 0, lon: 0 };
        const points = [{ lat: 0, lon: 0.03 }, { lat: 0, lon: 0.01 }, { lat: 0, lon: 0.02 }];
        expect(suggestOrder(start, points)).toEqual([1, 2, 0]);
    });
});

describe('routing', () => {
    it('resume piso, vias locais e trechos ruins', () => {
        const shape = line(4);
        const s = summarizeEdges([
            { length: 1, surface: 'paved_smooth', road_class: 'primary', names: ['Av A'], begin_shape_index: 0, end_shape_index: 1 },
            { length: 0.5, surface: 'gravel', road_class: 'residential', names: ['Rua B'], begin_shape_index: 1, end_shape_index: 2 },
            { length: 0.5, surface: 'dirt', road_class: 'residential', begin_shape_index: 2, end_shape_index: 3 },
            { length: 0.2, road_class: 'service_other', begin_shape_index: 3, end_shape_index: 4 },
        ], shape);
        expect(s.surface).toEqual({ good: 1, fair: 0, bad: 1, unknown: 0.2 });
        expect(s.localKm).toBeCloseTo(1.2);
        expect(s.streets[0]).toBe('Av A');
        expect(s.segments.bad).toHaveLength(1); // trechos ruins vizinhos são unidos
        expect(s.segments.bad[0]).toHaveLength(3);
    });

    it('calcula exposição ponderada pelo nível da área', () => {
        const areas = [{ id: 'a', name: 'Bairro X', lat: 0, lon: 0.005, radius: 200, level: 3 }];
        const r = riskExposure(line(10), areas);
        expect(r.areas[0].name).toBe('Bairro X');
        expect(r.weighted).toBeCloseTo(r.km * 5);
    });

    it('prefere caminho um pouco mais longo que evita área de risco e piso ruim', () => {
        const areas = [{ id: 'a', name: 'Bairro X', lat: 0, lon: 0.005, radius: 300, level: 3 }];
        const leg = {
            key: 'k',
            alternatives: [
                alt({ km: 5, min: 10, surface: { good: 4, fair: 0, bad: 1, unknown: 0 } }), // passa na área
                alt({ km: 5.6, min: 11, shape: line(10).map(([la, lo]) => [la + 0.02, lo]) }), // longe da área
            ],
        };
        const seguro = evaluateLeg(leg, areas, 'equilibrada', false);
        expect(seguro.chosen).toBe(1);
        expect(seguro.shortest).toBe(0);
        expect(seguro.notes[0]).toMatch(/evita Bairro X/);

        // Sem áreas e com piso igual, o mais curto vence.
        const plain = { key: 'k', alternatives: [alt({ km: 5 }), alt({ km: 5.6, min: 11 })] };
        expect(evaluateLeg(plain, [], 'curta', false).chosen).toBe(0);
    });

    it('respeita a escolha manual', () => {
        const leg = { key: 'k', alternatives: [alt({ km: 5 }), alt({ km: 8, min: 15 })] };
        const r = evaluateLeg(leg, [], 'equilibrada', false, 1);
        expect(r.chosen).toBe(1);
        expect(r.best).toBe(0);
        expect(r.manual).toBe(true);
    });

    it('avalia a rota completa e indica trechos faltando', () => {
        const depot = { lat: 0, lon: 0 }, p1 = { lat: 0, lon: 0.01 }, p2 = { lat: 0, lon: 0.02 };
        const plan = { legs: [{ key: legKey(depot, p1, 'auto'), alternatives: [alt()] }], choice: {} };

        const partial = evaluateRoute(plan, [depot, p1, p2], [], 'equilibrada', 'auto');
        expect(partial.status).toBe('partial');
        expect(partial.totals.km).toBe(5);

        const full = evaluateRoute({ ...plan, legs: [...plan.legs, { key: legKey(p1, p2, 'auto'), alternatives: [alt({ km: 3, min: 6 })] }] },
            [depot, p1, p2], [], 'equilibrada', 'auto');
        expect(full.status).toBe('ok');
        expect(full.totals.km).toBe(8);
        expect(full.totals.min).toBe(16);

        expect(evaluateRoute(null, [null, p1], [], 'equilibrada', 'auto').missing).toBe(1);
    });

    it('usa perfil de caminhão para veículos pesados', () => {
        expect(profileFor({ payload: 650 })).toBe('auto');
        expect(profileFor({ payload: 5000 })).toBe('truck');
    });
});
