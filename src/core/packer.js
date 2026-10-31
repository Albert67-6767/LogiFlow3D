import { PACKING } from '../config/constants.js';
import { weightDistribution } from './metrics.js';

/*
 * Encaixe 3D com regra LIFO. Função pura: não conhece Three.js nem o DOM.
 *
 * Sistema de coordenadas (metros, canto da caixa):
 *   x: 0 = parede esquerda  → truck.w
 *   y: 0 = piso             → truck.h
 *   z: 0 = cabine (fundo)   → truck.d (porta)
 *
 * Estratégia: as paradas mais distantes entram primeiro e ficam junto à cabine.
 * Para cada item testamos pontos candidatos (x, z) e as duas orientações no piso;
 * a altura y é obtida por "gravidade" (topo mais alto sob a base). Uma posição é
 * válida se cabe no baú, tem apoio suficiente, respeita empilhamento e não deixa
 * nenhuma caixa de parada posterior entre o item e a porta.
 *
 * Como o encaixe é guloso, rodamos algumas estratégias (ordem dentro da parada e
 * preferência de posição) e ficamos com a que carrega mais itens e equilibra melhor.
 */

const EPS = 1e-6;

const overlap1D = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

const ORDER_KEYS = {
    weight: (i) => i.weight,
    volume: (i) => i.w * i.h * i.d,
    footprint: (i) => i.w * i.d,
    height: (i) => i.h,
};

/** Ordem de carregamento: última parada primeiro; dentro da parada, pelo critério (padrão: peso). */
export function loadingOrder(items, by = 'weight') {
    const key = ORDER_KEYS[by];
    return [...items].sort((a, b) =>
        b.stop - a.stop ||
        key(b) - key(a) ||
        b.weight - a.weight ||
        String(a.id).localeCompare(String(b.id))
    );
}

/** Preferência de posição: a primeira chave que diferir decide. */
const PREFERENCES = {
    stackFirst: ['z', 'y', 'x'], // forma "paredes" junto à cabine
    floorFirst: ['z', 'x', 'y'], // ocupa a largura do piso antes de empilhar
    lowFirst: ['y', 'z', 'x'],   // mantém o centro de gravidade baixo
};

const STRATEGIES = ['fill', 'wide', 'narrow'].flatMap(turn =>
    Object.keys(ORDER_KEYS).flatMap(order =>
        Object.keys(PREFERENCES).map(pref => ({ order, pref, turn }))));

/** Acima disso, testamos menos estratégias para a tela continuar fluida. */
const LARGE_LOAD = 60;

/** Orientações no piso (a altura nunca muda: "este lado para cima"). Em empate vence a primeira. */
function orientations(item, turn = 'wide') {
    const list = [{ w: item.w, d: item.d, rotated: false }];
    if (Math.abs(item.w - item.d) > EPS) list.push({ w: item.d, d: item.w, rotated: true });
    return turn === 'narrow' ? list.sort((a, b) => a.w - b.w) : list.sort((a, b) => b.w - a.w);
}

function fitsTruckAtAll(item, truck) {
    return item.h <= truck.h + EPS && orientations(item).some(o => o.w <= truck.w + EPS && o.d <= truck.d + EPS);
}

function tryPosition(x, z, o, item, truck, placed, opts) {
    if (x + o.w > truck.w + EPS || z + o.d > truck.d + EPS) return null;

    // Gravidade: repousa sobre o topo mais alto dentro da área da base.
    let y = 0;
    const under = [];
    for (const p of placed) {
        if (overlap1D(x, x + o.w, p.x, p.x + p.w) > EPS && overlap1D(z, z + o.d, p.z, p.z + p.d) > EPS) {
            under.push(p);
            if (p.y + p.h > y) y = p.y + p.h;
        }
    }
    if (y + item.h > truck.h + EPS) return null;

    if (y > EPS) {
        const supports = under.filter(p => Math.abs(p.y + p.h - y) < 1e-4);
        let area = 0;
        for (const p of supports) {
            if (p.fragile) return null;
            if (item.weight > p.weight * opts.maxStackRatio + EPS) return null;
            area += overlap1D(x, x + o.w, p.x, p.x + p.w) * overlap1D(z, z + o.d, p.z, p.z + p.d);
        }
        if (area / (o.w * o.d) < opts.minSupport) return null;
    }

    // LIFO: nada de parada posterior pode ficar entre o item e a porta.
    for (const p of placed) {
        if (p.stop > item.stop &&
            p.z >= z + o.d - EPS &&
            overlap1D(x, x + o.w, p.x, p.x + p.w) > EPS &&
            overlap1D(y, y + item.h, p.y, p.y + p.h) > EPS) {
            return null;
        }
    }

    return { x, y, z };
}

