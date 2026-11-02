import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { colorForStop } from '../config/constants.js';
import { buildCabin } from './cabin.js';
import { createFirstPerson } from './firstPerson.js';
import { boxOnTop, dropBox, snapXZ, turned } from '../core/manualLayout.js';

/*
 * Cena 3D do baú. Recebe dados já calculados (posições do packer) e só desenha.
 * Renderiza sob demanda: nada é desenhado enquanto a câmera está parada
 * ou quando a aba 3D não está visível.
 *
 * Mundo: x centrado na largura, y = piso, z de -d/2 (cabine) a +d/2 (porta).
 */

const THEMES = {
    dark: {
        background: 0x16161b, grid: [0x363c48, 0x2a2d35], ground: 0x2a2d35,
        wall: 0x00a3e0, wallEdge: 0x29b8ea, floor: 0x363c48, cabin: 0x2a2d35,
        door: 0x8cc63f, doorLabel: "#9fd05a", cabinLabel: "#8d98a8",
        cabinBody: 0x64748b, glass: 0x0b1220, trim: 0x111827, tire: 0x0a0a0a, rim: 0x9ca3af,
        edge: 0x16161b, edgeFragile: 0xfbbf24, edgeSelected: 0xffffff, cog: 0xef4444,
    },
    light: {
        background: 0xf2f4f7, grid: [0xb1b9c5, 0xd3d8df], ground: 0xd3d8df,
        wall: 0x00a3e0, wallEdge: 0x0086b8, floor: 0x8d98a8, cabin: 0x5f6e83,
        door: 0x71a52f, doorLabel: "#578025", cabinLabel: "#4a5566",
        cabinBody: 0xf8fafc, glass: 0x1e293b, trim: 0x334155, tire: 0x1f2937, rim: 0xd1d5db,
        edge: 0x0f172a, edgeFragile: 0xd97706, edgeSelected: 0x0f172a, cog: 0xdc2626,
    },
};
let COLORS = THEMES.dark;

function disposeTree(obj) {
    obj.traverse(o => {
        if (o.userData.sharedGeometry !== true) o.geometry?.dispose();
        if (o.userData.sharedMaterial !== true) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach(m => { m?.map?.dispose(); m?.dispose(); });
        }
    });
}

function clearGroup(group) {
    for (const child of [...group.children]) {
        group.remove(child);
        disposeTree(child);
    }
}

function makeLabel(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false }));
    sprite.scale.set(1.2, 0.3, 1);
    sprite.renderOrder = 10; // sempre por cima do veículo
    sprite.userData.sharedGeometry = true; // a geometria dos sprites é global no Three.js
    return sprite;
}

