import {
    createElement, Box, Package, Route, ChartColumn, Weight, Fuel, Plus, RotateCcw, MapPin, X, Trash2,
    Pencil, OctagonAlert, TriangleAlert, CircleCheck, Boxes, Menu, Download, Upload, Printer,
    FileSpreadsheet, Eye, EyeOff, List, Copy, Truck, Leaf, DollarSign, Info, RefreshCw, Eraser,
    ChevronDown, PackageX, Navigation, Layers, ArrowRight,
    Sun, Moon, Crosshair, ShieldAlert, Clock, Search, ArrowDownUp, LoaderCircle, Maximize, House, Map as MapIcon, Satellite,
    ArrowUp, ArrowUpRight, ArrowUpLeft, CornerUpRight, CornerUpLeft, Undo2, Redo2, Flag, Merge, Ship, Volume2, VolumeX,
    Play, Pause, ChevronLeft, ChevronRight, LocateFixed, PackageCheck, ExternalLink, Navigation2,
    ScanBarcode, QrCode, Tag, Camera, CameraOff, Keyboard,
} from 'lucide';

// Só os ícones usados entram no pacote final.
const ICONS = {
    box: Box, package: Package, route: Route, chart: ChartColumn, weight: Weight, fuel: Fuel,
    plus: Plus, 'rotate-ccw': RotateCcw, 'map-pin': MapPin, x: X, trash: Trash2, pencil: Pencil,
    danger: OctagonAlert, warn: TriangleAlert, ok: CircleCheck, boxes: Boxes, menu: Menu,
    download: Download, upload: Upload, printer: Printer, csv: FileSpreadsheet, eye: Eye,
    'eye-off': EyeOff, list: List, copy: Copy, truck: Truck, leaf: Leaf, money: DollarSign,
    info: Info, refresh: RefreshCw, eraser: Eraser, 'chevron-down': ChevronDown,
    'package-x': PackageX, navigation: Navigation, layers: Layers, 'arrow-right': ArrowRight,
    sun: Sun, moon: Moon, crosshair: Crosshair, shield: ShieldAlert, clock: Clock, search: Search,
    reorder: ArrowDownUp, loader: LoaderCircle, maximize: Maximize, home: House, map: MapIcon, satellite: Satellite,
    'arrow-up': ArrowUp, 'arrow-up-right': ArrowUpRight, 'arrow-up-left': ArrowUpLeft, 'turn-right': CornerUpRight,
    'turn-left': CornerUpLeft, 'uturn-left': Undo2, 'uturn-right': Redo2, flag: Flag, merge: Merge, ship: Ship,
    volume: Volume2, 'volume-off': VolumeX, play: Play, pause: Pause, 'chevron-left': ChevronLeft,
    'chevron-right': ChevronRight, locate: LocateFixed, 'package-check': PackageCheck, external: ExternalLink, arrow: Navigation2,
    scan: ScanBarcode, qr: QrCode, tag: Tag, camera: Camera, 'camera-off': CameraOff, keyboard: Keyboard,
};

export function icon(name, className = 'size-4') {
    const node = ICONS[name];
    if (!node) throw new Error(`Ícone desconhecido: ${name}`);
    return createElement(node, { class: `shrink-0 ${className}`, 'aria-hidden': 'true' });
}

/** Troca <i data-icon="nome" class="..."> do HTML estático pelo SVG correspondente. */
export function hydrateIcons(root = document) {
    root.querySelectorAll('i[data-icon]').forEach(el => {
        el.replaceWith(icon(el.dataset.icon, el.getAttribute('class') || 'size-4'));
    });
}
