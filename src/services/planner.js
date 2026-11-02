import { actions, getState, getDerived } from '../state/store.js';
import { addressKey, circlePolygon, insideArea } from '../core/geo.js';
import { legKey, riskExposure, vehicleKey } from '../core/routing.js';
import { blocksFor, blockPolygons, blocksVersion } from '../core/roadBlocks.js';
import { geocode, fetchAlternatives } from './mapApi.js';

/*
 * Orquestra o cálculo da rota: localiza endereços que faltam, busca os
 * caminhos de cada trecho (reaproveitando os já calculados) e, quando todos
 * passam por áreas de atenção, procura também um desvio.
 */

let running = false;

const status = (message) => actions.setRouteStatus({ busy: true, message });

/** Localiza a base e as paradas ainda sem posição. Retorna os endereços não encontrados. */
export async function locateAddresses() {
    const notFound = [];
    const s = getState();

    if (s.depot?.address && !Number.isFinite(s.depot.lat)) {
        status('Localizando a base…');
        const hit = await geocode(s.depot.address);
        if (hit) actions.setDepot({ lat: hit.lat, lon: hit.lon, label: hit.label, bairro: hit.bairro });
        else notFound.push(s.depot.address);
    }

    const pending = getDerived().stops.filter(st => st.address && !st.point && !getState().geo[addressKey(st.address)]?.notFound);
    // Referência para priorizar endereços próximos: a base (ou uma parada já localizada).
    const near = getDerived().depotPoint ?? getDerived().stops.find(st => st.point)?.point ?? null;
    for (const [i, st] of pending.entries()) {
        status(`Localizando endereços (${i + 1}/${pending.length})…`);
        const hit = await geocode(st.address, near);
        if (hit) actions.setGeo(st.address, hit);
        else {
            actions.setGeo(st.address, { notFound: true });
            notFound.push(st.address);
        }
    }
    return notFound;
}

/** Áreas cruzadas pelo caminho, sem contar as que contêm a origem ou o destino. */
function areasToAvoid(alternatives, areas, from, to) {
    const crossed = new Set();
    for (const alt of alternatives) riskExposure(alt.shape, areas).areas.forEach(a => crossed.add(a.id));
    return areas.filter(a => crossed.has(a.id) && !insideArea(from, a) && !insideArea(to, a));
}

/** Calcula (ou atualiza) a rota completa. Mostra o progresso em state.routeStatus. */
export async function planRoute() {
    if (running) return { ok: false, message: 'Já existe um cálculo em andamento.' };
    running = true;
    try {
        const notFound = await locateAddresses();
        const s = getState();
        const d = getDerived();
        const waypoints = [d.depotPoint, ...d.stops.map(st => st.point)];
        const previous = new Map((s.routePlan?.legs ?? []).map(l => [l.key, l]));
        const legs = [];
        let failures = 0;

        for (let i = 1; i < waypoints.length; i++) {
            const from = waypoints[i - 1], to = waypoints[i];
            if (!from || !to) continue;
            const key = legKey(from, to, d.profile);
            const cached = previous.get(key);
            const vehicle = vehicleKey(d.truck, d.profile);
            const blocks = blocksFor(s.roadBlocks, d.profile);
            const blocksV = blocksVersion(blocks);
            const exclude = blockPolygons(blocks, from, to);
            // Reaproveita o trecho já calculado (com instruções de curva, mesmas áreas e mesmo veículo).
            if (cached?.alternatives?.length && cached.alternatives[0].maneuvers && cached.areasVersion === areasVersion(s.riskAreas)
                && cached.vehicle === vehicle && cached.alternatives[0].narrowKm !== undefined && (cached.blocksVersion ?? '') === blocksV) {
                legs.push(cached);
                continue;
            }

            status(`Calculando trecho ${i} de ${waypoints.length - 1}…`);
            try {
                const alternatives = await fetchAlternatives(from, to, { profile: d.profile, truck: d.truck, blocks: exclude });
                const avoid = areasToAvoid(alternatives, s.riskAreas, from, to);
                if (avoid.length) {
                    status(`Procurando desvio no trecho ${i}…`);
                    try {
                        const detours = await fetchAlternatives(from, to, {
                            profile: d.profile, truck: d.truck, avoid: avoid.map(a => circlePolygon(a)), blocks: exclude,
                        });
                        for (const det of detours) {
                            const dup = alternatives.some(a => Math.abs(a.km - det.km) < 0.05 && Math.abs(a.min - det.min) < 0.2);
                            if (!dup) alternatives.push(det);
                        }
                    } catch { /* sem desvio possível: fica com as alternativas normais */ }
                }
                legs.push({ key, alternatives, areasVersion: areasVersion(s.riskAreas), vehicle, blocksVersion: blocksV });
            } catch (err) {
                failures++;
                legs.push({ key, alternatives: [], error: err.message });
            }
        }

        actions.setRoutePlan({ legs, choice: keepChoices(s.routePlan?.choice, legs), at: Date.now() });

        const parts = [];
        if (notFound.length) parts.push(`${notFound.length} endereço(s) não encontrado(s): marque no mapa`);
        if (failures) parts.push(`${failures} trecho(s) sem caminho`);
        return { ok: !failures && !notFound.length, message: parts.join(' · ') };
    } finally {
        running = false;
        actions.setRouteStatus({ busy: false });
    }
}

/** Identifica o conjunto de áreas usado na busca de desvios. */
export const areasVersion = (areas) => areas.map(a => `${a.id}:${a.lat},${a.lon},${a.radius},${a.level}`).join('|');

function keepChoices(choice = {}, legs) {
    const keys = new Set(legs.map(l => l.key));
    return Object.fromEntries(Object.entries(choice).filter(([k]) => keys.has(k)));
}
