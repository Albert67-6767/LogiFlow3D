import { describe, it, expect } from 'vitest';
import { buildNav, snap, progress, timeAt, pointAt, spokenDistance, tidy, driveTimeFactor } from '../src/core/navigation.js';

// Trecho reto para leste: 11 pontos a cada 0,001° (~111 m), ~1,1 km no total.
const line = (lat0, lon0, n = 10) => Array.from({ length: n + 1 }, (_, i) => [lat0, lon0 + i * 0.001]);
const alt = (shape, min = 2) => ({
    shape, km: 1.1, min,
    maneuvers: [
        { type: 1, text: 'Siga para leste.', s: 0, min: min / 2 },
        { type: 10, text: 'Vire à direita para Rua B.', alert: 'Vire à direita.', s: 5, min: min / 2 },
        { type: 5, text: 'O seu destino fica à direita.', s: shape.length - 1, min: 0 },
    ],
});
const stops = [
    { stop: 1, address: 'Rua A', point: { lat: 0, lon: 0.01 }, items: [] },
    { stop: 2, address: 'Rua C', point: { lat: 0, lon: 0.02 }, items: [] },
];

describe('navegação', () => {
    const nav = buildNav([alt(line(0, 0)), alt(line(0, 0.01))], stops, 1);

    it('junta os trechos com distâncias e tempos acumulados', () => {
        expect(nav.legs).toHaveLength(2);
        expect(nav.totalM).toBeGreaterThan(2200);
        expect(nav.totalS).toBeCloseTo(240);
        expect(nav.legs[0].endTime).toBeCloseTo(120);
        expect(nav.maneuvers).toHaveLength(6);
        expect(timeAt(nav, nav.legs[0].endDist)).toBeCloseTo(120);
    });

    it('encaixa a posição na linha e mede o desvio', () => {
        const s = snap(nav, { lat: 0.0003, lon: 0.0025 }, 0); // ~33 m ao norte da linha
        expect(s.along).toBeGreaterThan(270);
        expect(s.along).toBeLessThan(290);
        expect(s.offset).toBeGreaterThan(30);
        expect(s.offset).toBeLessThan(36);
    });

    it('indica a próxima manobra, a distância e a chegada', () => {
        const now = Date.UTC(2026, 0, 1, 12, 0);
        const p = progress(nav, 300, 0, now, 15);
        expect(p.next.text).toBe('Vire à direita para Rua B.');
        expect(p.toNextM).toBeGreaterThan(250);
        expect(p.after.type).toBe(5);
        expect(p.arrived).toBe(false);
        // parada 2 = tempo restante do trecho 1 + trecho 2 + 15 min de descarga na parada 1
        expect((p.etas[1].at - now) / 60000).toBeCloseTo((240 - timeAt(nav, 300)) / 60 + 15, 1);

        const end = progress(nav, nav.legs[0].endDist - 10, 0, now);
        expect(end.arrived).toBe(true);
        expect(end.isLastLeg).toBe(false);
    });

    it('calcula pontos ao longo da rota (simulação)', () => {
        const [lat, lon] = pointAt(nav, 555);
        expect(lat).toBeCloseTo(0);
        expect(lon).toBeCloseTo(0.005, 3);
    });

    it('formata distâncias e textos', () => {
        expect(spokenDistance(320)).toBe('300 m');
        expect(spokenDistance(1260)).toBe('1,3 km');
        expect(tidy('Vire à direita. Então, Vire à esquerda.')).toBe('Vire à direita. Então, vire à esquerda.');
    });

    it('ajusta o tempo conforme o veículo', () => {
        expect(driveTimeFactor({ payload: 5000 }, 'truck')).toBe(1);
        expect(driveTimeFactor({ payload: 1800 }, 'auto')).toBeGreaterThan(driveTimeFactor({ payload: 650 }, 'auto'));
    });

    it('funciona sem instruções do serviço (rota antiga)', () => {
        const n = buildNav([{ shape: line(0, 0), km: 1.1, min: 2 }], [stops[0]], 1);
        expect(n.maneuvers.map(m => m.type)).toEqual([1, 4]);
    });
});
