import { colorForStop } from '../../config/constants.js';
import { loadingOrder } from '../../core/packer.js';
import { getDerived, getState } from '../../state/store.js';
import { $, h, render } from '../dom.js';
import { dims, int, num, money, UNPLACED_REASON } from '../format.js';

/** Monta o plano de carregamento que aparece apenas na impressão / PDF. */
export function buildPrintReport(snapshotUrl) {
    const s = getState();
    const d = getDerived();
    const byId = new Map(s.items.map(i => [i.id, i]));
    // Ordem real usada pelo encaixe; itens fora do baú no fim.
    const order = [
        ...d.packing.placed.map(p => byId.get(p.id)),
        ...loadingOrder(s.items.filter(i => d.unplacedById.has(i.id))),
    ];

    const position = (p) => {
        if (!p) return '—';
        const depth = p.z + p.d / 2;
        const part = depth < d.truck.d / 3 ? 'fundo (cabine)' : depth < (2 * d.truck.d) / 3 ? 'meio' : 'porta';
        return `${part}${p.y > 0.01 ? ', empilhada' : ''}${p.rotated ? ', girada' : ''}`;
    };

    render($('#print-report'),
        h('h1', {}, 'LogiFlow 3D – Plano de Carregamento'),
        h('p', {}, `${d.truck.name} · ${new Date().toLocaleString('pt-BR')}`),
        h('p', {}, `Ocupação ${num(d.totals.volumePct)}% · Peso ${int(d.totals.weight)} / ${int(d.truck.payload)} kg · `
            + `Equilíbrio frente/traseira ${d.distribution.front}/${d.distribution.rear}, lateral ${d.distribution.left}/${d.distribution.right} · `
            + `Rota ${num(d.route.km)} km, ${money(d.route.cost)}`),
        snapshotUrl && h('div', { style: { marginTop: '10px' } }, h('img', { src: snapshotUrl, alt: 'Vista 3D do baú carregado' })),

        h('h2', {}, 'Ordem de carregamento (do fundo para a porta)'),
        h('table', {},
            h('thead', {}, h('tr', {}, ['#', 'Parada', 'Item', 'Medidas', 'Peso', 'Posição', 'Obs.'].map(t => h('th', {}, t)))),
            h('tbody', {}, order.map((item, n) => {
                const reason = d.unplacedById.get(item.id);
                return h('tr', {},
                    h('td', {}, String(n + 1)),
                    h('td', {}, h('span', { class: 'swatch', style: { background: colorForStop(item.stop) } }), `#${item.stop}`),
                    h('td', {}, item.label),
                    h('td', {}, dims(item)),
                    h('td', {}, `${int(item.weight)} kg`),
                    h('td', {}, reason ? `NÃO CARREGADO – ${UNPLACED_REASON[reason]}` : position(d.placedById.get(item.id))),
                    h('td', {}, item.fragile ? 'Frágil' : ''),
                );
            })),
        ),

        h('h2', {}, 'Roteiro de entregas'),
        h('table', {},
            h('thead', {}, h('tr', {}, ['Parada', 'Endereço', 'Itens', 'Peso', 'Km do trecho'].map(t => h('th', {}, t)))),
            h('tbody', {}, d.stops.map(st => h('tr', {},
                h('td', {}, `#${st.stop}`),
                h('td', {}, st.address || '—'),
                h('td', {}, st.items.map(i => byId.get(i.id)?.label).join(', ')),
                h('td', {}, `${int(st.weight)} kg`),
                h('td', {}, st.km ? num(st.km) : '—'),
            ))),
        ),
    );
}
