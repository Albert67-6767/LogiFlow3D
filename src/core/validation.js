/** Converte texto numérico aceitando vírgula decimal ("0,45"). */
export const toNumber = (v) => {
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v ?? '').trim().replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
};

/**
 * Valida e normaliza os dados de um item.
 * @returns {{ value: object|null, errors: Record<string,string>, warnings: string[] }}
 */
export function validateItem(raw, truck) {
    const errors = {};
    const warnings = [];

    const label = String(raw.label ?? '').trim();
    const address = String(raw.address ?? '').trim();
    const w = toNumber(raw.w), h = toNumber(raw.h), d = toNumber(raw.d);
    const weight = toNumber(raw.weight);
    const stop = toNumber(raw.stop);
    const quantity = raw.quantity === undefined ? 1 : toNumber(raw.quantity);

    if (!label) errors.label = 'Informe uma descrição.';
    if (label.length > 80) errors.label = 'Máximo de 80 caracteres.';
    if (address.length > 120) errors.address = 'Máximo de 120 caracteres.';
    for (const [k, v] of [['w', w], ['h', h], ['d', d]]) {
        if (!(v > 0)) errors[k] = 'Maior que zero.';
        else if (v > 15) errors[k] = 'Máximo 15 m.';
    }
    if (!(weight > 0)) errors.weight = 'Maior que zero.';
    else if (weight > 30000) errors.weight = 'Máximo 30.000 kg.';
    if (!Number.isInteger(stop) || stop < 1 || stop > 99) errors.stop = 'Inteiro de 1 a 99.';
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) errors.quantity = 'Inteiro de 1 a 50.';

    if (Object.keys(errors).length) return { value: null, errors, warnings };

    if (truck) {
        const fits = h <= truck.h && ((w <= truck.w && d <= truck.d) || (d <= truck.w && w <= truck.d));
        if (!fits) warnings.push(`Este item não cabe no ${truck.name} (${truck.w} × ${truck.h} × ${truck.d} m).`);
        if (weight > truck.payload) warnings.push(`Peso acima da carga máxima do veículo (${truck.payload} kg).`);
    }

    return {
        value: { label, address, w, h, d, weight, stop, quantity, fragile: !!raw.fragile },
        errors,
        warnings,
    };
}
