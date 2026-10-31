/**
 * Re-renderizações substituem o DOM. Isto devolve o foco (e a posição do cursor)
 * ao campo que o usuário estava usando, localizado pelo id.
 */
export function keepFocus(renderFn) {
    const active = document.activeElement;
    const id = active?.id;
    const selection = active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    renderFn();
    if (!id) return;
    const el = document.getElementById(id);
    if (el && el !== active) {
        el.focus();
        if (selection) try { el.setSelectionRange(...selection); } catch { /* campo sem seleção */ }
    }
}
