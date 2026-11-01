import * as THREE from 'three';

/*
 * Modo primeira pessoa: a câmera "entra" pela porta traseira do baú e a pessoa
 * anda lá dentro (teclado ou joystick na tela), olha em volta (arrastando),
 * pula, agacha e pega caixas na mão para conferir.
 * Paredes e caixas bloqueiam a passagem; dá para subir em caixas baixas.
 * Pegar uma caixa é só visual: ao devolver, ela volta ao lugar calculado.
 *
 * Coordenadas do baú: x centrado na largura, y = piso, z de -d/2 (cabine) a +d/2 (porta).
 */

const RADIUS = 0.22;       // "corpo" da pessoa para colisão (m)
const WALK = 1.4;          // m/s
const RUN = 2.6;           // m/s com Shift
const CROUCH_SPEED = 0.8;  // m/s agachado
const LOOK_SPEED = 0.005;  // rad por pixel arrastado
const EYE_STAND = 1.45;    // altura dos olhos em pé (m)
const EYE_CROUCH = 0.9;    // agachado
const HEAD = 0.12;         // do olho ao topo da cabeça
const STEP = 0.06;         // degrau que se sobe andando
const JUMP_SPEED = 3.3;    // m/s (~0,55 m de pulo)
const GRAVITY = 9.8;
const REACH = 2.2;         // alcance para pegar caixa (m)
const FOV_INSIDE = 65;
const ENTER_MS = 2400;
const LEAVE_MS = 1600;
const RETURN_MS = 450;     // caixa voltando ao lugar

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const MOVE_KEYS = {
    KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b',
    KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
};

/**
 * @param {object} o
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} o.controls
 * @param {HTMLCanvasElement} o.canvas
 * @param {() => object|null} o.getTruck       medidas do baú
 * @param {() => THREE.Mesh[]} o.getBoxes      caixas (posição = centro, escala = medidas, userData.id)
 * @param {() => void} o.draw                  desenha um quadro
 * @param {() => boolean} o.isVisible          aba 3D visível
 * @param {(inside: boolean) => void} o.setInside  ajusta a cena (paredes, rótulos)
 * @param {(id: string|null) => void} o.setTarget  destaca a caixa mirada
 */
