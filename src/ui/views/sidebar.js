import { actions, watch } from '../../state/store.js';
import { $, $$, h, render } from '../dom.js';
import { icon } from '../icons.js';
import { dim, int } from '../format.js';
import { openTruckDialog, confirmRemoveTruck } from './truckDialog.js';

export function openSidebar(open) {
    $('#sidebar').dataset.open = String(open);
    $('#sidebar-backdrop').hidden = !open;
}

export function mountSidebar() {
    // Abas
    const tabs = $$('.nav-btn, .tab-btn'); // menu lateral + barra inferior
    tabs.forEach(btn => btn.addEventListener('click', () => {
        actions.setTab(btn.dataset.tab);
        openSidebar(false);
    }));
    watch(s => [s.activeTab], (s) => {
        tabs.forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.tab === s.activeTab)));
        $$('[role=tabpanel]').forEach(panel => { panel.hidden = panel.id !== `tab-${s.activeTab}`; });
    });

    // Veículos (frota editável)
    const list = $('#truck-options');
    watch(s => [s.trucks, s.truckKey], (s) => {
        const onlyOne = Object.keys(s.trucks).length === 1;
        render(list, Object.entries(s.trucks).map(([key, t]) => {
            const selected = key === s.truckKey;
            return h('div', { class: 'group relative' },
                h('button', {
                    class: 'truck-option pr-16',
                    role: 'radio',
                    'aria-checked': String(selected),
                    onclick: () => actions.setTruck(key),
                },
                    h('span', { class: 'flex items-center gap-2' },
                        selected && h('span', { class: 'size-2 shrink-0 animate-pulse rounded-full bg-brand-400', 'aria-hidden': 'true' }),
                        h('span', { class: `truncate text-sm font-semibold ${selected ? 'text-brand-300' : 'text-slate-200'}`, title: t.name }, t.name),
                    ),
                    h('span', { class: 'mt-1 flex justify-between gap-2 font-mono text-[11px] text-slate-400' },
                        h('span', {}, `${dim(t.d)}×${dim(t.w)}×${dim(t.h)} m`),
                        h('span', {}, `${int(t.payload)} kg`),
                    ),
                ),
                h('div', { class: 'absolute right-1.5 top-1.5 flex gap-0.5 transition lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100' },
                    h('button', {
                        class: 'icon-btn p-1', title: 'Editar veículo', 'aria-label': `Editar ${t.name}`,
                        onclick: () => openTruckDialog(key),
                    }, icon('pencil', 'size-3.5')),
                    h('button', {
                        class: 'icon-btn p-1 hover:text-red-400 disabled:pointer-events-none disabled:opacity-30',
                        title: onlyOne ? 'Mantenha pelo menos um veículo' : 'Remover veículo',
                        'aria-label': `Remover ${t.name}`,
                        disabled: onlyOne,
                        onclick: () => confirmRemoveTruck(key),
                    }, icon('trash', 'size-3.5')),
                ),
            );
        }));
    });
    $('#btn-add-truck').addEventListener('click', () => openTruckDialog());

    // Gaveta em telas pequenas
    $('#btn-open-sidebar').addEventListener('click', () => openSidebar(true));
    $('#btn-close-sidebar').addEventListener('click', () => openSidebar(false));
    $('#sidebar-backdrop').addEventListener('click', () => openSidebar(false));
}
