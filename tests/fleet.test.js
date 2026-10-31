import { describe, it, expect } from 'vitest';
import { validateTruck, addTruck, updateTruck, removeTruck, sanitizeFleet, defaultFleet } from '../src/core/fleet.js';
import { exportProject, importProject } from '../src/core/io.js';
import { actions, getState, getDerived } from '../src/state/store.js';
import { SAMPLE_ITEMS } from '../src/config/constants.js';

const van = { name: 'Van Grande', w: '1,9', h: '1,8', d: '3,5', payload: '1500', kmPerLiter: '9', fuel: 'diesel' };

describe('regras da frota', () => {
    it('valida e normaliza (vírgula decimal)', () => {
        const { value } = validateTruck(van);
        expect(value).toEqual({ name: 'Van Grande', w: 1.9, h: 1.8, d: 3.5, payload: 1500, kmPerLiter: 9, fuel: 'diesel' });
    });

    it('aponta cada campo inválido', () => {
        const { value, errors } = validateTruck({ name: '', w: 0.1, h: 'x', d: 20, payload: 10, kmPerLiter: 0, fuel: 'etanol' });
        expect(value).toBeNull();
        expect(Object.keys(errors).sort()).toEqual(['d', 'fuel', 'h', 'kmPerLiter', 'name', 'payload', 'w']);
    });

    it('não aceita nome repetido, exceto o próprio veículo ao editar', () => {
        const fleet = defaultFleet();
        expect(validateTruck({ ...van, name: 'baú toco' }, fleet).errors.name).toMatch(/Já existe/);
        expect(() => updateTruck(fleet, 'toco', { payload: 6000 })).not.toThrow();
    });

    it('adiciona, atualiza e remove sem alterar o objeto original', () => {
        const fleet = defaultFleet();
        const added = addTruck(fleet, 'v1', van);
        expect(Object.keys(added)).toEqual(['fiorino', 'hr', 'toco', 'v1']);
        expect(fleet.v1).toBeUndefined();
        expect(updateTruck(added, 'v1', { payload: 1600 }).v1.payload).toBe(1600);
        expect(Object.keys(removeTruck(added, 'hr'))).toEqual(['fiorino', 'toco', 'v1']);
    });

    it('não deixa a frota vazia e rejeita id inexistente', () => {
        expect(() => removeTruck({ a: van }, 'a')).toThrow(/pelo menos um/);
        expect(() => removeTruck(defaultFleet(), 'x')).toThrow(/não encontrado/);
        expect(() => addTruck({}, 'v', { ...van, w: 0 })).toThrow();
    });

    it('frota corrompida volta ao padrão; veículos inválidos são descartados', () => {
        expect(sanitizeFleet(null)).toEqual(defaultFleet());
        expect(Object.keys(sanitizeFleet({ ok: van, ruim: { name: 'x' } }))).toEqual(['ok']);
    });
});

describe('ações do estado', () => {
    it('adicionar seleciona o novo veículo e o encaixe usa as medidas dele', () => {
        const id = actions.addTruck(van);
        expect(getState().truckKey).toBe(id);
        expect(getDerived().truck.name).toBe('Van Grande');
        actions.updateTruck(id, { d: 1 });
        expect(getDerived().truck.d).toBe(1);
        expect(getDerived().packing.placed.every(p => p.z + p.d <= 1 + 1e-6)).toBe(true);
    });

    it('remover o selecionado troca de veículo e desfazer restaura posição e seleção', () => {
        const id = getState().truckKey;
        const order = Object.keys(getState().trucks);
        const undo = actions.removeTruck(id);
        expect(getState().trucks[id]).toBeUndefined();
        expect(getState().truckKey).toBe(order.find(k => k !== id));
        undo();
        expect(Object.keys(getState().trucks)).toEqual(order);
        expect(getState().truckKey).toBe(id);
    });

    it('dados inválidos não alteram o estado', () => {
        const before = getState().trucks;
        expect(() => actions.addTruck({ ...van, name: '' })).toThrow();
        expect(getState().trucks).toBe(before);
    });
});

describe('projeto JSON com frota', () => {
    it('exporta e importa a frota personalizada', () => {
        const trucks = addTruck(defaultFleet(), 'v1', van);
        const back = importProject(exportProject({ trucks, truckKey: 'v1', items: SAMPLE_ITEMS, stopKm: {}, settings: {} }));
        expect(back.trucks.v1.name).toBe('Van Grande');
        expect(back.truckKey).toBe('v1');
    });

    it('arquivo antigo sem frota usa a frota padrão', () => {
        const old = JSON.stringify({ schema: 'logiflow3d', version: 2, truckKey: 'toco', items: SAMPLE_ITEMS });
        const back = importProject(old);
        expect(back.trucks).toEqual(defaultFleet());
        expect(back.truckKey).toBe('toco');
    });
});