/**
 * @param {Array} items  itens com {id, w, h, d, weight, stop, fragile}
 * @param {{w:number,h:number,d:number,payload:number}} truck
 * @returns {{ placed: Array, unplaced: Array<{id, reason:'dimensoes'|'peso'|'espaco'}>, strategy: object }}
 */
export function packCargo(items, truck, options = {}) {
    const opts = { ...PACKING, ...options };
    let best = null;
    const strategies = items.length > LARGE_LOAD
        ? STRATEGIES.filter(st => st.order === 'weight' || st.order === 'volume')
        : STRATEGIES;
    for (const strategy of strategies) {
        const result = packWith(items, truck, opts, strategy);
        const placedWeight = result.placed.reduce((s, p) => s + p.weight, 0);
        const imbalance = weightDistribution(result.placed, truck).imbalance;
        const score = [result.placed.length, placedWeight, -imbalance];
        if (!best || isBetter(score, best.score)) best = { result: { ...result, strategy }, score };
        if (result.unplaced.length === 0 && imbalance < 15) break; // já é ótimo o suficiente
    }
    return best.result;
}

function isBetter(a, b) {
    for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] > b[i];
    }
    return false;
}

function packWith(items, truck, opts, strategy) {
    const prefer = PREFERENCES[strategy.pref];
    const placed = [];
    const unplaced = [];
    const xs = new Set([0]);
    const zs = new Set([0]);
    let totalWeight = 0;

    for (const item of loadingOrder(items, strategy.order)) {
        if (!fitsTruckAtAll(item, truck)) {
            unplaced.push({ id: item.id, reason: 'dimensoes' });
            continue;
        }
        if (totalWeight + item.weight > truck.payload + EPS) {
            unplaced.push({ id: item.id, reason: 'peso' });
            continue;
        }

        let best = null;
        for (const o of orientations(item, strategy.turn)) {
            for (const x of xs) {
                if (x + o.w > truck.w + EPS) continue;
                for (const z of zs) {
                    const pos = tryPosition(x, z, o, item, truck, placed, opts);
                    if (!pos) continue;
                    if (!best || precedes(pos, best, prefer)) {
                        best = { ...pos, ...o };
                    } else if (strategy.turn === 'fill' && !precedes(best, pos, prefer) &&
                        widthFill(truck, x, o.w, opts.gap) > widthFill(truck, best.x, best.w, opts.gap) + EPS) {
                        // Mesma posição: fica a orientação que melhor aproveita a largura restante.
                        best = { ...pos, ...o };
                    }
                }
            }
        }

        if (!best) {
            unplaced.push({ id: item.id, reason: 'espaco' });
            continue;
        }

        const box = {
            id: item.id, stop: item.stop, weight: item.weight, fragile: !!item.fragile,
            x: best.x, y: best.y, z: best.z, w: best.w, h: item.h, d: best.d, rotated: best.rotated,
        };
        placed.push(box);
        totalWeight += item.weight;

        // Novos cantos livres: todas as combinações de bordas em x e z viram candidatas.
        const nx = round(box.x + box.w + opts.gap);
        const nz = round(box.z + box.d + opts.gap);
        if (nx < truck.w - EPS) xs.add(nx);
        if (nz < truck.d - EPS) zs.add(nz);
    }

    return { placed, unplaced };
}

const round = (v) => Math.round(v * 1e6) / 1e6;

/** Fração da largura restante (de x até a parede) ocupada por cópias lado a lado desta largura. */
function widthFill(truck, x, w, gap) {
    const rest = truck.w - x;
    const copies = Math.floor((rest + gap + EPS) / (w + gap));
    return (copies * w) / rest;
}

function precedes(a, b, keys) {
    for (const k of keys) {
        if (a[k] < b[k] - EPS) return true;
        if (a[k] > b[k] + EPS) return false;
    }
    return false;
}

/** Verificação usada nos testes: nenhuma interseção entre caixas e tudo dentro do baú. */
export function findCollisions(placed, truck) {
    const problems = [];
    placed.forEach((a, i) => {
        if (a.x < -EPS || a.y < -EPS || a.z < -EPS ||
            a.x + a.w > truck.w + EPS || a.y + a.h > truck.h + EPS || a.z + a.d > truck.d + EPS) {
            problems.push(`${a.id} fora do baú`);
        }
        for (let j = i + 1; j < placed.length; j++) {
            const b = placed[j];
            if (overlap1D(a.x, a.x + a.w, b.x, b.x + b.w) > EPS &&
                overlap1D(a.y, a.y + a.h, b.y, b.y + b.h) > EPS &&
                overlap1D(a.z, a.z + a.d, b.z, b.z + b.d) > EPS) {
                problems.push(`${a.id} colide com ${b.id}`);
            }
        }
    });
    return problems;
}
