import { describe, it, expect } from 'vitest';
import { validateProduct, findByCode, generateCode, sanitizeProducts, normalizeCode, itemFromProduct } from '../src/core/products.js';
import { exportProject, importProject } from '../src/core/io.js';
import { actions, getState } from '../src/state/store.js';

const raw = { code: ' 7891234567895 ', name: 'Caixa de som', w: '0,4', h: '0,5', d: '0,3', weight: '12,5', fragile: true };

describe('cadastro de produtos', () => {
    it('valida e normaliza (código sem espaços, vírgula decimal)', () => {
        const { value } = validateProduct(raw);
        expect(value).toEqual({ code: '7891234567895', name: 'Caixa de som', w: 0.4, h: 0.5, d: 0.3, weight: 12.5, fragile: true });
    });

    it('aponta campos inválidos', () => {
        const { value, errors } = validateProduct({ code: 'ab cd', name: '', w: 0, h: 'x', d: 20, weight: -1 });
        expect(value).toBeNull();
        expect(Object.keys(errors).sort()).toEqual(['code', 'd', 'h', 'name', 'w', 'weight']);
        expect(validateProduct({ ...raw, code: '' }).errors.code).toMatch(/código/);
    });

    it('não aceita código repetido, exceto o próprio produto ao editar', () => {
        const products = { a: validateProduct(raw).value };
        expect(validateProduct({ ...raw, code: '7891234567895', name: 'Outro' }, products).errors.code).toMatch(/já cadastrado/);
        expect(validateProduct({ ...raw, name: 'Novo nome' }, products, 'a').value.name).toBe('Novo nome');
    });

    it('busca por código ignorando maiúsculas e espaços', () => {
        const products = { a: { ...validateProduct(raw).value }, b: { ...validateProduct({ ...raw, code: 'lf-1' }).value } };
        expect(findByCode(products, 'LF-1 ')[0]).toBe('b');
        expect(findByCode(products, ' lf-1')[0]).toBe('b');
        expect(findByCode(products, 'nada')).toBeNull();
        expect(normalizeCode(' abc ')).toBe('ABC');
    });

    it('gera código interno sem repetir', () => {
        const values = [0.5, 0.5, 0.25];
        const random = () => values.shift();
        const products = { a: { code: 'LF-50000000' } };
        expect(generateCode(products, random)).toBe('LF-25000000');
        expect(generateCode({})).toMatch(/^LF-\d{8}$/);
    });

    it('catálogo corrompido descarta inválidos e repetidos', () => {
        const out = sanitizeProducts({ a: raw, b: { ...raw }, c: { code: 'X' }, d: null });
        expect(Object.keys(out)).toEqual(['a']);
        expect(sanitizeProducts('lixo')).toEqual({});
    });

    it('produto vira carga com as mesmas medidas', () => {
        expect(itemFromProduct(validateProduct(raw).value)).toEqual({ label: 'Caixa de som', w: 0.4, h: 0.5, d: 0.3, weight: 12.5, fragile: true });
    });
});

describe('produtos no estado e no arquivo', () => {
    it('adiciona, edita, remove e desfaz', () => {
        const id = actions.addProduct(raw);
        expect(getState().products[id].code).toBe('7891234567895');
        expect(() => actions.addProduct({ ...raw, name: 'Repetido' })).toThrow(/já cadastrado/);
        actions.updateProduct(id, { weight: 13 });
        expect(getState().products[id].weight).toBe(13);
        const undo = actions.removeProduct(id);
        expect(getState().products[id]).toBeUndefined();
        undo();
        expect(getState().products[id].name).toBe('Caixa de som');
    });

    it('vai junto no projeto .json; arquivo antigo sem produtos não apaga o catálogo', () => {
        const project = importProject(exportProject(getState()));
        expect(Object.values(project.products).map(p => p.code)).toContain('7891234567895');
        const old = JSON.parse(exportProject(getState()));
        delete old.products;
        expect(importProject(JSON.stringify(old)).products).toBeUndefined();
    });
});
