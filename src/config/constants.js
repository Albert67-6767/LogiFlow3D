// Parâmetros de negócio centralizados. Ajuste aqui, não espalhe números pelo código.

/**
 * Frota inicial (o usuário pode adicionar, editar e remover veículos).
 * Medidas internas do baú em metros.
 */
export const DEFAULT_TRUCKS = {
    fiorino: { name: 'Fiorino / Van', w: 1.8, h: 1.3, d: 2.4, payload: 650, kmPerLiter: 11, fuel: 'gasolina', cabin: 'van' },
    hr: { name: 'Caminhão HR (VUC)', w: 1.8, h: 1.9, d: 3.1, payload: 1800, kmPerLiter: 8, fuel: 'diesel', cabin: 'vuc' },
    toco: { name: 'Baú Toco', w: 2.4, h: 2.5, d: 6.5, payload: 5000, kmPerLiter: 5, fuel: 'diesel', cabin: 'caminhao' },
};

/** kg de CO2 emitidos por litro queimado. As chaves são os combustíveis aceitos. */
export const CO2_PER_LITER = { diesel: 2.68, gasolina: 2.31 };

export const FUEL_LABELS = { diesel: 'Diesel', gasolina: 'Gasolina / Flex' };

/** Tipos de cabine desenhados no 3D (scene/cabin.js). "auto" escolhe pela carga máxima. */
export const CABIN_TYPES = {
    auto: 'Automático (pela carga)',
    caminhao: 'Caminhão (toco/truck)',
    vuc: 'Caminhão leve (VUC)',
    van: 'Van / furgão',
    picape: 'Picape',
    suv: 'SUV / utilitário',
    sedan: 'Carro sedan',
    hatch: 'Carro hatch',
};

/** Limites aceitos no cadastro de veículos: [mínimo, máximo]. */
export const TRUCK_LIMITS = {
    w: [0.5, 3],          // largura interna (m)
    h: [0.5, 4.5],        // altura interna (m)
    d: [0.5, 16],         // comprimento interno (m)
    payload: [50, 60000], // carga máxima (kg)
    kmPerLiter: [0.5, 40],
};

export const PACKING = {
    /** Folga entre caixas vizinhas (m). */
    gap: 0.02,
    /** Fração mínima da base que precisa estar apoiada para empilhar. */
    minSupport: 0.75,
    /** Uma caixa só pode ficar sobre outras se pesar no máximo isto × o peso de cada apoio. */
    maxStackRatio: 1.0,
};

/**
 * Limites do alerta de distribuição de peso.
 * Frente/traseira (% do peso na traseira): o certo é ter mais peso junto à cabine;
 * peso na traseira deixa a direção leve e sobrecarrega o eixo traseiro.
 * Só quase tudo colado na cabine (frontWarn % na frente) pede para conferir o eixo dianteiro.
 * Lateral: pontos de diferença entre os lados (ex.: 65/35 = 30), mais rígido por causa do tombamento.
 */
export const BALANCE = {
    longitudinal: { rearWarn: 55, rearDanger: 65, frontWarn: 85 },
    lateral: { warn: 15, danger: 30 },
};

export const DEFAULT_SETTINGS = {
    fuelPrice: 6.2, // R$/litro
    baselineKm: null, // km da rota sem otimização, para calcular economia
    routePriority: 'equilibrada',
    unloadMin: 15, // minutos parado em cada entrega (entra no horário de chegada)
};

/** Motivos para marcar uma entrega como pendente (botões grandes na navegação). */
export const PENDING_REASONS = [
    'Cliente ausente',
    'Local fechado',
    'Endereço não encontrado',
    'Recusou a mercadoria',
    'Sem acesso para o veículo',
    'Mercadoria avariada',
    'Outro motivo',
];

/** Navegação curva a curva. */
export const NAVIGATION = {
    /** Folga de tempo para vans/VUCs (o serviço calcula como carro). */
    vanTimeFactor: 1.05,
    vucTimeFactor: 1.15,
    vucPayload: 1000, // kg: a partir daqui considera VUC
    arriveM: 40,      // "chegou" a menos de 40 m da parada
    offRouteM: 60,    // fora da rota a mais de 60 m da linha
    rerouteAfter: 3,  // leituras seguidas fora da rota antes de recalcular
    rerouteCooldownS: 30,
    voiceFarM: 400,   // aviso antecipado ("Em 400 m, vire…")
    voiceNearM: 70,   // aviso na hora ("Vire à direita…")
};

