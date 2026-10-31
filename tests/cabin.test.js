import { describe, it, expect } from 'vitest';
import { cabinStyle } from '../src/scene/cabin.js';
import { validateTruck, sanitizeFleet } from '../src/core/fleet.js';

const base = { name: 'Teste', w: 1.8, h: 1.8, d: 3, kmPerLiter: 9, fuel: 'diesel' };

describe('tipo de cabine', () => {
    it('automático escolhe pela carga máxima', () => {
        expect(cabinStyle({ ...base, payload: 650, cabin: 'auto' })).toBe('van');
        expect(cabinStyle({ ...base, payload: 1800 })).toBe('vuc');
        expect(cabinStyle({ ...base, payload: 5000, cabin: 'auto' })).toBe('caminhao');
    });

    it('respeita o tipo escolhido no cadastro', () => {
        expect(cabinStyle({ ...base, payload: 5000, cabin: 'sedan' })).toBe('sedan');
        expect(cabinStyle({ ...base, payload: 300, cabin: 'picape' })).toBe('picape');
    });

    it('tipo desconhecido ou ausente (arquivo antigo) vira automático', () => {
        expect(validateTruck({ ...base, payload: 900, cabin: 'foguete' }).value.cabin).toBe('auto');
        expect(sanitizeFleet({ a: { ...base, payload: 900 } }).a.cabin).toBe('auto');
        expect(validateTruck({ ...base, payload: 900, cabin: 'suv' }).value.cabin).toBe('suv');
    });
});
