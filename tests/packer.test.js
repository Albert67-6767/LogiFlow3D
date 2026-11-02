import { describe, it, expect } from 'vitest';
import { packCargo, findCollisions } from '../src/core/packer.js';
import { DEFAULT_TRUCKS, SAMPLE_ITEMS } from '../src/config/constants.js';

const item = (id, stop, w, h, d, weight, extra = {}) => ({ id, stop, w, h, d, weight, ...extra });

/** Verifica se alguma caixa de parada posterior fica entre a caixa e a porta. */
function lifoViolations(placed) {
    const out = [];
    for (const a of placed) for (const b of placed) {
        if (b.stop > a.stop && b.z >= a.z + a.d - 1e-6 &&
            Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 &&
            Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6) out.push(`${b.id} bloqueia ${a.id}`);
    }
    return out;
}

describe('packCargo', () => {
    it('carrega a amostra sem colisões e sem violar LIFO', () => {
        const truck = DEFAULT_TRUCKS.hr;
        const { placed, unplaced } = packCargo(SAMPLE_ITEMS, truck);
        expect(unplaced).toEqual([]);
        expect(findCollisions(placed, truck)).toEqual([]);
        expect(lifoViolations(placed)).toEqual([]);
    });

    it('nunca sobrepõe caixas quando a carga excede o baú', () => {
        const truck = DEFAULT_TRUCKS.fiorino;
        const items = Array.from({ length: 40 }, (_, i) => item(`b${i}`, (i % 5) + 1, 0.6, 0.5, 0.6, 10));
        const { placed, unplaced } = packCargo(items, truck);
        expect(findCollisions(placed, truck)).toEqual([]);
        expect(lifoViolations(placed)).toEqual([]);
        expect(placed.length + unplaced.length).toBe(40);
        expect(unplaced.length).toBeGreaterThan(0);
        expect(unplaced.every(u => u.reason === 'espaco')).toBe(true);
    });

    it('última parada fica mais perto da cabine que a primeira', () => {
        const truck = DEFAULT_TRUCKS.toco;
        const items = [item('first', 1, 1, 1, 1, 50), item('last', 3, 1, 1, 1, 50), item('mid', 2, 1, 1, 1, 50)];
        const { placed } = packCargo(items, truck);
        const z = Object.fromEntries(placed.map(p => [p.id, p.z]));
        expect(z.last).toBeLessThanOrEqual(z.mid);
        expect(z.mid).toBeLessThanOrEqual(z.first);
    });

    it('recusa itens maiores que o baú e acima da carga máxima', () => {
        const truck = DEFAULT_TRUCKS.fiorino;
        const { placed, unplaced } = packCargo([
            item('grande', 1, 3, 1, 3, 10),
            item('pesado', 1, 0.5, 0.5, 0.5, 700),
            item('ok', 1, 0.5, 0.5, 0.5, 10),
        ], truck);
        expect(placed.map(p => p.id)).toEqual(['ok']);
        expect(unplaced).toEqual(expect.arrayContaining([
            { id: 'grande', reason: 'dimensoes' },
            { id: 'pesado', reason: 'peso' },
        ]));
    });

    it('gira a caixa no piso quando só cabe girada', () => {
        const truck = { w: 1, h: 1, d: 3, payload: 1000 };
        const { placed } = packCargo([item('longo', 1, 2.5, 0.5, 0.8, 10)], truck);
        expect(placed[0]).toMatchObject({ rotated: true, w: 0.8, d: 2.5 });
    });

    it('não empilha sobre item frágil nem item pesado sobre leve', () => {
        const truck = { w: 1, h: 2, d: 1, payload: 1000 };
        const fragil = packCargo([item('base', 2, 1, 0.5, 1, 100, { fragile: true }), item('topo', 1, 1, 0.5, 1, 10)], truck);
        expect(fragil.placed.map(p => p.id)).toEqual(['base']);

        const pesado = packCargo([item('leve', 2, 1, 0.5, 1, 10), item('pesado', 1, 1, 0.5, 1, 100)], truck);
        expect(pesado.placed.map(p => p.id)).toEqual(['leve']);

        const ok = packCargo([item('base', 2, 1, 0.5, 1, 100), item('topo', 1, 1, 0.5, 1, 10)], truck);
        expect(ok.placed.find(p => p.id === 'topo').y).toBeCloseTo(0.5);
    });

    it('aproveita o piso: amostra + 6 pallets cabem no HR', () => {
        const pallets = Array.from({ length: 6 }, (_, i) => item(`p${i}`, 4, 1.2, 0.5, 0.8, 50));
        const truck = DEFAULT_TRUCKS.hr;
        const { placed, unplaced } = packCargo([...SAMPLE_ITEMS, ...pallets], truck);
        expect(unplaced).toEqual([]);
        expect(findCollisions(placed, truck)).toEqual([]);
        expect(lifoViolations(placed)).toEqual([]);
    });

    it('resolve 150 itens em tempo aceitável', () => {
        const items = Array.from({ length: 150 }, (_, i) =>
            item(`m${i}`, (i % 8) + 1, 0.3 + (i % 5) * 0.1, 0.3 + (i % 3) * 0.1, 0.4 + (i % 4) * 0.1, 5 + (i % 7) * 4));
        const t0 = performance.now();
        const { placed } = packCargo(items, DEFAULT_TRUCKS.toco);
        const ms = performance.now() - t0;
        expect(findCollisions(placed, DEFAULT_TRUCKS.toco)).toEqual([]);
        expect(lifoViolations(placed)).toEqual([]);
        expect(ms).toBeLessThan(3000);
    });

    it('não deixa caixa flutuando sem apoio suficiente', () => {
        const truck = { w: 2, h: 2, d: 1, payload: 1000 };
        const { placed } = packCargo([item('base', 2, 0.5, 0.5, 1, 100), item('largo', 1, 2, 0.5, 1, 10)], truck);
        expect(placed.find(p => p.id === 'largo')).toBeUndefined();
    });
});

