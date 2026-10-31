const cache = new Map();
const nf = (min, max) => {
    const key = `${min}-${max}`;
    if (!cache.has(key)) cache.set(key, new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max }));
    return cache.get(key);
};

export const num = (v, digits = 1) => nf(digits, digits).format(v);
export const int = (v) => nf(0, 0).format(Math.round(v));
export const dim = (v) => nf(0, 2).format(v);
export const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
export const dims = (i) => `${dim(i.w)} × ${dim(i.h)} × ${dim(i.d)} m`;
export const volume = (i) => i.w * i.h * i.d;

/** Minutos → "45 min" ou "1 h 20 min". */
export const duration = (min) => {
    const m = Math.round(min);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
};

export const UNPLACED_REASON = {
    dimensoes: 'Maior que o baú',
    peso: 'Excede carga máxima',
    espaco: 'Sem espaço livre',
};
