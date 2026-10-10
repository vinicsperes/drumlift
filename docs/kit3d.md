# Bateria 3D

Uma bateria em 3D com um baterista tocando a tab em sincronia com a música.
É pra quem aprende vendo: mostra **qual membro bate em quê, e quando**. Isso é
justamente o que a tab em texto não mostra.

## Objetivo

1. Ver o groove de verdade: mão direita no chimbal, esquerda na caixa, pé no bumbo.
2. Antecipar a próxima nota: dá pra ver a baqueta subindo antes do golpe.
3. Funcionar em câmera lenta: o relógio vem do player, então a velocidade de 50% vale aqui também.

Fora do escopo agora: personagem realista com rig, captura de movimento, assets baixados.

## Arquitetura

Módulo JavaScript sem etapa de build, no mesmo espírito do player atual
(`drumsomething/player/index.html`). Ele **não toca áudio** e **não é dono do relógio**:
o player chama o módulo e informa o tempo atual da música a cada quadro.

```
drumsomething/player/
  index.html              player atual (a integração entra depois)
  kit3d/
    kit3d.js              ponto de entrada: export mountKit3D
    ...                   outros módulos (cena, kit, avatar, ik, sticking, timeline)
  kit3d-dev.html          página de desenvolvimento isolada
  vendor/
    three.module.min.js   Three.js com versão exata fixada
    OrbitControls.js      (e o que mais for preciso dos addons)
```

Three.js fica **na pasta vendor**, não vem de CDN: o player funciona offline e tem que
continuar assim. Fixe uma versão exata e estável, e importe pelos caminhos relativos.

### Contrato

```js
import { mountKit3D } from "./kit3d/kit3d.js";

const view = mountKit3D(container, {
  song,                  // o objeto inteiro do song.json
  getTime: () => seconds, // posição atual na linha do tempo da música
});

view.setSong(song);       // depois que o usuário edita e salva a tab
view.setCamera(name);     // "baterista" | "frente" | "lado" | "cima"
view.setMuted(pieces);    // Set de peças silenciadas no player (escurecer essas peças)
view.dispose();           // para o loop, libera WebGL e remove os listeners
```

- O módulo tem o próprio `requestAnimationFrame` e chama `getTime()` a cada quadro.
- O tempo pode voltar (loop, seek): a animação não pode depender do quadro anterior.
  Calcule a pose como uma **função pura do tempo**.
- Use `ResizeObserver` no `container` pra acompanhar o tamanho.

## Dados (`song.json`)

Tem dois exemplos em `tests/fixtures/`: `groove.json` (sintético, com viradas nos tons e
crash) e `surf.json` (transcrito de uma música real, com ride e crash).

```js
{
  "title": "…", "duration": 122.9, "tempo": 169.0,
  "beats_per_bar": 4, "subdiv": 4,
  "beats": [-0.35, 0.0, 0.36, …],   // segundos de cada batida
  "notes": [
    { "piece": "snare", "step": 52, "t": 1.762, "vel": 0.83, "conf": 0.71, "ghost": false },
    …
  ]
}
```

- `piece` ∈ `kick`, `snare`, `hihat`, `tom`, `crash`, `ride`.
- `t` é o momento do golpe em segundos. Use esse campo; não recalcule a partir de `step`.
- `vel` vai de 0 a 1 e define a altura da baqueta. `ghost` = nota fantasma, golpe bem baixo.
- Só existe **uma** classe de tom. Distribua os tons na hora de desenhar (veja abaixo).
- Chimbal aberto e fechado não são diferenciados.

## Cena

- **Kit procedural** feito de primitivas (cilindros, discos, estantes), nada baixado.
  Montagem pra destro: bumbo, caixa, chimbal à esquerda, tons 1 e 2 em cima do bumbo,
  surdo à direita, crash à esquerda no alto, ride à direita.
- **Baterista estilizado**, um manequim de cápsulas e esferas, sentado no banco.
  Braços e pernas com **IK de dois ossos** (ombro-cotovelo-pulso, quadril-joelho-tornozelo).
  Baqueta presa em cada mão.
- **Reação no golpe**: a pele pisca na cor da peça, os pratos balançam e o pedal do bumbo afunda.
- **Antecipação** (opcional, pode ligar e desligar): um anel encolhendo em cima da peça,
  chegando nela no instante do golpe, com 1 tempo de antecedência.
