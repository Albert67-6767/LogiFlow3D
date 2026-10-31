import * as THREE from 'three';
import { NAVIGATION, HEAVY_PAYLOAD } from '../config/constants.js';

/*
 * Cabine do veículo, desenhada à frente do baú (z negativo).
 * Cada tipo é um perfil lateral (u = metros para a frente, v = altura)
 * extrudado na largura do veículo. Só formas simples: leve e sem arquivos 3D.
 */

/** Tipo de cabine: o escolhido no cadastro ou, em "auto", pela carga máxima. */
export function cabinStyle(truck) {
    if (truck?.cabin && truck.cabin !== 'auto') return truck.cabin;
    const payload = truck?.payload ?? 0;
    if (payload < NAVIGATION.vucPayload) return 'van';
    if (payload < HEAVY_PAYLOAD) return 'vuc';
    return 'caminhao';
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/**
 * Perfis laterais.
 * points: contorno da lataria · back/front: retas que limitam os vidros
 * (coluna traseira e para-brisa) · low/top: altura dos vidros · lightY: faróis.
 */
function profile(style, t) {
    switch (style) {
        case 'van': { // furgão (tipo Ducato/Sprinter): alto, teto alinhado ao baú e capô curto
            const H = clamp(t.h + RUNNING.van.drop + 0.06, 1.5, 3);
            return {
                H, width: Math.max(t.w + 0.1, 1.6),
                points: [[0, 0], [0, H], [0.6, H], [0.75, H - 0.08], [1.2, H * 0.55], [1.55, H * 0.45], [1.68, H * 0.33], [1.66, 0]],
                back: [[0.12, 0], [0.12, H]], front: [[0.75, H - 0.08], [1.2, H * 0.55]],
                low: H * 0.58, top: H - 0.16, lightY: H * 0.38,
            };
        }
        case 'vuc': { // cabine curta com bico pequeno (tipo HR)
            const H = clamp(t.h * 0.9, 1.6, 2.6);
            return {
                H, width: Math.max(t.w * 0.96, 1.6),
                points: [[0, 0], [0, H], [1.15, H], [1.5, H * 0.55], [1.8, H * 0.45], [1.88, H * 0.3], [1.85, 0]],
                back: [[0.3, 0], [0.3, H]], front: [[1.15, H], [1.5, H * 0.55]],
                low: H * 0.62, top: H - 0.12, lightY: H * 0.3,
            };
        }
        case 'sedan': { // capô longo, vidro traseiro inclinado até o porta-malas
            const H = 1.42, belt = 0.95;
            return {
                H, width: Math.max(t.w, 1.7),
                points: [[0, 0], [0, belt], [0.55, H], [1.65, H], [2.35, belt + 0.05], [3.3, belt - 0.12], [3.42, 0.55], [3.38, 0]],
                back: [[0, belt], [0.55, H]], front: [[1.65, H], [2.35, belt + 0.05]],
                low: belt + 0.08, top: H - 0.07, lightY: belt - 0.2,
            };
        }
        case 'hatch': { // traseira quase reta, carro compacto
            const H = 1.45, belt = 0.95;
            return {
                H, width: Math.max(t.w, 1.65),
                points: [[0, 0], [0, belt], [0.25, H], [1.45, H], [2.15, belt + 0.05], [2.95, belt - 0.12], [3.05, 0.55], [3.0, 0]],
                back: [[0, belt], [0.25, H]], front: [[1.45, H], [2.15, belt + 0.05]],
                low: belt + 0.08, top: H - 0.07, lightY: belt - 0.2,
            };
        }
        case 'picape': { // cabine simples com traseira reta; o baú é a caçamba
            const H = 1.8, belt = 1.05;
            return {
                H, width: Math.max(t.w, 1.8),
                points: [[0, 0], [0, H], [1.35, H], [2.0, belt + 0.05], [3.1, belt - 0.05], [3.2, 0.6], [3.15, 0]],
                back: [[0.15, 0], [0.15, H]], front: [[1.35, H], [2.0, belt + 0.05]],
                low: belt + 0.1, top: H - 0.1, lightY: belt - 0.2,
            };
        }
        case 'suv': { // alto, teto longo e capô curto
            const H = 1.75, belt = 1.05;
            return {
                H, width: Math.max(t.w, 1.8),
                points: [[0, 0], [0, belt], [0.12, H], [1.75, H], [2.4, belt + 0.05], [3.2, belt - 0.08], [3.3, 0.6], [3.25, 0]],
                back: [[0, belt], [0.12, H]], front: [[1.75, H], [2.4, belt + 0.05]],
                low: belt + 0.1, top: H - 0.08, lightY: belt - 0.2,
            };
        }
        default: { // caminhão de cabine avançada (frente reta), tipo toco/truck
            const H = clamp(t.h * 0.9, 1.7, 2.9);
            return {
                H, width: Math.max(t.w * 0.96, 1.8),
                points: [[0, 0], [0, H], [1.45, H * 0.98], [1.68, H * 0.55], [1.72, H * 0.2], [1.7, 0]],
                back: [[0.3, 0], [0.3, H]], front: [[1.45, H * 0.98], [1.68, H * 0.55]],
                low: H * 0.6, top: H - 0.12, lightY: H * 0.22,
            };
        }
    }
}

const BEVEL = 0.05;

/**
 * Rodas e altura de cada tipo. lift: altura do piso do baú em relação ao chão ·
 * drop: quanto a cabine desce abaixo do piso do baú · front: eixo dianteiro
 * (metros à frente da traseira da cabine) · rear: eixo traseiro (fração do baú, a partir da frente).
 */
const RUNNING = {
    caminhao: { r: 0.5, tire: 0.28, lift: 1.15, drop: 0, front: 0.85, rear: 0.7, dual: true },
    vuc: { r: 0.38, tire: 0.22, lift: 0.85, drop: 0, front: 1.3, rear: 0.68, dual: true },
    van: { r: 0.33, tire: 0.22, lift: 0.62, drop: 0.27, front: 1.22, rear: 0.72, dual: false },
    sedan: { r: 0.31, tire: 0.2, lift: 0.62, drop: 0.42, front: 2.85, rear: 0.35, dual: false },
    hatch: { r: 0.31, tire: 0.2, lift: 0.62, drop: 0.42, front: 2.45, rear: 0.45, dual: false },
    picape: { r: 0.37, tire: 0.24, lift: 0.85, drop: 0.55, front: 2.55, rear: 0.5, dual: false },
    suv: { r: 0.37, tire: 0.24, lift: 0.78, drop: 0.5, front: 2.65, rear: 0.4, dual: false },
};

/** Uma roda (pneu + aro) com o eixo em x. */
function wheel(r, tire, colors) {
    const g = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, tire, 24), new THREE.MeshStandardMaterial({ color: colors.tire, roughness: 0.95 }));
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, tire + 0.02, 16), new THREE.MeshStandardMaterial({ color: colors.rim, roughness: 0.4, metalness: 0.5 }));
    g.add(tyre, rim);
    g.rotation.z = Math.PI / 2;
    return g;
}

