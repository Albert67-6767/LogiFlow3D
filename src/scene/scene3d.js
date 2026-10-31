import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { colorForStop } from '../config/constants.js';

/*
 * Cena 3D do baú. Recebe dados já calculados (posições do packer) e só desenha.
 * Renderiza sob demanda: nada é desenhado enquanto a câmera está parada
 * ou quando a aba 3D não está visível.
 *
 * Mundo: x centrado na largura, y = piso, z de -d/2 (cabine) a +d/2 (porta).
 */

const THEMES = {
    dark: {
        background: 0x020617, grid: [0x334155, 0x1e293b], ground: 0x1e293b,
        wall: 0x0284c7, wallEdge: 0x38bdf8, floor: 0x334155, cabin: 0x1e293b,
        door: 0x10b981, doorLabel: "#34d399", cabinLabel: "#94a3b8",
        edge: 0x020617, edgeFragile: 0xfbbf24, edgeSelected: 0xffffff, cog: 0xef4444,
    },
    light: {
        background: 0xf1f5f9, grid: [0xcbd5e1, 0xe2e8f0], ground: 0xcbd5e1,
        wall: 0x0284c7, wallEdge: 0x0369a1, floor: 0x94a3b8, cabin: 0x64748b,
        door: 0x059669, doorLabel: "#047857", cabinLabel: "#475569",
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
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(1.2, 0.3, 1);
    sprite.userData.sharedGeometry = true; // a geometria dos sprites é global no Three.js
    return sprite;
}

export function createScene(container, { onHover, onSelect } = {}) {
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
    function makeGrid() {
        if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
        grid = new THREE.GridHelper(30, 60, ...COLORS.grid);
        grid.position.y = -0.06;
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
    let wallsOpaqueNow = false;
    let hoveredId = null;
    let selectedId = null;
    let active = true;
    let pending = false;

    // ---------- Renderização sob demanda ----------
    function render() {
        pending = false;
        if (!active) return;
        controls.update(); // com damping, dispara 'change' enquanto houver inércia
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
        const changed = !truck || truck.w !== t.w || truck.h !== t.h || truck.d !== t.d;
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

        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shell), new THREE.LineBasicMaterial({ color: COLORS.wallEdge }));
        edges.position.y = t.h / 2;

        const floor = new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.05, t.d), new THREE.MeshStandardMaterial({ color: COLORS.floor, roughness: 0.9 }));
        floor.position.y = -0.025;

        // Cabine à frente (z negativo) para dar orientação.
        const cabinDepth = Math.min(1.4, t.d * 0.35);
        const cabin = new THREE.Mesh(
            new THREE.BoxGeometry(t.w * 0.95, t.h * 0.75, cabinDepth),
            new THREE.MeshStandardMaterial({ color: COLORS.cabin, roughness: 0.6 }),
        );
        cabin.position.set(0, (t.h * 0.75) / 2, -t.d / 2 - cabinDepth / 2 - 0.1);

        // Moldura da porta (traseira).
        const doorFrame = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.PlaneGeometry(t.w, t.h)),
            new THREE.LineBasicMaterial({ color: COLORS.door }),
        );
        doorFrame.position.set(0, t.h / 2, t.d / 2 + 0.005);

        const doorLabel = makeLabel('PORTA', COLORS.doorLabel);
        doorLabel.position.set(0, t.h + 0.25, t.d / 2);
        const cabinLabel = makeLabel('CABINE', COLORS.cabinLabel);
        cabinLabel.position.set(0, t.h * 0.75 + 0.25, -t.d / 2 - cabinDepth / 2);

        truckGroup.add(walls, edges, floor, cabin, doorFrame, doorLabel, cabinLabel);

        if (changed) fitCamera();
        requestRender();
    }

    function setBoxes(placed, itemsById) {
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
        if (!cog || !truck) {
            cogGroup.visible = false;
        } else {
            cogGroup.visible = true;
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
            mesh.material.emissive.setHex(isSel ? 0x3a3a3a : isHover ? 0x222222 : 0x000000);
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
        // Em telas estreitas (retrato) afasta a câmera para o baú caber na largura.
        const narrow = Math.max(1, 1.3 / camera.aspect);
        const size = Math.max(truck.d + 1.5, truck.w * 2, truck.h * 2) * narrow;
        controls.target.set(0, truck.h / 2, 0);
        camera.position.set(size * 0.75, truck.h + size * 0.45, size * 0.9);
        controls.update();
        requestRender();
    }

    function setActive(value) {
        active = value;
        if (active) requestRender();
    }

    /** Captura a imagem atual (usada no relatório de impressão). */
    function snapshot(width = 1400, height = 700) {
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

    renderer.domElement.addEventListener('pointermove', (e) => {
        if (e.buttons) return; // arrastando a câmera
        const id = pick(e);
        renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
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
            setTruck(truck, wallsOpaqueNow);
            camera.position.copy(keep);
        }
        requestRender();
    }

    return {
        setTruck, setBoxes, setCenterOfGravity, setHovered, setSelected,
        fitCamera, setActive, snapshot, requestRender, setTheme,
    };
}
