import { describe, it, expect } from 'vitest';
import { weightDistribution, loadTotals, groupStops, routeMetrics } from '../src/core/metrics.js';
import { validateItem } from '../src/core/validation.js';
import { itemsToCSV, itemsFromCSV, exportProject, importProject } from '../src/core/io.js';
import { DEFAULT_TRUCKS, SAMPLE_ITEMS } from '../src/config/constants.js';

const truck = { w: 2, h: 2, d: 4, payload: 1000, kmPerLiter: 8, fuel: 'diesel' };

describe('weightDistribution', () => {
    it('caixa centralizada fica 50/50', () => {
        const r = weightDistribution([{ x: 0.5, y: 0, z: 1.5, w: 1, h: 1, d: 1, weight: 100 }], truck);
        expect(r).toMatchObject({ front: 50, rear: 50, left: 50, right: 50, status: 'ok' });
        expect(r.cog).toEqual({ x: 1, y: 0.5, z: 2 });
    });

    it('caixa junto à cabine e à esquerda gera alerta', () => {
        const r = weightDistribution([{ x: 0, y: 0, z: 0, w: 0.5, h: 1, d: 0.5, weight: 100 }], truck);
        expect(r.front).toBeGreaterThan(90);
        expect(r.left).toBeGreaterThan(80);
        expect(r.status).toBe('danger');
        expect(r.axis).toBe('lateral');
    });

    it('mais peso junto à cabine é o certo: não gera alerta', () => {
        const r = weightDistribution([{ x: 0.5, y: 0, z: 0.7, w: 1, h: 1, d: 1, weight: 100 }], truck);
        expect(r.front).toBe(70); // centro em z=1,2 de 4 m → 1 - 1,2/4 = 70% na frente
        expect(r).toMatchObject({ status: 'ok', axis: null });
    });

    it('traseira pesada gera atenção e, se muito, perigo', () => {
        const warn = weightDistribution([{ x: 0.5, y: 0, z: 1.8, w: 1, h: 1, d: 1, weight: 100 }], truck);
        expect(warn.rear).toBe(57); // centro em z=2,3 → 42,5% na frente (arredonda 43) → 57% atrás
        expect(warn).toMatchObject({ status: 'warn', axis: 'longitudinal' });
        const danger = weightDistribution([{ x: 0.5, y: 0, z: 2.8, w: 1, h: 1, d: 1, weight: 100 }], truck);
        expect(danger.rear).toBeGreaterThan(65);
        expect(danger).toMatchObject({ status: 'danger', axis: 'longitudinal' });
    });

    it('quase tudo colado na cabine só pede para conferir o eixo dianteiro', () => {
        const r = weightDistribution([{ x: 0.5, y: 0, z: 0, w: 1, h: 1, d: 0.5, weight: 100 }], truck);
        expect(r.front).toBeGreaterThan(85);
        expect(r).toMatchObject({ status: 'warn', axis: 'longitudinal' });
    });

    it('baú vazio', () => {
        expect(weightDistribution([], truck).status).toBe('empty');
    });
});

describe('totais e rota', () => {
    it('sinaliza excesso de peso e volume sem limitar a 100%', () => {
        const t = loadTotals([{ w: 2, h: 2, d: 4, weight: 900 }, { w: 1, h: 1, d: 1, weight: 200 }], truck);
        expect(t.volumePct).toBeCloseTo(106.25);
        expect(t.overVolume).toBe(true);
        expect(t.overWeight).toBe(true);
    });

    it('calcula custo e economia a partir dos km informados', () => {
        const stops = groupStops(SAMPLE_ITEMS, { 1: 10, 2: 6 });
        expect(stops.map(s => s.stop)).toEqual([1, 2, 3, 4]);
        const r = routeMetrics(stops, truck, { fuelPrice: 6, baselineKm: 20 });
        expect(r.km).toBe(16);
        expect(r.liters).toBe(2);
        expect(r.cost).toBe(12);
        expect(r.missingKm).toBe(2);
        expect(r.savings.km).toBe(4);
        expect(r.savings.pct).toBe(20);
    });
});

describe('validação', () => {
    it('aceita vírgula decimal e rejeita valores inválidos', () => {
        expect(validateItem({ label: 'A', w: '0,45', h: '1', d: '1', weight: '10', stop: '2' }).value.w).toBe(0.45);
        const { errors } = validateItem({ label: '', w: -1, h: 0, d: 1, weight: 0, stop: 1.5 });
        expect(Object.keys(errors).sort()).toEqual(['h', 'label', 'stop', 'w', 'weight']);
    });

    it('avisa quando o item não cabe no veículo', () => {
        expect(validateItem({ label: 'A', w: 3, h: 1, d: 3, weight: 1, stop: 1 }, DEFAULT_TRUCKS.fiorino).warnings.length).toBe(1);
    });
});

describe('importação e exportação', () => {
    it('CSV ida e volta preserva os itens', () => {
        const items = itemsFromCSV(itemsToCSV(SAMPLE_ITEMS));
        expect(items.map(({ id, ...rest }) => rest)).toEqual(SAMPLE_ITEMS.map(({ id, ...rest }) => rest));
    });

    it('CSV protege contra fórmulas e aspas', () => {
        const csv = itemsToCSV([{ ...SAMPLE_ITEMS[0], label: '=HYPERLINK("x")' }]);
        expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
        expect(itemsFromCSV(csv)[0].label).toBe('=HYPERLINK("x")');
    });

    it('CSV com erro indica a linha', () => {
        expect(() => itemsFromCSV('descricao;largura_m;altura_m;profundidade_m;peso_kg;parada\nA;1;1;1;-5;1')).toThrow(/Linha 2/);
    });

    it('JSON ida e volta e rejeição de arquivo estranho', () => {
        const state = { truckKey: 'toco', items: SAMPLE_ITEMS, stopKm: { 1: 5 }, settings: { fuelPrice: 6 } };
        const back = importProject(exportProject(state));
        expect(back.truckKey).toBe('toco');
        expect(back.items).toHaveLength(4);
        expect(() => importProject('{"foo":1}')).toThrow();
    });
});