/** Extruda um perfil (u,v) na largura `width`, já virado para -z e centrado em x. */
function extrude(points, width, bevel = 0) {
    const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
    const geo = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.01, width - 2 * bevel),
        bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 1,
    });
    geo.rotateY(Math.PI / 2); // u (para a frente) → -z, extrusão → +x
    geo.translate(-(width - 2 * bevel) / 2, 0, 0);
    return geo;
}

/** Ponto da reta [A, B] na altura v. */
function at([[u1, v1], [u2, v2]], v) {
    return [u1 + (u2 - u1) * ((v - v1) / (v2 - v1)), v];
}

/** Afasta cada lado de um polígono convexo `d` metros para fora. */
function grow(poly, d) {
    const area = poly.reduce((s, [u, v], i) => {
        const [u2, v2] = poly[(i + 1) % poly.length];
        return s + u * v2 - u2 * v;
    }, 0);
    const sign = area > 0 ? 1 : -1;
    const lines = poly.map(([u1, v1], i) => {
        const [u2, v2] = poly[(i + 1) % poly.length];
        const len = Math.hypot(u2 - u1, v2 - v1);
        const nu = sign * (v2 - v1) / len, nv = sign * -(u2 - u1) / len;
        return { p: [u1 + nu * d, v1 + nv * d], dir: [u2 - u1, v2 - v1] };
    });
    return lines.map((b, i) => {
        const a = lines[(i - 1 + lines.length) % lines.length];
        const den = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
        const s = ((b.p[0] - a.p[0]) * b.dir[1] - (b.p[1] - a.p[1]) * b.dir[0]) / den;
        return [a.p[0] + a.dir[0] * s, a.p[1] + a.dir[1] * s];
    });
}

/** Ponto mais à frente da lataria na altura v. */
function frontAt(points, v) {
    let best = 0;
    points.forEach(([u1, v1], i) => {
        const [u2, v2] = points[(i + 1) % points.length];
        if ((v - v1) * (v - v2) <= 0 && v1 !== v2) best = Math.max(best, u1 + (u2 - u1) * ((v - v1) / (v2 - v1)));
    });
    return best;
}

/**
 * Monta a cabine. Retorna { group, under (rodas/chassi), lift, height, length, width, style }.
 * `t` = veículo (medidas do baú + tipo de cabine); `colors` = paleta do tema.
 */
