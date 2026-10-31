import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// O build gera um único dist/index.html que abre com duplo clique, sem servidor.
export default defineConfig({
    base: './',
    plugins: [tailwindcss(), viteSingleFile()],
    test: {
        include: ['tests/**/*.test.js'],
    },
});