export function createScene(container, { onHover, onSelect, onMove, onEditMessage } = {}) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute('aria-label', 'Visualização 3D do baú. Arraste para girar, role para aproximar.');
    renderer.domElement.setAttribute('role', 'img');
    container.prepend(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.background);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.minDistance = 1.5;
    controls.maxDistance = 40;

    const hemi = new THREE.HemisphereLight(0xffffff, COLORS.ground, 1.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(5, 10, 7);
    scene.add(sun);

    let grid = null;
    let groundLift = 0; // altura do piso do baú em relação ao chão
    function makeGrid() {
        if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
        grid = new THREE.GridHelper(30, 60, ...COLORS.grid);
        grid.position.y = -groundLift - 0.01; // o chão fica abaixo das rodas
        scene.add(grid);
    }
    makeGrid();

    const truckGroup = new THREE.Group();
    const boxGroup = new THREE.Group();
    const cogGroup = new THREE.Group();
    scene.add(truckGroup, boxGroup, cogGroup);

    // Recursos compartilhados pelas caixas (uma geometria para todas).
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const unitEdges = new THREE.EdgesGeometry(unitBox);
    const edgeMats = {
        normal: new THREE.LineBasicMaterial({ color: COLORS.edge }),
        fragile: new THREE.LineBasicMaterial({ color: COLORS.edgeFragile }),
        selected: new THREE.LineBasicMaterial({ color: COLORS.edgeSelected }),
    };

    // Marcador do centro de gravidade: esfera + haste até o piso.
    const cogMat = new THREE.MeshBasicMaterial({ color: COLORS.cog, wireframe: true });
    const cogSphere = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), cogMat);
    const cogStemGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0)]);
    const cogStem = new THREE.Line(cogStemGeo, new THREE.LineDashedMaterial({ color: COLORS.cog, dashSize: 0.05, gapSize: 0.04 }));
    cogGroup.add(cogSphere, cogStem);
    cogGroup.visible = false;

    let truck = null;
    let cabinSize = { length: 0, height: 0, width: 0 }; // para enquadrar o veículo inteiro
    let wallsOpaqueNow = false;
    let wallsMesh = null;   // paredes do baú (opacidade muda dentro do modo primeira pessoa)
    let labelSprites = [];  // PORTA / CABINE (somem lá dentro)
    let firstPerson = null; // criado mais abaixo
    let hoveredId = null;
    let selectedId = null;
    let placedNow = [];     // posições atuais (para validar o arraste)
    let editMode = false;   // cadeado aberto: dá para arrastar as caixas
    let drag = null;
    let active = true;
    let pending = false;

    // ---------- Renderização sob demanda ----------
    function render() {
        pending = false;
        if (!active) return;
        // Em primeira pessoa a câmera é controlada pelo modo de andar, não pela órbita.
        if (!firstPerson?.isActive()) controls.update(); // com damping, dispara 'change' enquanto houver inércia
        renderer.render(scene, camera);
    }
    function requestRender() {
        if (!pending && active) {
            pending = true;
            requestAnimationFrame(render);
        }
    }
    controls.addEventListener('change', requestRender);

    let sized = false;
    const resizeObserver = new ResizeObserver(() => {
        const { clientWidth: w, clientHeight: h } = container;
        if (w === 0 || h === 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        if (!sized) { sized = true; fitCamera(); } // primeiro tamanho real: enquadra o baú
        requestRender();
    });
    resizeObserver.observe(container);

    // ---------- Construção ----------
    function setTruck(t, wallsOpaque) {
        const changed = !truck || truck.w !== t.w || truck.h !== t.h || truck.d !== t.d || truck.cabin !== t.cabin;
        if (changed) firstPerson?.exit(true);
        truck = t;
        wallsOpaqueNow = wallsOpaque;
        clearGroup(truckGroup);

        const shell = new THREE.BoxGeometry(t.w, t.h, t.d);
        const walls = new THREE.Mesh(shell, new THREE.MeshStandardMaterial({
            color: COLORS.wall,
            transparent: true,
            opacity: wallsOpaque ? 0.55 : 0.1,
            side: THREE.BackSide, // só as paredes do fundo aparecem: o interior fica visível
            depthWrite: false,
        }));
        walls.position.y = t.h / 2;
        walls.renderOrder = -1;
        wallsMesh = walls;

        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shell), new THREE.LineBasicMaterial({ color: COLORS.wallEdge }));
        edges.position.y = t.h / 2;

        const floor = new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.05, t.d), new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.9 }));
        floor.position.y = -0.025;

        // Cabine à frente (z negativo), no estilo do tipo de veículo.
        const cabin = buildCabin(t, COLORS);
        cabin.group.position.z += -t.d / 2 - 0.04;
        cabin.under.position.z = -0.04;
        cabinSize = { length: cabin.length + 0.04, height: cabin.height, width: cabin.width };
        if (groundLift !== cabin.lift) { groundLift = cabin.lift; makeGrid(); }

        // Moldura da porta (traseira).
        const doorFrame = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.PlaneGeometry(t.w, t.h)),
            new THREE.LineBasicMaterial({ color: COLORS.door }),
        );
        doorFrame.position.set(0, t.h / 2, t.d / 2 + 0.005);

        const doorLabel = makeLabel('PORTA', COLORS.doorLabel);
        doorLabel.position.set(0, t.h + 0.25, t.d / 2);
        const cabinLabel = makeLabel('CABINE', COLORS.cabinLabel);
        cabinLabel.position.set(0, cabin.height + 0.4, -t.d / 2 - cabin.length / 2);

        truckGroup.add(walls, edges, floor, cabin.group, cabin.under, doorFrame, doorLabel, cabinLabel);
        labelSprites = [doorLabel, cabinLabel];
        if (firstPerson?.isActive()) applyInside(true);

        if (changed) fitCamera();
        requestRender();
    }

    function setBoxes(placed, itemsById) {
        firstPerson?.boxesChanged();
        drag = null;
        placedNow = placed;
        clearGroup(boxGroup);
        if (!truck) return;
        for (const p of placed) {
            const item = itemsById.get(p.id);
            const mesh = new THREE.Mesh(unitBox, new THREE.MeshStandardMaterial({
                color: colorForStop(p.stop),
                roughness: 0.45,
                metalness: 0.05,
            }));
            mesh.userData = { id: p.id, sharedGeometry: true, fragile: !!item?.fragile };
            mesh.scale.set(p.w, p.h, p.d);
            mesh.position.set(-truck.w / 2 + p.x + p.w / 2, p.y + p.h / 2, -truck.d / 2 + p.z + p.d / 2);

            const edge = new THREE.LineSegments(unitEdges, item?.fragile ? edgeMats.fragile : edgeMats.normal);
            edge.userData = { sharedGeometry: true, sharedMaterial: true };
            mesh.add(edge);
            boxGroup.add(mesh);
        }
        applyHighlights();
        requestRender();
    }

    function setCenterOfGravity(cog) {
        cogGroup.userData.hasCog = Boolean(cog && truck);
        if (!cog || !truck) {
            cogGroup.visible = false;
        } else {
            cogGroup.visible = !cogGroup.userData.hiddenInside;
            cogGroup.position.set(-truck.w / 2 + cog.x, cog.y, -truck.d / 2 + cog.z);
            cogStem.scale.y = cog.y;
            cogStem.computeLineDistances();
        }
        requestRender();
    }

    function applyHighlights() {
        for (const mesh of boxGroup.children) {
            const id = mesh.userData.id;
            const isSel = id === selectedId;
            const isHover = id === hoveredId;
            const invalid = drag?.moved && drag.id === id && !drag.pos.ok;
            mesh.material.emissive.setHex(invalid ? 0x991b1b : isSel ? 0x3a3a3a : isHover ? 0x222222 : 0x000000);
            const edge = mesh.children[0];
            edge.material = isSel ? edgeMats.selected : mesh.userData.fragile ? edgeMats.fragile : edgeMats.normal;
        }
        requestRender();
    }

    function setHovered(id) {
        if (hoveredId === id) return;
        hoveredId = id;
        applyHighlights();
    }

    function setSelected(id) {
        if (selectedId === id) return;
        selectedId = id;
        applyHighlights();
    }

    function fitCamera() {
        if (!truck) return;
        firstPerson?.exit(true);
        // Em telas estreitas (retrato) afasta a câmera para o baú caber na largura.
        const narrow = Math.max(1, 1.3 / camera.aspect);
        const length = truck.d + cabinSize.length;
        const height = Math.max(truck.h, cabinSize.height) + groundLift;
        const width = Math.max(truck.w, cabinSize.width);
        const size = Math.max(length + 1.5, width * 2, height * 2) * narrow;
        const centerZ = -cabinSize.length / 2; // baú + cabine
        controls.target.set(0, height / 2 - groundLift, centerZ);
        camera.position.set(size * 0.75, height - groundLift + size * 0.45, centerZ + size * 0.9);
        controls.update();
        requestRender();
    }

    function setActive(value) {
        active = value;
        if (active) { requestRender(); firstPerson?.resume(); }
    }

    /** Captura a imagem atual (usada no relatório de impressão). */
    function snapshot(width = 1400, height = 700) {
        firstPerson.exit(true);
        // Renderiza num tamanho fixo e paisagem, independente da tela atual.
        const prev = { aspect: camera.aspect, size: renderer.getSize(new THREE.Vector2()), pos: camera.position.clone(), target: controls.target.clone() };
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        fitCamera();
        renderer.render(scene, camera);
        const url = renderer.domElement.toDataURL('image/png');

        renderer.setSize(prev.size.x || 1, prev.size.y || 1, false);
        camera.aspect = prev.aspect;
        camera.updateProjectionMatrix();
        camera.position.copy(prev.pos);
        controls.target.copy(prev.target);
        controls.update();
        requestRender();
        return url;
    }

    // ---------- Interação ----------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = null;

    function pick(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(boxGroup.children, false)[0];
        return hit ? hit.object.userData.id : null;
    }

    // ---------- Arrastar caixas (cadeado aberto) ----------
    const canvas = renderer.domElement;
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();
    const meshOf = (id) => boxGroup.children.find(m => m.userData.id === id);

    function placeMesh(mesh, p) {
        mesh.scale.set(p.w, p.h, p.d);
        mesh.position.set(-truck.w / 2 + p.x + p.w / 2, p.y + p.h / 2, -truck.d / 2 + p.z + p.d / 2);
    }

    /** Ponto do piso (coordenadas do baú) sob o ponteiro, na altura do plano de arraste. */
    function floorPoint(e) {
        const rect = canvas.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return null;
        return { x: hitPoint.x + truck.w / 2, z: hitPoint.z + truck.d / 2 };
    }

    // Captura: roda antes da órbita da câmera e a impede de girar enquanto arrasta a caixa.
    canvas.addEventListener('pointerdown', (e) => {
        if (!editMode || !truck || firstPerson?.isActive() || e.button > 0) return;
        const id = pick(e);
        const box = id && placedNow.find(p => p.id === id);
        if (!box) return;
        e.stopImmediatePropagation();
        canvas.setPointerCapture(e.pointerId);
        dragPlane.constant = -box.y; // plano horizontal na base da caixa
        const start = floorPoint(e);
        if (!start) return;
        drag = { id, box, start: { x: e.clientX, y: e.clientY }, offset: { x: start.x - box.x, z: start.z - box.z }, moved: false, pos: { ...box, ok: true } };
        onSelect?.(id);
    }, { capture: true });

    canvas.addEventListener('pointermove', (e) => {
        if (!drag) return;
        e.stopImmediatePropagation();
        if (!drag.moved && Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) < 5) return;
        if (!drag.moved) {
            const top = boxOnTop(drag.box, placedNow);
            if (top) { onEditMessage?.('Tem outra caixa em cima desta. Mova a de cima primeiro.', 'warn'); drag = null; return; }
        }
        drag.moved = true;
        const p = floorPoint(e);
        if (!p) return;
        const others = placedNow.filter(o => o.id !== drag.id);
        const snapped = snapXZ(p.x - drag.offset.x, p.z - drag.offset.z, drag.box, others, truck);
        drag.pos = dropBox(drag.box, snapped.x, snapped.z, others, truck);
        const mesh = meshOf(drag.id);
        if (mesh) placeMesh(mesh, drag.pos);
        canvas.style.cursor = drag.pos.ok ? 'grabbing' : 'not-allowed';
        applyHighlights();
    }, { capture: true });

    function endDrag(e, cancelled = false) {
        if (!drag) return;
        e.stopImmediatePropagation();
        const d = drag;
        drag = null;
        canvas.style.cursor = 'move';
        if (!d.moved) { applyHighlights(); return; }
        if (!cancelled && d.pos.ok) {
            onMove?.(d.id, d.pos);
        } else {
            const mesh = meshOf(d.id);
            if (mesh) placeMesh(mesh, d.box); // volta para onde estava
            if (!cancelled) onEditMessage?.(d.pos.problem, 'warn');
        }
        applyHighlights();
    }
    canvas.addEventListener('pointerup', (e) => endDrag(e), { capture: true });
    canvas.addEventListener('pointercancel', (e) => endDrag(e, true), { capture: true });

    function setEditMode(on) {
        editMode = !!on;
        if (!editMode && drag) {
            const mesh = meshOf(drag.id);
            if (mesh) placeMesh(mesh, drag.box);
            drag = null;
        }
        canvas.style.cursor = editMode ? 'move' : 'grab';
        applyHighlights();
    }

    /** Gira a caixa 90° no lugar. Retorna a mensagem de erro ou null. */
    function rotateBox(id) {
        const box = placedNow.find(p => p.id === id);
        if (!box || !truck) return 'Selecione uma caixa.';
        if (boxOnTop(box, placedNow)) return 'Tem outra caixa em cima desta. Mova a de cima primeiro.';
        const t = turned(box);
        const others = placedNow.filter(o => o.id !== id);
        // Gira em torno do centro; se não couber, tenta encostar nas paredes.
        const cx = box.x + box.w / 2 - t.w / 2, cz = box.z + box.d / 2 - t.d / 2;
        for (const [x, z] of [[cx, cz], [box.x, box.z]]) {
            const pos = dropBox(t, x, z, others, truck);
            if (pos.ok) { onMove?.(id, pos); return null; }
        }
        return dropBox(t, cx, cz, others, truck).problem;
    }

    canvas.addEventListener('pointermove', (e) => {
        if (e.buttons || firstPerson?.isActive()) return; // arrastando a câmera / mira no centro em primeira pessoa
        const id = pick(e);
        renderer.domElement.style.cursor = id ? (editMode ? 'move' : 'pointer') : 'grab';
        setHovered(id);
        onHover?.(id, e.clientX, e.clientY);
    });
    renderer.domElement.addEventListener('pointerleave', () => {
        setHovered(null);
        onHover?.(null);
    });
    renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', (e) => {
        if (!downAt) return;
        const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
        downAt = null;
        if (moved < 5) onSelect?.(pick(e));
    });

    // ---------- Primeira pessoa (andar dentro do baú) ----------
    function applyInside(inside) {
        if (wallsMesh) wallsMesh.material.opacity = inside ? 0.6 : (wallsOpaqueNow ? 0.55 : 0.1);
        labelSprites.forEach(l => { l.visible = !inside; });
        cogGroup.userData.hiddenInside = inside;
        cogGroup.visible = !inside && cogGroup.userData.hasCog === true;
        camera.near = inside ? 0.03 : 0.1;
        camera.updateProjectionMatrix();
    }

    firstPerson = createFirstPerson({
        camera, controls, canvas: renderer.domElement,
        getTruck: () => truck,
        getBoxes: () => boxGroup.children,
        setTarget: (id) => setHovered(id),
        draw: () => { if (active) renderer.render(scene, camera); },
        isVisible: () => active,
        setInside: applyInside,
    });

    /** Troca as cores da cena para o tema 'dark' ou 'light'. */
    function setTheme(name) {
        COLORS = THEMES[name] ?? THEMES.dark;
        scene.background.setHex(COLORS.background);
        hemi.groundColor.setHex(COLORS.ground);
        makeGrid();
        edgeMats.normal.color.setHex(COLORS.edge);
        edgeMats.fragile.color.setHex(COLORS.edgeFragile);
        edgeMats.selected.color.setHex(COLORS.edgeSelected);
        cogMat.color.setHex(COLORS.cog);
        cogStem.material.color.setHex(COLORS.cog);
        if (truck) {
            const keep = camera.position.clone();
            const keepRot = camera.quaternion.clone();
            setTruck(truck, wallsOpaqueNow);
            camera.position.copy(keep);
            camera.quaternion.copy(keepRot);
        }
        requestRender();
    }

    return {
        setTruck, setBoxes, setCenterOfGravity, setHovered, setSelected, setEditMode, rotateBox,
        fitCamera, setActive, snapshot, requestRender, setTheme,
        enterFirstPerson: () => firstPerson.enter(),
        exitFirstPerson: () => firstPerson.exit(),
        setStick: (x, y) => firstPerson.setStick(x, y),
        firstPerson: {
            jump: () => firstPerson.jump(),
            pick: () => firstPerson.pick(),
            toggleCrouch: () => firstPerson.toggleCrouch(),
            isCrouching: () => firstPerson.isCrouching(),
            on: (type, fn) => firstPerson.on(type, fn),
        },
    };
}
