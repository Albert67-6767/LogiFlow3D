import { actions, watch } from '../state/store.js';
import { $, render } from './dom.js';
import { icon } from './icons.js';

/** Liga o botão de tema e aplica o tema escolhido na página. */
export function mountTheme() {
    const btn = $('#btn-theme');
    btn.addEventListener('click', () => actions.toggleTheme());
    watch(s => [s.theme], (s) => {
        const light = s.theme === 'light';
        document.documentElement.dataset.theme = s.theme;
        document.querySelector('meta[name=theme-color]')?.setAttribute('content', light ? '#ffffff' : '#16161b');
        render(btn, icon(light ? 'moon' : 'sun', 'size-5'));
        btn.title = light ? 'Mudar para o modo escuro' : 'Mudar para o modo claro';
        btn.setAttribute('aria-label', btn.title);
    });
}
