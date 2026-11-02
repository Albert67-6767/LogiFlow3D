import { PACKING } from '../config/constants.js';

/*
 * Arrumação manual: o usuário destrava o baú e arrasta as caixas.
 * Funções puras usadas pela cena 3D (durante o arraste) e pelo estado (ao soltar).
 *
 * Mesmas coordenadas do packer: x largura, y altura, z da cabine (0) até a porta.
 * A caixa solta "cai" sobre o que estiver embaixo e só fica se tiver apoio,
 * não esmagar caixa frágil e não ficar sobre caixa mais leve que ela.
 */

const EPS = 1e-6;
const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
const overlapXZ = (a, b) => overlap(a.x, a.x + a.w, b.x, b.x + b.w) > EPS && overlap(a.z, a.z + a.d, b.z, b.z + b.d) > EPS;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round = (v) => Math.round(v * 1e4) / 1e4;

/**
 * Identifica a carga e o veículo. A arrumação manual só vale enquanto a carga
 * (medidas, peso, parada) e o baú não mudarem.
 */
export function layoutSignature(items, truck) {
    const list = [...items].map(i => `${i.id}:${i.w},${i.h},${i.d},${i.weight},${i.stop},${i.fragile ? 1 : 0}`).sort();
    return `${truck.w}x${truck.h}x${truck.d}|${list.join(';')}`;
}

/** Alguma caixa apoiada em cima desta? (não dá para tirar a de baixo primeiro) */
export const boxOnTop = (box, others) => others.find(o => o.id !== box.id && Math.abs(o.y - (box.y + box.h)) < 1e-3 && overlapXZ(o, box)) ?? null;

/** Gruda nas paredes e nas bordas das caixas vizinhas quando está perto (fica alinhado). */
export function snapXZ(x, z, box, others, truck, near = 0.08) {
    const xs = [0, truck.w - box.w];
    const zs = [0, truck.d - box.d];
    for (const o of others) {
        if (o.id === box.id) continue;
        xs.push(o.x + o.w + PACKING.gap, o.x - box.w - PACKING.gap, o.x);
        zs.push(o.z + o.d + PACKING.gap, o.z - box.d - PACKING.gap, o.z);
    }
    const pick = (v, list) => {
        let best = v, dist = near;
        for (const c of list) if (Math.abs(c - v) < dist) { best = c; dist = Math.abs(c - v); }
        return best;
    };
    return { x: pick(x, xs), z: pick(z, zs) };
}

/**
 * Solta a caixa em (x, z). Retorna a posição final (com y pela gravidade)
 * e `problem` com o motivo se ali não pode.
 * @param box { id, w, h, d, weight, fragile }
 */
export function dropBox(box, x, z, others, truck, opts = PACKING) {
    const pos = { ...box, x: round(clamp(x, 0, Math.max(0, truck.w - box.w))), z: round(clamp(z, 0, Math.max(0, truck.d - box.d))) };
    let y = 0;
    const under = [];
    for (const o of others) {
        if (o.id === box.id || !overlapXZ(pos, o)) continue;
        under.push(o);
        y = Math.max(y, o.y + o.h);
    }
    pos.y = round(y);
    const fail = (problem) => ({ ...pos, ok: false, problem });

    if (box.w > truck.w + EPS || box.d > truck.d + EPS) return fail('A caixa não cabe nessa posição: tente girar.');
    if (y + box.h > truck.h + EPS) return fail('Não cabe na altura: o teto do baú fica baixo demais aqui.');
    if (y > EPS) {
        const supports = under.filter(o => Math.abs(o.y + o.h - y) < 1e-3);
        let area = 0;
        for (const o of supports) {
            if (o.fragile) return fail('Não dá para empilhar sobre caixa frágil.');
            if (box.weight > o.weight * opts.maxStackRatio + EPS) return fail('Esta caixa é mais pesada que a de baixo: pode esmagar.');
            area += overlap(pos.x, pos.x + box.w, o.x, o.x + o.w) * overlap(pos.z, pos.z + box.d, o.z, o.z + o.d);
        }
        if (area / (box.w * box.d) < opts.minSupport - EPS) {
            return fail(`Pouco apoio embaixo: a base precisa ficar pelo menos ${Math.round(opts.minSupport * 100)}% apoiada.`);
        }
    }
    return { ...pos, ok: true, problem: null };
}

/** Gira a caixa 90° no piso (troca largura e comprimento). */
export const turned = (box) => ({ ...box, w: box.d, d: box.w, rotated: !box.rotated });

/**
 * Pares que quebram a regra LIFO: caixa de parada posterior (`blocker`) entre
 * uma caixa de parada anterior (`blocked`) e a porta.
 */
export function lifoIssues(placed) {
    const issues = [];
    for (const a of placed) {
        for (const b of placed) {
            if (b.stop > a.stop && b.z >= a.z + a.d - 1e-3 &&
                overlap(a.x, a.x + a.w, b.x, b.x + b.w) > EPS && overlap(a.y, a.y + a.h, b.y, b.y + b.h) > EPS) {
                issues.push({ blocked: a, blocker: b });
            }
        }
    }
    return issues;
}
