import { NAVIGATION } from '../config/constants.js';
import { haversine } from './geo.js';

/*
 * Navegação curva a curva (puro, sem tela): junta os trechos escolhidos numa
 * rota só, encaixa a posição do GPS na linha e calcula a próxima manobra,
 * a distância até ela e os horários de chegada em cada parada.
 */

/**
 * Fator sobre o tempo do serviço de rotas. O perfil "truck" já considera
 * velocidades de caminhão; vans e VUCs usam o perfil de carro, então somamos uma folga.
 */
export function driveTimeFactor(truck, profile) {
    if (profile === 'truck') return 1;
    return truck.payload >= NAVIGATION.vucPayload ? NAVIGATION.vucTimeFactor : NAVIGATION.vanTimeFactor;
}

/** Corrige detalhes do texto do serviço ("Então, Vire" → "Então, vire"). */
export const tidy = (text) => String(text ?? '').replace(/(Então,|Depois,) (\p{Lu})/gu, (_, a, b) => `${a} ${b.toLowerCase()}`).trim();

const DESTINATION = new Set([4, 5, 6]);

/**
 * Monta a rota de navegação.
 * @param alts  caminho escolhido de cada trecho ({ shape, km, min, maneuvers? })
 * @param stops paradas na ordem ({ stop, address, point, items })
 * @param timeFactor multiplicador do tempo (ver driveTimeFactor)
 */
export function buildNav(alts, stops, timeFactor = 1) {
    const points = [];
    const cum = [];       // metros desde o início, por ponto
    const time = [];      // segundos desde o início, por ponto
    const maneuvers = [];
    const legs = [];
    let dist = 0, secs = 0;

    alts.forEach((alt, li) => {
        const start = points.length;
        const legStartDist = dist;
        const legStartTime = secs;
        // Distância acumulada dentro do trecho
        const local = [0];
        for (let i = 1; i < alt.shape.length; i++) {
            local.push(local[i - 1] + haversine(pt(alt.shape[i - 1]), pt(alt.shape[i])));
        }
        const legLen = local.at(-1) || 1;
        const legSecs = alt.min * 60 * timeFactor;

        // Manobras: usa as do serviço ou cria início/chegada genéricos.
        const ms = alt.maneuvers?.length ? alt.maneuvers : [
            { type: 1, text: 'Siga a rota destacada no mapa.', s: 0, min: alt.min },
            { type: 4, text: 'Você chegou ao destino.', s: alt.shape.length - 1, min: 0 },
        ];
        // Tempo distribuído pela distância de cada manobra (o serviço informa o tempo de cada uma).
        const totalMin = ms.reduce((a, m) => a + (m.min || 0), 0) || alt.min || 1;
        const mStartTime = [];
        let acc = 0;
        for (const m of ms) { mStartTime.push(acc); acc += ((m.min || 0) / totalMin) * legSecs; }

        for (let i = 0; i < alt.shape.length; i++) {
            points.push(alt.shape[i]);
            cum.push(legStartDist + local[i]);
            // índice da manobra em vigor neste ponto
            let k = 0;
            while (k + 1 < ms.length && ms[k + 1].s <= i) k++;
            const mFrom = local[Math.min(ms[k].s, local.length - 1)];
            const mTo = k + 1 < ms.length ? local[Math.min(ms[k + 1].s, local.length - 1)] : legLen;
            const share = mTo > mFrom ? (local[i] - mFrom) / (mTo - mFrom) : 0;
            const mSecs = k + 1 < ms.length ? mStartTime[k + 1] - mStartTime[k] : legSecs - mStartTime[k];
            time.push(legStartTime + mStartTime[k] + share * mSecs);
        }

        ms.forEach((m) => {
            const s = Math.min(m.s, alt.shape.length - 1);
            maneuvers.push({
                type: m.type,
                text: tidy(m.text),
                alert: tidy(m.alert || m.text),
                street: m.street || '',
                exit: m.exit ?? null,
                leg: li,
                dist: legStartDist + local[s],
            });
        });

        dist = legStartDist + legLen;
        secs = legStartTime + legSecs;
        legs.push({ ...stops[li], start, end: points.length - 1, startDist: legStartDist, endDist: dist, endTime: secs });
    });

    return { points, cum, time, maneuvers, legs, totalM: dist, totalS: secs };
}

