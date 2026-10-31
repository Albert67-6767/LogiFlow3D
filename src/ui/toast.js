import { h } from './dom.js';
import { icon } from './icons.js';

const TONES = {
    ok: { icon: 'ok', cls: 'border-emerald-500/40 text-emerald-300' },
    warn: { icon: 'warn', cls: 'border-amber-500/40 text-amber-300' },
    danger: { icon: 'danger', cls: 'border-red-500/40 text-red-300' },
    info: { icon: 'info', cls: 'border-slate-600 text-slate-200' },
};

/** Mensagem temporária. `action` opcional: { label, run } (ex.: Desfazer). */
export function toast(message, { tone = 'info', action, duration = 4500 } = {}) {
    const host = document.getElementById('toasts');
    const t = TONES[tone] ?? TONES.info;
    const close = () => el.remove();
    const el = h('div', { class: `toast ${t.cls}`, role: 'status' },
        icon(t.icon),
        h('span', { class: 'flex-1' }, message),
        action && h('button', {
            class: 'font-semibold underline underline-offset-2 hover:text-slate-50',
            onclick: () => { action.run(); close(); },
        }, action.label),
        h('button', { class: 'icon-btn -mr-1', 'aria-label': 'Fechar aviso', onclick: close }, icon('x', 'size-3.5')),
    );
    host.append(el);
    setTimeout(close, duration);
}
