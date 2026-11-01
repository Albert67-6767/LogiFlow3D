import { validateItem } from './validation.js';

/*
 * Cadastro de produtos (catálogo). Funções puras: recebem e devolvem objetos.
 *
 * Catálogo = { [id]: { code, name, w, h, d, weight, fragile } }.
 * `code` é o código de barras do fabricante (EAN) ou um código gerado pelo app
 * para imprimir em etiqueta (QR code).
 */

/** Deixa o código num formato único: sem espaços nas pontas e em maiúsculas. */
export const normalizeCode = (code) => String(code ?? '').trim().toUpperCase();

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._\-/]{0,39}$/;

/** Procura um produto pelo código. Retorna [id, produto] ou null. */
export function findByCode(products, code) {
    const key = normalizeCode(code);
    if (!key) return null;
    return Object.entries(products).find(([, p]) => p.code === key) ?? null;
}

/** Gera um código interno ainda não usado (ex.: LF-48213907) para etiquetas próprias. */
export function generateCode(products, random = Math.random) {
    for (;;) {
        const code = `LF-${String(Math.floor(random() * 1e8)).padStart(8, '0')}`;
        if (!findByCode(products, code)) return code;
    }
}

/**
 * Valida e normaliza um produto. Medidas e peso seguem as mesmas regras de uma carga.
 * @returns {{ value: object|null, errors: Record<string,string> }}
 */
export function validateProduct(raw, products = {}, ignoreId = null) {
    const errors = {};
    const code = normalizeCode(raw.code);
    const name = String(raw.name ?? '').trim();

    if (!code) errors.code = 'Leia, digite ou gere um código.';
    else if (!CODE_PATTERN.test(code)) errors.code = 'Use só letras, números e - . _ / (até 40).';
    else {
        const found = findByCode(products, code);
        if (found && found[0] !== ignoreId) errors.code = `Código já cadastrado em "${found[1].name}".`;
    }

    const item = validateItem({ ...raw, label: name, stop: 1, quantity: 1 });
    if (!name) errors.name = 'Informe o nome do produto.';
    else if (item.errors.label) errors.name = item.errors.label;
    for (const k of ['w', 'h', 'd', 'weight']) if (item.errors[k]) errors[k] = item.errors[k];

    if (Object.keys(errors).length) return { value: null, errors };
    const { w, h, d, weight, fragile } = item.value;
    return { value: { code, name, w, h, d, weight, fragile }, errors };
}

/** Lê um catálogo vindo de arquivo/armazenamento; descarta produtos inválidos ou repetidos. */
export function sanitizeProducts(raw) {
    const out = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [id, p] of Object.entries(raw)) {
            const { value } = validateProduct(p ?? {}, out);
            if (value && id) out[id] = value;
        }
    }
    return out;
}

/** Dados de uma carga a partir de um produto (falta só parada, endereço e quantidade). */
export const itemFromProduct = (p) => ({ label: p.name, w: p.w, h: p.h, d: p.d, weight: p.weight, fragile: p.fragile });