// ---------- Rotas ----------

/**
 * Peso de cada critério na escolha do caminho (ver core/routing.js → scoreAlternative).
 * quality: km sem asfalto/irregulares · local: km em ruas estreitas · risk: km em áreas de atenção.
 */
export const PRIORITIES = {
    curta: { label: 'Mais curta', hint: 'Prioriza distância e tempo.', quality: 0.3, local: 0.05, risk: 0.5 },
    equilibrada: { label: 'Equilibrada', hint: 'Equilibra distância, piso e áreas de atenção.', quality: 1, local: 0.15, risk: 2 },
    segura: { label: 'Mais segura', hint: 'Aceita rodar mais para evitar áreas de atenção e piso ruim.', quality: 1.5, local: 0.3, risk: 6 },
};

/** Níveis das áreas de atenção marcadas pelo usuário. `weight` multiplica os km dentro da área. */
export const RISK_LEVELS = {
    1: { label: 'Atenção', weight: 1, color: '#f59e0b' },
    2: { label: 'Risco', weight: 2.5, color: '#f97316' },
    3: { label: 'Evitar', weight: 5, color: '#ef4444' },
};

/**
 * Observações dos motoristas: pontos onde o veículo não passou.
 * A rota desvia de um círculo de `radius` metros em volta do ponto.
 */
export const ROAD_BLOCK = {
    radius: 25,
    aheadM: 35, // "na próxima rua": ponto marcado este tanto depois da próxima curva
    reasons: [
        'Rua estreita demais',
        'Altura baixa (viaduto, fiação, galhos)',
        'Proibido para caminhão',
        'Rua fechada / em obras',
        'Sem espaço para manobrar',
        'Ladeira ou piso ruim',
        'Outro motivo',
    ],
    scopes: { truck: 'Só caminhão', all: 'Todos os veículos' },
};

/** A partir desta carga máxima (kg) a rota usa o perfil de caminhão (evita vias restritas). */
export const HEAVY_PAYLOAD = 3000;

/** Serviços gratuitos baseados no OpenStreetMap (sem chave). */
export const MAP_SERVICES = {
    routing: 'https://valhalla1.openstreetmap.de',
    geocoding: 'https://nominatim.openstreetmap.org',
    /** Mapa base oficial do OpenStreetMap (no tema escuro recebe um filtro de cor via CSS). */
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    /** Vista de satélite (Esri, sem chave) + camadas com nomes de ruas e lugares por cima. */
    satellite: {
        imagery: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        labels: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        ],
        attribution: 'Imagens &copy; Esri, Maxar, Earthstar Geographics',
    },
    /** Intervalo mínimo entre chamadas ao mesmo serviço (política de uso justo). */
    minIntervalMs: 1100,
};

/** Uma cor por parada (repete após 10). */
export const STOP_COLORS = [
    '#10b981', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
    '#f59e0b', '#06b6d4', '#84cc16', '#f97316', '#f43f5e',
];

export const colorForStop = (stop) => STOP_COLORS[(Math.max(1, stop) - 1) % STOP_COLORS.length];

export const SAMPLE_ITEMS = [
    { id: 's1', label: 'Pacotes Eletrônicos', address: 'Av. Paulista, 1000 - São Paulo, SP', w: 0.8, h: 0.6, d: 0.8, weight: 400, stop: 1, fragile: false },
    { id: 's2', label: 'Caixa Eletrodomésticos', address: 'Rua Augusta, 500 - São Paulo, SP', w: 0.9, h: 0.9, d: 0.9, weight: 250, stop: 2, fragile: false },
    { id: 's3', label: 'Kits Vestuário', address: 'Av. Brig. Faria Lima, 2000 - São Paulo, SP', w: 0.7, h: 0.5, d: 1.0, weight: 150, stop: 3, fragile: false },
    { id: 's4', label: 'Alimentos Perecíveis', address: 'Rua da Consolação, 1200 - São Paulo, SP', w: 0.6, h: 0.6, d: 0.6, weight: 180, stop: 4, fragile: true },
];

export const SAMPLE_STOP_KM = { 1: 8.5, 2: 3.2, 3: 4.1, 4: 2.7 };

export const SAMPLE_DEPOT = { address: 'Rua Vergueiro, 3000 - Vila Mariana, São Paulo - SP', lat: null, lon: null };