const pt = ([lat, lon]) => ({ lat, lon });

/** Tempo (s desde o início) num ponto qualquer da rota, em metros. */
export function timeAt(nav, along) {
    const { cum, time } = nav;
    if (along <= 0) return 0;
    if (along >= nav.totalM) return nav.totalS;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= along) lo = mid; else hi = mid;
    }
    const span = cum[hi] - cum[lo];
    return span > 0 ? time[lo] + ((along - cum[lo]) / span) * (time[hi] - time[lo]) : time[lo];
}

/** Ponto [lat, lon] a uma distância `along` do início (usado na simulação). */
export function pointAt(nav, along) {
    const { cum, points } = nav;
    if (along <= 0) return points[0];
    if (along >= nav.totalM) return points.at(-1);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < along) i++;
    const span = cum[i] - cum[i - 1];
    const t = span > 0 ? (along - cum[i - 1]) / span : 0;
    const [a, b] = [points[i - 1], points[i]];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Encaixa a posição na rota, procurando só dentro do trecho atual
 * (evita "pular" para outro trecho que passa pela mesma rua).
 * Retorna { along, offset } — offset = distância (m) até a linha.
 */
export function snap(nav, pos, legIdx) {
    const leg = nav.legs[legIdx];
    const { points, cum } = nav;
    const k = Math.cos((pos.lat * Math.PI) / 180) * 111320;
    const toXY = ([lat, lon]) => [(lon - pos.lon) * k, (lat - pos.lat) * 110540];
    let best = { along: leg.startDist, offset: Infinity };
    for (let i = Math.max(leg.start, 0); i < leg.end; i++) {
        const [ax, ay] = toXY(points[i]);
        const [bx, by] = toXY(points[i + 1]);
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        const px = ax + t * dx, py = ay + t * dy;
        const offset = Math.hypot(px, py);
        if (offset < best.offset) best = { along: cum[i] + t * (cum[i + 1] - cum[i]), offset };
    }
    return best;
}

/**
 * Situação atual da viagem.
 * @param along  metros percorridos desde o início da rota
 * @param legIdx trecho atual (parada que está sendo buscada)
 * @param now    horário atual (ms)
 * @param unloadMin minutos de descarga em cada parada
 */
export function progress(nav, along, legIdx, now = Date.now(), unloadMin = 0) {
    const leg = nav.legs[legIdx];
    along = Math.max(leg.startDist, Math.min(along, leg.endDist));

    // Próxima manobra deste trecho (a primeira que ainda está à frente).
    const legMs = nav.maneuvers.filter(m => m.leg === legIdx);
    let nextIdx = legMs.findIndex(m => m.dist > along + 3);
    if (nextIdx < 0) nextIdx = legMs.length - 1;
    const next = legMs[nextIdx];
    const after = legMs[nextIdx + 1] ?? null;

    const tNow = timeAt(nav, along);
    const toStopM = leg.endDist - along;
    const toStopS = leg.endTime - tNow;

    // Horário de chegada em cada parada restante (somando as descargas no caminho).
    const etas = nav.legs.slice(legIdx).map((l, j) => ({
        stop: l.stop,
        at: now + (l.endTime - tNow) * 1000 + j * unloadMin * 60000,
    }));

    return {
        along,
        next,
        after,
        toNextM: Math.max(0, next.dist - along),
        toStopM,
        toStopS,
        toEndM: nav.totalM - along,
        etas,
        arrived: toStopM <= NAVIGATION.arriveM,
        isLastLeg: legIdx === nav.legs.length - 1,
    };
}

/** "350 m", "1,2 km" — arredondado como nos apps de navegação. */
export function spokenDistance(m) {
    if (m < 50) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
    if (m < 975) return `${Math.round(m / 50) * 50} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`;
}

export const isDestination = (type) => DESTINATION.has(type);