export function createFirstPerson({ camera, controls, canvas, getTruck, getBoxes, draw, isVisible, setInside, setTarget }) {
    let mode = 'orbit'; // orbit | entering | walking | leaving
    let saved = null;   // câmera orbital antes de entrar
    let anim = null;
    let yaw = 0, pitch = 0, bob = 0;
    let feet = 0, vy = 0, onGround = true, crouch = false, jumpQueued = false;
    let eyeNow = EYE_STAND; // suaviza agachar/levantar
    let held = null;        // { mesh, home: Vector3 }
    let returning = [];     // caixas voltando ao lugar
    let target = null;      // caixa mirada
    const keys = new Set();
    const stick = { x: 0, y: 0 };
    let running = false;
    let raf = 0, last = 0;
    const listeners = { mode: new Set(), target: new Set(), held: new Set(), message: new Set() };
    const emit = (type, value) => listeners[type].forEach(fn => fn(value));

    const setMode = (m) => { mode = m; emit('mode', m); };

    // ---------- Medidas e colisão ----------
    const standEye = (t) => Math.max(0.3, Math.min(EYE_STAND, t.h - HEAD - 0.05));
    const eyeOffset = (t) => Math.min(crouch ? EYE_CROUCH : standEye(t), standEye(t));

    function obstacles() {
        return getBoxes().filter(m => m !== held?.mesh).map(m => ({
            mesh: m,
            minX: m.position.x - m.scale.x / 2, maxX: m.position.x + m.scale.x / 2,
            minY: m.position.y - m.scale.y / 2, maxY: m.position.y + m.scale.y / 2,
            minZ: m.position.z - m.scale.z / 2, maxZ: m.position.z + m.scale.z / 2,
        }));
    }

    const overlaps = (b, x, z, r = RADIUS) => x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r;

    /** Caixas do caminho: as baixas (até o degrau) dá para pisar; as acima da cabeça não atrapalham. */
    function blocked(x, z, footY = feet) {
        const t = getTruck();
        if (!t) return true;
        if (z < -t.d / 2 + RADIUS || z > t.d / 2 + 0.3) return true; // cabine / não sai pela porta
        if (Math.abs(x) > t.w / 2 - RADIUS) return true;               // paredes laterais
        const top = footY + eyeOffset(t) + HEAD;
        return obstacles().some(b => b.maxY > footY + STEP && b.minY < top && overlaps(b, x, z));
    }

    /** Altura do chão sob os pés: piso do baú ou topo de uma caixa. */
    function groundAt(x, z) {
        let g = 0;
        for (const b of obstacles()) {
            if (b.maxY <= feet + STEP && overlaps(b, x, z, RADIUS * 0.6)) g = Math.max(g, b.maxY);
        }
        return g;
    }

    /** Lugar livre perto da porta para "pousar"; se a porta estiver cheia, fica na soleira. */
    function spawnPoint(t) {
        feet = 0;
        for (let z = t.d / 2 - 0.35; z >= Math.max(-t.d / 2 + RADIUS, t.d / 2 - 1.6); z -= 0.1) {
            for (const x of [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75]) {
                if (!blocked(x, z)) return new THREE.Vector3(x, standEye(t), z);
            }
        }
        return new THREE.Vector3(0, standEye(t), t.d / 2 + 0.25);
    }

    // ---------- Laço de quadros (só roda enquanto há algo acontecendo) ----------
    function kick() {
        if (!raf) raf = requestAnimationFrame(frame);
    }

    const busy = () => anim || returning.length || (mode === 'walking'
        && (keys.size > 0 || stick.x !== 0 || stick.y !== 0 || !onGround || jumpQueued
            || Math.abs(eyeNow - eyeOffset(getTruck())) > 0.005));

    function frame(now) {
        raf = 0;
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
        last = now;
        if (anim) stepAnim(now);
        else if (mode === 'walking') step(dt);
        stepReturning(now);
        if (isVisible()) draw();
        if (busy()) kick();
        else last = 0;
    }

    function stepAnim(now) {
        // O horário do quadro pode ser um pouco anterior ao início da animação.
        const raw = THREE.MathUtils.clamp((now - anim.start) / anim.ms, 0, 1);
        const e = ease(raw);
        camera.position.copy(anim.curve.getPoint(e));
        camera.lookAt(new THREE.Vector3().lerpVectors(anim.lookFrom, anim.lookTo, e));
        camera.fov = THREE.MathUtils.lerp(anim.fovFrom, anim.fovTo, e);
        camera.updateProjectionMatrix();
        if (raw >= 1) {
            const done = anim.done;
            anim = null;
            done();
        }
    }

    function step(dt) {
        const t = getTruck();
        const p = camera.position;

        // Andar
        const forward = (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0) - stick.y;
        const strafe = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0) + stick.x;
        const len = Math.hypot(forward, strafe);
        if (len > 0.01) {
            const speed = crouch ? CROUCH_SPEED : running ? RUN : WALK;
            const k = (speed * dt) / Math.max(1, len);
            const sin = Math.sin(yaw), cos = Math.cos(yaw);
            const dx = (-sin * forward + cos * strafe) * k;
            const dz = (-cos * forward - sin * strafe) * k;
            // Eixo por eixo: encostar numa parede desliza em vez de travar.
            if (!blocked(p.x + dx, p.z)) p.x += dx;
            if (!blocked(p.x, p.z + dz)) p.z += dz;
            if (onGround) bob += Math.hypot(dx, dz) * 9;
        }

        // Pulo e gravidade (cai ao sair da beirada de uma caixa)
        if (jumpQueued && onGround && !crouch) { vy = JUMP_SPEED; onGround = false; }
        jumpQueued = false;
        const ground = groundAt(p.x, p.z);
        if (onGround && feet > ground + 0.001) onGround = false;
        if (!onGround) {
            vy -= GRAVITY * dt;
            feet += vy * dt;
            if (feet <= ground) { feet = ground; vy = 0; onGround = true; }
        }

        // Agachar/levantar suave; teto do baú limita a cabeça
        eyeNow += (eyeOffset(t) - eyeNow) * Math.min(1, dt * 12);
        const ceiling = t.h - HEAD - 0.03;
        if (feet + eyeNow > ceiling) {
            if (!onGround && vy > 0) vy = 0; // bateu a cabeça
            eyeNow = Math.max(0.25, ceiling - feet);
        }
        p.y = feet + eyeNow + (onGround ? Math.sin(bob) * 0.025 : 0);
        applyLook();
        updateHeld();
        updateTarget();
    }

    function applyLook() {
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }

    // ---------- Pegar caixa ----------
    const raycaster = new THREE.Raycaster();
    raycaster.far = REACH;
    const center = new THREE.Vector2(0, 0);

    function updateTarget() {
        let next = null;
        if (!held) {
            raycaster.setFromCamera(center, camera);
            next = raycaster.intersectObjects(getBoxes().filter(m => !returning.some(r => r.mesh === m)), false)[0]?.object ?? null;
        }
        if (next !== target) {
            target = next;
            setTarget(target?.userData.id ?? null);
            emit('target', target ? { id: target.userData.id } : null);
        }
    }

    /** Caixa na frente do corpo, um pouco abaixo da linha dos olhos. */
    function updateHeld() {
        if (!held) return;
        const { mesh } = held;
        const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        // Segura baixo, com o topo abaixo da linha dos olhos, para não tapar a visão.
        const dist = 0.45 + Math.max(mesh.scale.x, mesh.scale.z) / 2;
        mesh.position.copy(camera.position).addScaledVector(forward, dist);
        mesh.position.y = camera.position.y - 0.32 - mesh.scale.y / 2 + Math.sin(bob) * 0.02;
        mesh.rotation.set(0, yaw, 0);
    }

    function pick() {
        if (mode !== 'walking') return;
        if (held) { putBack(); return; }
        if (!target) { emit('message', 'Mire numa caixa (ponto no centro da tela) e chegue mais perto.'); return; }
        const box = obstacles().find(b => b.mesh === target);
        const onTop = obstacles().find(b => b.mesh !== target && Math.abs(b.minY - box.maxY) < 0.03
            && b.minX < box.maxX && b.maxX > box.minX && b.minZ < box.maxZ && b.maxZ > box.minZ);
        if (onTop) { emit('message', 'Tem outra caixa em cima desta. Pegue a de cima primeiro.'); return; }
        held = { mesh: target, home: target.position.clone() };
        target = null;
        setTarget(null);
        emit('target', null);
        emit('held', { id: held.mesh.userData.id });
        updateHeld();
        kick();
    }

    /** Devolve a caixa ao lugar calculado (com animação). */
    function putBack(instant = false) {
        if (!held) return;
        const { mesh, home } = held;
        held = null;
        emit('held', null);
        if (instant) {
            mesh.position.copy(home);
            mesh.rotation.set(0, 0, 0);
        } else {
            returning.push({ mesh, from: mesh.position.clone(), fromRot: mesh.rotation.y, home, start: performance.now() });
            kick();
        }
    }

    function stepReturning(now) {
        returning = returning.filter((r) => {
            const k = ease(THREE.MathUtils.clamp((now - r.start) / RETURN_MS, 0, 1));
            r.mesh.position.lerpVectors(r.from, r.home, k);
            r.mesh.position.y += Math.sin(k * Math.PI) * 0.25; // pequeno arco
            r.mesh.rotation.y = r.fromRot * (1 - k);
            return k < 1;
        });
    }

    // ---------- Entrar / sair ----------
    function enter() {
        const t = getTruck();
        if (!t || mode !== 'orbit') return;
        crouch = false;
        onGround = true;
        vy = 0;
        eyeNow = standEye(t);
        saved = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
        controls.enabled = false;
        const spawn = spawnPoint(t);
        const door = t.d / 2;
        const curve = new THREE.CatmullRomCurve3([
            camera.position.clone(),
            new THREE.Vector3(spawn.x * 0.5, spawn.y + 0.9, door + 3.4), // atrás do caminhão
            new THREE.Vector3(spawn.x, spawn.y + 0.1, door + 0.9),       // de frente para a porta
            spawn,
        ], false, 'centripetal');
        yaw = 0;
        pitch = -0.12;
        bob = 0;
        anim = {
            curve, start: performance.now(), ms: ENTER_MS,
            lookFrom: saved.target.clone(), lookTo: new THREE.Vector3(spawn.x, spawn.y - 0.4, -t.d / 2),
            fovFrom: camera.fov, fovTo: FOV_INSIDE,
            done: () => { applyLook(); setMode('walking'); updateTarget(); },
        };
        setInside(true);
        setMode('entering');
        kick();
    }

    /** Sai do baú. `instant` volta direto, sem animação (troca de veículo, impressão...). */
    function exit(instant = false) {
        if (mode === 'orbit' || mode === 'leaving' || !saved) return;
        keys.clear();
        stick.x = stick.y = 0;
        putBack(instant);
        target = null;
        setTarget(null);
        emit('target', null);
        const finish = () => {
            camera.position.copy(saved.pos);
            camera.fov = saved.fov;
            camera.updateProjectionMatrix();
            controls.target.copy(saved.target);
            controls.enabled = true;
            controls.update();
            setInside(false);
            saved = null;
            setMode('orbit');
            if (isVisible()) draw();
        };
        if (instant) {
            anim = null;
            returning.forEach(r => { r.mesh.position.copy(r.home); r.mesh.rotation.set(0, 0, 0); });
            returning = [];
            finish();
            return;
        }
        const t = getTruck();
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        anim = {
            curve: new THREE.CatmullRomCurve3([
                camera.position.clone(),
                new THREE.Vector3(0, camera.position.y + 0.3, t.d / 2 + 1.2),
                new THREE.Vector3(saved.pos.x * 0.6, saved.pos.y * 0.8, saved.pos.z * 0.6 + t.d / 2),
                saved.pos.clone(),
            ], false, 'centripetal'),
            start: performance.now(), ms: LEAVE_MS,
            lookFrom: camera.position.clone().add(forward.multiplyScalar(3)), lookTo: saved.target.clone(),
            fovFrom: camera.fov, fovTo: saved.fov,
            done: finish,
        };
        setMode('leaving');
        kick();
    }

    // ---------- Ações (teclado e botões da tela) ----------
    function jump() {
        if (mode !== 'walking') return;
        if (crouch) crouch = false; // pular levanta
        jumpQueued = true;
        kick();
    }
    function toggleCrouch() {
        if (mode !== 'walking') return;
        crouch = !crouch;
        emit('message', null);
        kick();
    }

    const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]');

    window.addEventListener('keydown', (e) => {
        if (mode === 'orbit' || typing(e)) return;
        if (e.key === 'Escape') { e.preventDefault(); exit(); return; }
        if (e.key === 'Shift') running = true;
        if (mode !== 'walking') return;
        if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jump(); return; }
        if (e.code === 'KeyE' || e.code === 'KeyF') { if (!e.repeat) pick(); return; }
        if (e.code === 'KeyC' || e.code === 'ControlLeft') { if (!e.repeat) toggleCrouch(); return; }
        const k = MOVE_KEYS[e.code];
        if (!k) return;
        e.preventDefault(); // setas não rolam a página
        keys.add(k);
        kick();
    });
    window.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') running = false;
        const k = MOVE_KEYS[e.code];
        if (k) keys.delete(k);
    });
    window.addEventListener('blur', () => { keys.clear(); running = false; });

    let drag = null;
    canvas.addEventListener('pointerdown', (e) => {
        if (mode !== 'walking') return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        yaw -= (e.clientX - drag.x) * LOOK_SPEED;
        pitch = THREE.MathUtils.clamp(pitch - (e.clientY - drag.y) * LOOK_SPEED, -1.3, 1.3);
        drag.x = e.clientX;
        drag.y = e.clientY;
        applyLook();
        updateHeld();
        updateTarget();
        kick();
    });
    const endDrag = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    return {
        enter,
        exit,
        jump,
        pick,
        toggleCrouch,
        isCrouching: () => crouch,
        isActive: () => mode !== 'orbit',
        mode: () => mode,
        /** As caixas foram redesenhadas: solta a que estava na mão (o objeto antigo deixou de existir). */
        boxesChanged() {
            if (held) { held = null; emit('held', null); }
            returning = [];
            target = null;
            emit('target', null);
        },
        /** Joystick da tela: x = lado (-1..1), y = frente (-1) / trás (1). */
        setStick(x, y) {
            stick.x = x;
            stick.y = y;
            if (mode === 'walking') kick();
        },
        on(type, fn) { listeners[type].add(fn); return () => listeners[type].delete(fn); },
        resume: kick,
    };
}