- Cores das peças iguais às da tab (escuro / claro):
  crash `#ff8a65`/`#d9541e`, ride `#ffd166`/`#a77b00`, hihat `#4fc3f7`/`#0b84c6`,
  snare `#f06292`/`#c2185b`, tom `#b388ff`/`#6a3fd1`, kick `#7bd88f`/`#2e8b45`.
  Fundo segue `prefers-color-scheme` (escuro `#0e1015`, claro `#f6f7f9`).
- **Cores por membro**, discretas (ex.: uma luva ou um anel no pulso), pra legenda
  "MD / ME / PD / PE".

## Quem toca o quê (sticking)

Pré-calcule uma vez, ao receber a música, uma linha do tempo de golpes por membro.
Comece simples e acerte os grooves comuns primeiro.

- **Pé direito**: bumbo.
- **Pé esquerdo**: fica apoiado no pedal do chimbal (chimbal fechado). Não invente notas.
- **Notas no mesmo passo** (mesmo `step`):
  - chimbal/ride + caixa → MD no prato, ME na caixa (mão cruzada, o padrão de destro);
  - prato + tom → MD no prato, ME no tom;
  - caixa + tom → ME na caixa, MD no tom;
  - 3 ou mais notas de mão juntas → toque as 2 mais importantes (prato > caixa > tom).
- **Notas sozinhas**:
  - chimbal/ride → MD; se a MD não tiver tempo (intervalo < ~90 ms), vai pra ME;
  - caixa → ME; em sequências rápidas (intervalo < ~180 ms) alterna D-E-D-E;
  - tons → alternam dentro da virada, começando pela mão livre.
- **Distribuição dos tons**: numa sequência de tons (até 1 tempo entre notas), vá do mais
  agudo pro mais grave (tom 1 → tom 2 → surdo), que é a virada mais comum. Tom isolado vai pro tom 2.

## Animação

- A pose de cada membro é uma função de `t`: ache o golpe anterior e o próximo daquele
  membro (busca binária na linha do tempo dele) e interpole.
  - Golpe: a ponta da baqueta encosta na peça exatamente em `t`.
  - Preparação: a baqueta sobe antes do golpe. A altura depende de `vel`
    (`ghost` = quase encostada) e de quanto tempo sobra até o próximo golpe.
  - Rebote rápido depois do golpe. Sem golpe por perto, volta pra posição de descanso.
- Pé: calcanhar parado, ponta desce no golpe, pedal acompanha.
- Leve balanço do tronco no tempo (opcional, sutil).
- Desempenho: ~3000 notas no máximo. 60 fps numa GPU integrada fraca. Poucos polígonos,
  1 luz direcional + 1 ambiente, sombra simples ou nenhuma, `devicePixelRatio` limitado a 2.

## Câmeras

`baterista` (por cima do ombro, o que mais ajuda quem está aprendendo), `frente`,
`lado` (mostra os pés) e `cima`. `OrbitControls` pra girar livremente.

## Página de desenvolvimento

`kit3d-dev.html` funciona sozinha, sem o player e sem áudio:

- carrega `?song=<url>` (padrão: `../../tests/fixtures/groove.json`);
- relógio de mentira com tocar/pausar, seek, velocidade (25%–100%) e loop de um compasso;
- botões de câmera e um seletor entre as duas fixtures.

Pra rodar, sirva a raiz do repositório (`python -m http.server` na raiz) e abra
`/drumsomething/player/kit3d-dev.html`.

## Critérios de pronto

- Em `groove.json`: o chimbal em colcheia é tocado pela MD, a caixa nos tempos 2 e 4 pela ME,
  o bumbo pelo PD, e as viradas descem pelos tons alternando as mãos.
- Em `surf.json`: a MD vai pro ride nos trechos de condução.
- O golpe acontece no tempo certo: a baqueta encosta em `t` com erro menor que 1 quadro.
- Seek e loop não deixam a pose quebrada.
- Nenhum erro no console. A página não rola na horizontal com 390 px de largura.

## Integração (depois)

O player ganha um botão "Bateria 3D" que abre um painel com `mountKit3D`, passando
`songTime` como relógio e o conjunto de peças silenciadas. O pipeline passa a copiar
a pasta inteira `player/` pra saída, em vez de copiar só o `index.html`.
