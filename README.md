# LogiFlow 3D

Simulador de carregamento de baú em 3D com regra LIFO (a 1ª parada fica junto à porta) e cálculo de rota, combustível, custo e CO₂.

## Como usar

```bash
npm install        # uma vez
npm run dev        # desenvolvimento, abre em http://localhost:5173
npm test           # testes do algoritmo e das métricas
npm run build      # gera dist/index.html (arquivo único, abre com duplo clique)
```

## Estrutura

```
index.html                 estrutura da página (layout)
src/
  main.js                  liga as telas e as ações de arquivo
  styles.css               Tailwind + componentes visuais (btn, card, chip...)
  config/constants.js      veículos, preços, limites, cores: ajuste aqui
  core/                    regras puras, sem tela (testadas)
    packer.js              encaixe 3D com LIFO, rotação, apoio e empilhamento
    metrics.js             ocupação, distribuição de peso, rota e custos
    validation.js          validação dos dados de um item
    fleet.js               frota: validar, adicionar, editar e remover veículos
    io.js                  importação/exportação JSON e CSV
  state/store.js           estado único + salvamento automático no navegador
  scene/scene3d.js         Three.js: desenha o que o packer calculou
  ui/
    dom.js, icons.js, format.js, toast.js   utilitários
    views/                 uma tela por arquivo (header, sidebar, 3D, rota, métricas, modal, impressão)
tests/                     testes Vitest
```

**Fluxo:** ação do usuário → `actions.*` (store) → estado novo → o store recalcula encaixe e métricas → cada tela, registrada com `watch()`, se atualiza sozinha.

## Frota de veículos

Pelo menu lateral (seção **Veículo**): `+` cadastra, o lápis edita e a lixeira remove (com "Desfazer"). A frota é salva no navegador e vai junto no arquivo de projeto (.json). Projetos antigos, sem frota, abrem com a frota padrão.

Para usar no código (`src/state/store.js`):

```js
const id = actions.addTruck({ name: 'Sprinter', w: 1.8, h: 1.9, d: 4.3, payload: 1600, kmPerLiter: 9.5, fuel: 'diesel' });
actions.updateTruck(id, { payload: 1700 });
const desfazer = actions.removeTruck(id); // Error se for o último veículo
```

Dados inválidos lançam `ValidationError` com `errors` por campo. Limites em `TRUCK_LIMITS` (`src/config/constants.js`). As regras estão em `src/core/fleet.js` como funções puras, então podem ser reaproveitadas num servidor (API REST) quando houver back-end.

### Cabine no 3D

Cada veículo tem um campo **Cabine**: Caminhão (toco/truck), Caminhão leve (VUC), Van (furgão), Picape, SUV, Sedan ou Hatch. Todos têm rodas (rodado duplo atrás nos caminhões) e altura do chão de acordo com o tipo (`RUNNING` em `cabin.js`). Em "Automático" o tipo sai da carga máxima (até 1.000 kg van, até 3.000 kg VUC, acima caminhão). São formas simples feitas no código (`src/scene/cabin.js`), sem arquivos 3D; para um novo tipo, acrescente um perfil lateral em `profile()` e o nome em `CABIN_TYPES`.

## Rota no mapa

Aba **Rota**: informe a base de saída e clique em **Calcular melhor rota**. Para cada trecho (base → #1 → #2 …) o sistema busca até 3 caminhos e escolhe o de menor "custo", somando:

- distância e tempo;
- piso (OpenStreetMap): asfalto bom, irregular (paralelepípedo/compactado) ou terra/cascalho;
- ruas estreitas/locais (pesam mais para caminhões);
- **áreas de atenção**: bairros ou trechos marcados pela equipe (níveis Atenção, Risco e Evitar). Não há base pública confiável de segurança por bairro, por isso elas são cadastradas no próprio sistema. Se um caminho cruza uma área, o sistema também procura um desvio.

A prioridade (Mais curta / Equilibrada / Mais segura) muda o peso de cada critério (`PRIORITIES` em `src/config/constants.js`). Dá para escolher outro caminho manualmente na lista ou tocando nele no mapa. **Sugerir ordem** reordena as paradas por proximidade e o baú é rearrumado (LIFO).

Serviços gratuitos, sem chave (`MAP_SERVICES`): Nominatim (endereços), Valhalla/FOSSGIS (caminhos e piso), OpenStreetMap (mapa base). Respeitam ~1 chamada/s, então 4 paradas levam cerca de 20 s. Para uso comercial em volume, troque por um serviço contratado em `src/services/mapApi.js` (único arquivo que acessa a rede).

Código: `core/geo.js` e `core/routing.js` (regras puras, testadas), `services/mapApi.js` e `services/planner.js` (rede), `ui/views/routeView.js` e `routeMap.js` (tela).

## Navegação (Iniciar rota)

Com a rota calculada, **Iniciar rota** abre a navegação em tela cheia: seta grande da próxima manobra, distância, instrução em português (falada em voz), horário de chegada na parada e no fim da rota. A tela fica acesa durante a viagem.

- **Horário de chegada:** soma o tempo de direção (com folga para vans/VUCs, `NAVIGATION` em `constants.js`) e o tempo de descarga por parada (aba Rota).
- **Ao chegar:** mostra o que descarregar (os volumes ficam junto à porta pela regra LIFO) e o botão "Entrega feita" segue para a próxima parada.
- **Fora da rota:** avisa e, após algumas leituras seguidas, recalcula a partir da posição atual.
- **Sem GPS:** "Avançar"/"Voltar" percorrem as instruções; "Simular" percorre a rota para treino/demonstração; "Waze" abre a parada atual no app.
- O GPS do navegador só funciona em `https` ou `localhost`. Para usar no celular na rua, publique o app num endereço https.

Código: `core/navigation.js` (regras puras, testadas) e `ui/views/navigationView.js` (tela).

## Tema e celular

O botão sol/lua no topo alterna claro/escuro (salvo no navegador; na primeira vez segue o sistema). O tema claro inverte a escala de cores em `src/styles.css`, então as telas não precisam de classes duplicadas. Em celular e tablet as abas ficam embaixo, o mapa aparece em cima da lista e os botões crescem em telas de toque.

## Regras do encaixe

- A última parada entra primeiro e fica junto à cabine; nada de parada posterior fica entre um item e a porta.
- Caixas podem girar no piso (a altura não muda).
- Só empilha com pelo menos 75% da base apoiada, sobre item não frágil e com peso igual ou menor que o de cada apoio.
- Item que não cabe (tamanho, peso total ou espaço) aparece em "Fora do baú" com o motivo, nunca sobreposto.
- O algoritmo testa várias estratégias e fica com a que carrega mais itens e equilibra melhor.

Parâmetros em `src/config/constants.js` (`PACKING`, `BALANCE`, `TRUCKS`).

## CSV

Separado por `;`, decimais com vírgula. Colunas: `descricao;endereco;largura_m;altura_m;profundidade_m;peso_kg;parada;fragil` (`endereco` e `fragil` são opcionais; `fragil` = sim/nao).
