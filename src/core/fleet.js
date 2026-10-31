import { CABIN_TYPES, CO2_PER_LITER, DEFAULT_TRUCKS, TRUCK_LIMITS } from '../config/constants.js';
import { toNumber } from './validation.js';

/*
 * Regras da frota de veículos. Funções puras: recebem e devolvem objetos,
 * sem tela nem armazenamento, para poderem ser reaproveitadas num servidor.
 *
 * Frota = objeto { [id]: { name, w, h, d, payload, kmPerLiter, fuel, cabin } }.
 */

export const defaultFleet = () => structuredClone(DEFAULT_TRUCKS);

const fmt = (n) => String(n).replace('.', ',');

/**
 * Valida e normaliza os dados de um veículo.
 * @returns {{ value: object|null, errors: Record<string,string> }}
 */
export function validateTruck(raw, fleet = {}, ignoreId = null) {
    const errors = {};
    const name = String(raw.name ?? '').trim();

    if (!name) errors.name = 'Informe um nome.';
    else if (name.length > 40) errors.name = 'Máximo de 40 caracteres.';
    else if (Object.entries(fleet).some(([id, t]) => id !== ignoreId && t.name.trim().toLowerCase() === name.toLowerCase())) {
        errors.name = 'Já existe um veículo com este nome.';
    }

    const value = { name };
    for (const [key, [min, max]] of Object.entries(TRUCK_LIMITS)) {
        const n = toNumber(raw[key]);
        if (!Number.isFinite(n)) errors[key] = 'Informe um número.';
        else if (n < min || n > max) errors[key] = `Entre ${fmt(min)} e ${fmt(max)}.`;
        value[key] = n;
    }

    const fuel = String(raw.fuel ?? '');
    if (!(fuel in CO2_PER_LITER)) errors.fuel = 'Combustível inválido.';
    value.fuel = fuel;

    // Tipo de cabine é só visual: valor desconhecido (ou arquivo antigo) vira "auto".
    const cabin = String(raw.cabin ?? 'auto');
    value.cabin = cabin in CABIN_TYPES ? cabin : 'auto';

    return Object.keys(errors).length ? { value: null, errors } : { value, errors };
}

/** Adiciona um veículo. Lança Error se os dados forem inválidos. */
export function addTruck(fleet, id, raw) {
    const { value, errors } = validateTruck(raw, fleet);
    if (!value) throw new ValidationError(errors);
    return { ...fleet, [id]: value };
}

/** Atualiza um veículo existente. */
export function updateTruck(fleet, id, raw) {
    if (!fleet[id]) throw new Error('Veículo não encontrado.');
    const { value, errors } = validateTruck({ ...fleet[id], ...raw }, fleet, id);
    if (!value) throw new ValidationError(errors);
    return { ...fleet, [id]: value };
}

/** Remove um veículo. A frota nunca fica vazia. */
export function removeTruck(fleet, id) {
    if (!fleet[id]) throw new Error('Veículo não encontrado.');
    if (Object.keys(fleet).length <= 1) throw new Error('É preciso manter pelo menos um veículo.');
    const { [id]: _removed, ...rest } = fleet;
    return rest;
}

/** Lê uma frota vinda de arquivo/armazenamento; descarta veículos inválidos. */
export function sanitizeFleet(raw) {
    const out = {};
    if (raw && typeof raw === 'object') {
        for (const [id, t] of Object.entries(raw)) {
            const { value } = validateTruck(t ?? {}, out);
            if (value && id) out[id] = value;
        }
    }
    return Object.keys(out).length ? out : defaultFleet();
}

export class ValidationError extends Error {
    constructor(errors) {
        super(Object.values(errors)[0] ?? 'Dados inválidos.');
        this.errors = errors;
    }
}