export function buildCabin(t, colors) {
    const style = cabinStyle(t);
    const p = profile(style, t);
    const { H, width } = p;
    const car = ['sedan', 'hatch', 'picape', 'suv'].includes(style);
    const group = new THREE.Group();

    const body = new THREE.Mesh(
        extrude(p.points, width, BEVEL),
        new THREE.MeshStandardMaterial({ color: colors.cabinBody, roughness: 0.45, metalness: 0.15 }),
    );

    // Vidros (para-brisa, laterais e traseiro) numa peça só, um pouco para fora da lataria.
    const glassPoly = grow([at(p.back, p.low), at(p.back, p.top), at(p.front, p.top), at(p.front, p.low)], BEVEL + 0.012);
    const glass = new THREE.Mesh(
        extrude(glassPoly, width + 0.02),
        new THREE.MeshStandardMaterial({ color: colors.glass, roughness: 0.15, metalness: 0.6 }),
    );

    // Para-choque, faróis e retrovisores.
    const trim = new THREE.MeshStandardMaterial({ color: colors.trim, roughness: 0.8 });
    const bumperY = car ? 0.35 : 0.2;
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, car ? 0.18 : 0.22, 0.14), trim);
    bumper.position.set(0, bumperY, -(frontAt(p.points, bumperY) + BEVEL) - 0.03);

    const lightMat = new THREE.MeshStandardMaterial({ color: 0xfef9c3, emissive: 0xfde68a, emissiveIntensity: 0.6 });
    const lightZ = -(frontAt(p.points, p.lightY) + BEVEL) - 0.005;
    const lights = [-1, 1].map((side) => {
        const light = new THREE.Mesh(new THREE.BoxGeometry(car ? 0.34 : 0.28, car ? 0.1 : 0.14, 0.04), lightMat);
        light.position.set(side * (width / 2 - (car ? 0.25 : 0.22)), p.lightY, lightZ);
        return light;
    });

    const mirrorY = p.low + (car ? 0.02 : 0.05);
    const mirrors = [-1, 1].map((side) => {
        const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.06, car ? 0.1 : style === 'van' ? 0.16 : 0.32, car ? 0.16 : 0.12), trim);
        mirror.position.set(side * (width / 2 + BEVEL + (car ? 0.08 : 0.12)), mirrorY, -at(p.front, mirrorY)[0] + 0.12);
        return mirror;
    });

    group.add(body, glass, bumper, ...lights, ...mirrors);
    // O bisel aumenta a peça para todos os lados: sobe e recua para não atravessar o baú.
    const run = RUNNING[style] ?? RUNNING.caminhao;
    group.position.y = BEVEL - run.drop;
    group.position.z = -BEVEL;

    return {
        group, style, lift: run.lift,
        under: buildRunningGear(t, style, width, colors),
        height: H + 2 * BEVEL - run.drop,
        length: frontAt(p.points, p.lightY) + 2 * BEVEL,
        width: width + 0.3,
    };
}

/**
 * Rodas, chassi e lataria abaixo do baú, em coordenadas do baú
 * (piso do baú em y = 0, chão em y = -lift, traseira da cabine em z = -d/2).
 */
function buildRunningGear(t, style, cabWidth, colors) {
    const run = RUNNING[style] ?? RUNNING.caminhao;
    const group = new THREE.Group();
    const groundY = -run.lift;
    const frontZ = -t.d / 2 - BEVEL - run.front;
    const rearZ = -t.d / 2 + t.d * run.rear;
    const heavy = style === 'caminhao' || style === 'vuc';

    // Eixo dianteiro (largura da cabine) e traseiro (largura do baú ou da carroceria).
    const frontX = cabWidth / 2 - run.tire / 2 + 0.06;
    const rearX = (heavy ? t.w : cabWidth) / 2 - run.tire / 2 + (heavy ? -0.02 : 0.06);
    for (const side of [-1, 1]) {
        const f = wheel(run.r, run.tire, colors);
        f.position.set(side * frontX, groundY + run.r, frontZ);
        group.add(f);
        for (const off of run.dual ? [0, run.tire + 0.03] : [0]) {
            const w = wheel(run.r, run.tire, colors);
            w.position.set(side * (rearX - off), groundY + run.r, rearZ);
            group.add(w);
        }
    }

    const trim = new THREE.MeshStandardMaterial({ color: colors.trim, roughness: 0.8 });
    if (heavy) {
        // Longarinas do chassi, da frente da cabine até a traseira do baú.
        const len = t.d / 2 - (frontZ - run.r);
        for (const side of [-1, 1]) {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, len), trim);
            rail.position.set(side * Math.min(0.45, t.w * 0.3), -0.14, t.d / 2 - len / 2);
            group.add(rail);
        }
        // Para-choque traseiro.
        const bar = new THREE.Mesh(new THREE.BoxGeometry(t.w * 0.9, 0.12, 0.1), trim);
        bar.position.set(0, groundY + run.r + 0.05, t.d / 2 - 0.05);
        group.add(bar);
    } else {
        // Lataria abaixo do baú (porta-malas, caçamba ou furgão), na cor da cabine.
        const skirt = new THREE.Mesh(
            new THREE.BoxGeometry(cabWidth - 0.04, run.drop, t.d + BEVEL),
            new THREE.MeshStandardMaterial({ color: colors.cabinBody, roughness: 0.45, metalness: 0.15 }),
        );
        skirt.position.set(0, -run.drop / 2, -BEVEL / 2);
        group.add(skirt);
    }
    return group;
}