describe('arrumação manual', async () => {
    const { dropBox, boxOnTop, snapXZ, lifoIssues, turned, layoutSignature } = await import('../src/core/manualLayout.js');
    const truck = { w: 2, h: 2, d: 4, payload: 5000 };
    const base = { id: 'a', x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, weight: 100, stop: 1, fragile: false };

    it('cai sobre a caixa de baixo quando tem apoio', () => {
        const top = { id: 'b', w: 1, h: 0.5, d: 1, weight: 50, stop: 1 };
        const r = dropBox(top, 0, 0, [base], truck);
        expect(r.ok).toBe(true);
        expect(r.y).toBe(1);
    });

    it('recusa sem apoio, sobre frágil, mais pesada ou sem altura', () => {
        expect(dropBox({ id: 'b', w: 1, h: 0.5, d: 1, weight: 50 }, 0.6, 0, [base], truck).ok).toBe(false); // 40% apoiada
        expect(dropBox({ id: 'b', w: 1, h: 0.5, d: 1, weight: 50 }, 0, 0, [{ ...base, fragile: true }], truck).problem).toMatch(/frágil/);
        expect(dropBox({ id: 'b', w: 1, h: 0.5, d: 1, weight: 500 }, 0, 0, [base], truck).problem).toMatch(/pesada/);
        expect(dropBox({ id: 'b', w: 1, h: 1.5, d: 1, weight: 50 }, 0, 0, [base], truck).problem).toMatch(/altura/);
    });

    it('não deixa sair do baú e gruda nas bordas', () => {
        const r = dropBox({ id: 'b', w: 1, h: 1, d: 1, weight: 50 }, 5, -3, [], truck);
        expect([r.x, r.z]).toEqual([1, 0]);
        const s = snapXZ(1.05, 0.04, { id: 'b', w: 0.5, d: 0.5 }, [base], truck);
        expect(s.x).toBeCloseTo(1.02); // encosta na vizinha (com folga)
        expect(s.z).toBe(0);
    });

    it('detecta caixa em cima, giro e quebra da regra LIFO', () => {
        const top = { ...base, id: 'b', y: 1 };
        expect(boxOnTop(base, [base, top])?.id).toBe('b');
        expect(turned({ w: 1, d: 2, rotated: false })).toMatchObject({ w: 2, d: 1, rotated: true });
        const later = { ...base, id: 'c', z: 2, stop: 3 };
        expect(lifoIssues([base, later])).toHaveLength(1);
        expect(lifoIssues([{ ...base, stop: 3 }, { ...later, stop: 1 }])).toHaveLength(0);
    });

    it('assinatura muda quando a carga muda', () => {
        const items = [{ id: 'a', w: 1, h: 1, d: 1, weight: 100, stop: 1 }];
        expect(layoutSignature(items, truck)).not.toBe(layoutSignature([{ ...items[0], weight: 90 }], truck));
    });
});
