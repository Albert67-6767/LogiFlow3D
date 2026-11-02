import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_SERVICES, RISK_LEVELS, ROAD_BLOCK, colorForStop } from '../../config/constants.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { num } from '../format.js';

/*
 * Mapa da rota (Leaflet). Só desenha o que recebe em update(); a lógica de
 * escolha fica em core/routing.js. Textos do usuário entram como texto puro.
 */

const DEFAULT_VIEW = { center: [-23.55, -46.63], zoom: 11 };

const tip = (...lines) => h('div', {}, ...lines.filter(Boolean).map((l, i) =>
    h('p', { class: i === 0 ? 'font-semibold' : 'text-[11px] opacity-80' }, l)));

function pin(content, color, size = 26) {
    const el = h('div', { class: 'map-pin', style: { width: `${size}px`, height: `${size}px`, background: color } }, content);
    return L.divIcon({ html: el, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

/**
 * Fundo do mapa: ruas (OpenStreetMap) ou satélite (Esri + nomes por cima),
 * nos temas claro/escuro. Usado pelo mapa da rota e pela navegação.
 */
export function attachBaseLayers(map, el) {
    let tiles = null;
    let theme = 'dark';
    let style = 'map';
    const bases = {
        map: L.tileLayer(MAP_SERVICES.tiles, { attribution: MAP_SERVICES.attribution, maxZoom: 19 }),
        satellite: L.layerGroup([
            L.tileLayer(MAP_SERVICES.satellite.imagery, { attribution: MAP_SERVICES.satellite.attribution, maxZoom: 19, maxNativeZoom: 18 }),
            // Ruas só de perto (com a cidade inteira na tela elas escondem a foto); nomes de lugares sempre.
            L.tileLayer(MAP_SERVICES.satellite.labels[0], { maxZoom: 19, maxNativeZoom: 18, minZoom: 14, opacity: 0.75 }),
            L.tileLayer(MAP_SERVICES.satellite.labels[1], { maxZoom: 19, maxNativeZoom: 18 }),
        ]),
    };
    function apply() {
        const next = bases[style] ?? bases.map;
        if (tiles !== next) {
            tiles?.remove();
            tiles = next.addTo(map);
        }
        // O filtro escuro só vale para o mapa de ruas; a foto de satélite fica natural.
        el.classList.toggle('map-dark', theme !== 'light' && style === 'map');
    }
    return {
        setTheme(name) { theme = name; apply(); },
        /** 'map' (ruas) ou 'satellite'. */
        setStyle(name) { style = name === 'satellite' ? 'satellite' : 'map'; apply(); },
    };
}

export function createRouteMap(el, { onPick, onChooseAlt, onAreaClick, onBlockClick } = {}) {
    const map = L.map(el, { center: DEFAULT_VIEW.center, zoom: DEFAULT_VIEW.zoom, zoomControl: true });
    let picking = false;
    let fitted = false;
    const layers = {
        areas: L.layerGroup().addTo(map),
        alternatives: L.layerGroup().addTo(map),
        chosen: L.layerGroup().addTo(map),
        markers: L.layerGroup().addTo(map),
    };

    map.on('click', (e) => {
        if (picking) onPick?.({ lat: +e.latlng.lat.toFixed(6), lon: +e.latlng.lng.toFixed(6) });
    });

    const { setTheme, setStyle } = attachBaseLayers(map, el);

    function update({ depot, stops, legs, areas, heavy = false, blocks = [] }) {
        Object.values(layers).forEach(l => l.clearLayers());
        const bounds = L.latLngBounds([]);

        // Áreas de atenção
        for (const a of areas) {
            const level = RISK_LEVELS[a.level] ?? RISK_LEVELS[1];
            L.circle([a.lat, a.lon], { radius: a.radius, color: level.color, weight: 1.5, fillOpacity: 0.15, dashArray: '4 4' })
                .bindTooltip(tip(a.name, `${level.label} · raio ${num(a.radius / 1000, 1)} km`, 'Toque para editar'), { sticky: true })
                .on('click', () => { if (!picking) onAreaClick?.(a.id); })
                .addTo(layers.areas);
        }

        // Caminhos: alternativas (cinza, clicáveis) e o escolhido (cor da parada)
        legs.forEach((leg, i) => {
            if (!leg?.alternatives?.length) return;
            const color = colorForStop(stops[i]?.stop ?? i + 1);
            leg.alternatives.forEach((alt, idx) => {
                if (idx === leg.chosen) return;
                L.polyline(alt.shape, { color: '#94a3b8', weight: 5, opacity: 0.55, dashArray: '6 8' })
                    .bindTooltip(tip(`Alternativa ${idx + 1}${alt.detour ? ' (desvio)' : ''}`, `${num(alt.km)} km · ${Math.round(alt.min)} min`, 'Toque para usar este caminho'), { sticky: true })
                    .on('click', () => { if (!picking) onChooseAlt?.(leg.key, idx); })
                    .addTo(layers.alternatives);
            });
            const alt = leg.alternatives[leg.chosen];
            L.polyline(alt.shape, { color: '#ffffff', weight: 9, opacity: 0.9, interactive: false }).addTo(layers.chosen);
            L.polyline(alt.shape, { color, weight: 5, opacity: 1 })
                .bindTooltip(tip(`Trecho até a parada #${stops[i]?.stop}`, `${num(alt.km)} km · ${Math.round(alt.min)} min`), { sticky: true })
                .addTo(layers.chosen);
            // Destaque de piso: vermelho = terra/cascalho, âmbar = irregular
            alt.segments?.fair?.forEach(seg => L.polyline(seg, { color: '#f59e0b', weight: 5, dashArray: '2 6', interactive: false }).addTo(layers.chosen));
            alt.segments?.bad?.forEach(seg => L.polyline(seg, { color: '#ef4444', weight: 6, dashArray: '2 6', interactive: false }).addTo(layers.chosen));
            // Caminhão: roxo = rua estreita (viela, acesso ou faixa única)
            if (heavy) alt.segments?.narrow?.forEach(seg => L.polyline(seg, { color: '#a855f7', weight: 6, dashArray: '1 7' })
                .bindTooltip('Rua estreita para caminhão', { sticky: true }).addTo(layers.chosen));
            alt.shape.forEach(p => bounds.extend(p));
        });

        // Ruas sem passagem (observações dos motoristas)
        for (const b of blocks) {
            const faded = b.scope === 'truck' && !heavy; // não vale para o veículo atual
            L.marker([b.lat, b.lon], { icon: pin(icon('ban', 'size-3.5'), faded ? '#64748b' : '#dc2626', 24), zIndexOffset: 800 })
                .bindTooltip(tip(b.reason, b.note, `${ROAD_BLOCK.scopes[b.scope]}${faded ? ' (não vale para este veículo)' : ''}`, 'Toque para editar'))
                .on('click', () => { if (!picking) onBlockClick?.(b.id); })
                .addTo(layers.markers);
        }

        // Marcadores
        if (depot) {
            L.marker([depot.lat, depot.lon], { icon: pin(icon('home', 'size-3.5'), '#0f172a', 30), zIndexOffset: 1000 })
                .bindTooltip(tip('Base (saída)', depot.address))
                .addTo(layers.markers);
            bounds.extend([depot.lat, depot.lon]);
        }
        for (const st of stops) {
            if (!st.point) continue;
            L.marker([st.point.lat, st.point.lon], { icon: pin(String(st.stop), colorForStop(st.stop)), zIndexOffset: 500 })
                .bindTooltip(tip(`Parada #${st.stop}`, st.address, st.point.bairro && `Bairro: ${st.point.bairro}`))
                .addTo(layers.markers);
            bounds.extend([st.point.lat, st.point.lon]);
        }

        lastBounds = bounds;
        if (!fitted && bounds.isValid()) { fit(); fitted = true; }
    }

    let lastBounds = null;
    function fit() {
        if (lastBounds?.isValid()) map.fitBounds(lastBounds, { padding: [30, 30], maxZoom: 16 });
    }

    function setPicking(value) {
        picking = value;
        el.parentElement.classList.toggle('map-picking', value);
    }

    return {
        setTheme, setStyle, update, fit, setPicking,
        /** Necessário quando o mapa estava escondido (aba inativa) e volta a aparecer. */
        invalidate: () => map.invalidateSize(),
        focus: (p, zoom = 15) => map.setView([p.lat, p.lon], zoom),
    };
}
