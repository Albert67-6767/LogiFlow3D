import { CO2_PER_LITER } from '../../config/constants.js';
import { actions, watch } from '../../state/store.js';
import { toNumber } from '../../core/validation.js';
import { $, h, render } from '../dom.js';
import { icon } from '../icons.js';
import { num, int, money } from '../format.js';
import { keepFocus } from './keepFocus.js';

const TEXT = { emerald: 'text-emerald-400', blue: 'text-blue-400', amber: 'text-amber-400', red: 'text-red-400', slate: 'text-slate-100' };

function kpi(label, value, note, tone = 'slate', iconName) {
    return h('div', { class: 'card p-4 sm:p-5' },
        h('p', { class: 'mb-1 flex items-center gap-1.5 text-xs text-slate-400' }, iconName && icon(iconName, 'size-3.5'), label),
        h('p', { class: `font-mono text-xl font-bold sm:text-2xl ${TEXT[tone]}` }, value),
        note && h('p', { class: 'mt-2 text-[11px] text-slate-500' }, note));
}

function numberField({ id, label, value, hint, onCommit }) {
    return h('div', {},
        h('label', { for: id, class: 'label' }, label),
        h('input', {
            id, class: 'input font-mono', inputmode: 'decimal',
            value: value === null || value === undefined ? '' : String(value).replace('.', ','),
            onchange: (e) => {
                const n = toNumber(e.target.value);
                onCommit(Number.isFinite(n) && n >= 0 ? n : null);
            },
        }),
        hint && h('p', { class: 'field-hint' }, hint));
}

const section = (title, ...children) => h('section', { class: 'space-y-3' },
    h('h2', { class: 'text-sm font-semibold text-slate-300' }, title), ...children);

export function mountMetricsView() {
    watch((s, d) => [s.items, d.packing, s.stopKm, d.truck, s.settings], (s, d) => keepFocus(() => {
        const { route, totals, distribution, truck, packing } = d;
        const sv = route.savings;
        const co2Factor = CO2_PER_LITER[truck.fuel];

        render($('#metrics-root'),
            section('Rota',
                h('div', { class: 'grid grid-cols-2 gap-3 md:grid-cols-4' },
                    kpi('Distância total', `${num(route.km)} km`, route.missingKm ? `${route.missingKm} parada(s) sem km` : 'Soma dos trechos informados', 'emerald', 'route'),
                    kpi('Combustível', `${num(route.liters)} L`, `${truck.name}: ${num(truck.kmPerLiter, 0)} km/L`, 'blue', 'fuel'),
                    kpi('Custo estimado', money(route.cost), `A ${money(s.settings.fuelPrice)} / litro`, 'amber', 'money'),
                    kpi('Emissão de CO₂', `${num(route.co2)} kg`, `${num(co2Factor, 2)} kg por litro (${truck.fuel})`, 'slate', 'leaf'),
                ),
            ),

            section('Economia em relação à rota original',
                sv
                    ? h('div', { class: 'grid grid-cols-2 gap-3 md:grid-cols-4' },
                        kpi('Km economizados', `${num(sv.km)} km`, `${num(sv.pct)}% menos que ${num(s.settings.baselineKm)} km`, sv.km >= 0 ? 'emerald' : 'red'),
                        kpi('Combustível poupado', `${num(sv.liters)} L`, null, sv.km >= 0 ? 'blue' : 'red'),
                        kpi('Dinheiro poupado', money(sv.money), null, sv.km >= 0 ? 'amber' : 'red'),
                        kpi('CO₂ evitado', `${num(sv.co2)} kg`, null, sv.km >= 0 ? 'emerald' : 'red'))
                    : h('p', { class: 'card flex items-center gap-2 p-4 text-xs text-slate-400' },
                        icon('info', 'size-4 text-slate-500'),
                        'Informe abaixo os km da rota sem otimização para comparar e ver a economia.'),
            ),

            section('Parâmetros',
                h('div', { class: 'card grid gap-4 p-4 sm:grid-cols-2' },
                    numberField({
                        id: 'set-fuel-price', label: 'Preço do combustível (R$/L)', value: s.settings.fuelPrice,
                        onCommit: (v) => actions.updateSettings({ fuelPrice: v ?? 0 }),
                    }),
                    numberField({
                        id: 'set-baseline', label: 'Km da rota original (sem otimização)', value: s.settings.baselineKm,
                        hint: 'Deixe vazio se não houver comparação.',
                        onCommit: (v) => actions.updateSettings({ baselineKm: v || null }),
                    }),
                ),
            ),

            section('Carga',
                h('div', { class: 'grid grid-cols-2 gap-3 md:grid-cols-4' },
                    kpi('Ocupação do baú', `${num(totals.volumePct)}%`, `${num(totals.volume, 2)} de ${num(totals.truckVolume, 2)} m³`, totals.overVolume ? 'red' : 'emerald'),
                    kpi('Peso', `${num(totals.weightPct)}%`, `${int(totals.weight)} de ${int(truck.payload)} kg`, totals.overWeight ? 'red' : 'blue'),
                    kpi('Itens no baú', `${packing.placed.length} / ${s.items.length}`, packing.unplaced.length ? `${packing.unplaced.length} fora do baú` : 'Todos carregados', packing.unplaced.length ? 'red' : 'emerald'),
                    kpi('Equilíbrio', distribution.status === 'empty' ? '—' : `${distribution.front}/${distribution.rear}`,
                        distribution.status === 'empty' ? 'Baú vazio' : `Frente/traseira · lateral ${distribution.left}/${distribution.right}`,
                        { ok: 'emerald', warn: 'amber', danger: 'red', empty: 'slate' }[distribution.status]),
                ),
            ),
        );
    }));
}
