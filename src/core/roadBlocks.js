import { ROAD_BLOCK } from '../config/constants.js';
import { circlePolygon, insideArea, lengthInside } from './geo.js';

/*
 * Observações de "não dá para passar" deixadas pelos motoristas.
 * Cada uma é { id, lat, lon, reason, note, scope: 'truck' | 'all', at }.
 * O cálculo da rota exclui um pequeno círculo em volta de cada ponto.
 */

const isLat = (v) => Number.isFinite(v) && Math.abs(v) <= 90;
const isLon = (v) => Number.isFinite(v) && Math.abs(v) <= 180;

/** Valida/normaliza uma lista vinda de arquivo ou armazenamento. */
export function sanitizeBlocks(list, makeId) {
    if (!Array.isArray(list)) return [];
    return list
        .filter(b => b && isLat(b.lat) && isLon(b.lon))
        .map(b => ({
            id: typeof b.id === 'string' && b.id ? b.id : makeId(),
            lat: b.lat, lon: b.lon,
            reason: ROAD_BLOCK.reasons.includes(b.reason) ? b.reason : 'Outro motivo',
            note: String(b.note ?? '').slice(0, 200),
            scope: b.scope === 'all' ? 'all' : 'truck',
            at: Number.isFinite(b.at) ? b.at : Date.now(),
        }));
}

/** Observações que valem para o perfil de rota ('truck' vê todas; carro só as "todos os veículos"). */
export const blocksFor = (blocks, profile) => (blocks ?? []).filter(b => b.scope === 'all' || profile === 'truck');

/** Área (círculo) bloqueada em volta do ponto. */
export const blockArea = (b) => ({ lat: b.lat, lon: b.lon, radius: ROAD_BLOCK.radius });

/**
 * Polígonos para o serviço de rotas, sem os que cobrem a origem ou o destino
 * (o serviço não consegue sair de dentro de uma área excluída).
 */
export function blockPolygons(blocks, from, to) {
    return blocks
        .filter(b => !insideArea(from, blockArea(b)) && !insideArea(to, blockArea(b)))
        .map(b => circlePolygon(blockArea(b), 10));
}

/** Observações por onde o caminho passa (deveria ser nenhuma). */
export const blocksOnShape = (shape, blocks) => blocks.filter(b => lengthInside(shape, blockArea(b)) > 1);

/** Identifica o conjunto de observações usado no cálculo (mudou → recalcular). */
export const blocksVersion = (blocks) => blocks.map(b => `${b.id}:${b.lat},${b.lon},${b.scope}`).join('|');
