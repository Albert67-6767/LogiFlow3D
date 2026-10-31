import { watch } from '../../state/store.js';
import { $, h, render } from '../dom.js';
import { icon } from '../icons.js';
import { num, int, money } from '../format.js';

const TONE = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/30',
};
const BAR = { emerald: 'bg-emerald-500', blue: 'bg-blue-500', amber: 'bg-amber-500', red: 'bg-red-500' };

function stat({ iconName, tone, label, value, sub, pct }) {
    return h('div', { class: 'flex min-w-0 items-center gap-3' },
        h('div', { class: `hidden rounded-lg border p-2 md:block ${TONE[tone]}` }, icon(iconName, 'size-5')),
        h('div', { class: 'min-w-0 flex-1' },
            h('p', { class: 'stat-label' }, label),
            h('p', { class: `truncate font-mono text-sm font-bold sm:text-lg ${tone === 'red' ? 'text-red-400' : 'text-slate-100'}` }, value),
            pct !== undefined && h('div', { class: 'bar mt-1 h-1 max-w-40' },
                h('div', { class: `h-full transition-all ${BAR[tone]}`, style: { width: `${Math.min(100, pct)}%` } })),
            sub && h('p', { class: 'hidden truncate text-[11px] text-slate-500 sm:block' }, sub),
        ),
    );
}

export function mountHeader() {
    const root = $('#header-stats');
    watch((s, d) => [s.items, d.truck, s.stopKm, s.settings], (s, d) => {
        const { totals: t, truck, route } = d;
        render(root,
            stat({
                iconName: 'boxes', tone: t.overVolume ? 'red' : 'emerald', label: 'Ocupação',
                value: `${num(t.volumePct)}%`, pct: t.volumePct,
                sub: `${num(t.volume, 2)} / ${num(t.truckVolume, 2)} m³`,
            }),
            stat({
                iconName: 'weight', tone: t.overWeight ? 'red' : 'blue', label: 'Peso',
                value: `${int(t.weight)} kg`, pct: t.weightPct,
                sub: `de ${int(truck.payload)} kg (${num(t.weightPct, 0)}%)`,
            }),
            stat({
                iconName: 'fuel', tone: 'amber', label: 'Rota',
                value: `${num(route.km)} km`,
                sub: route.km ? `${num(route.liters)} L · ${money(route.cost)}` : 'Calcule na aba Rota',
            }),
        );
    });
}
