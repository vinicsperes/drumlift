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
(`drumlift/player/index.html`). Ele **não toca áudio** e **não é dono do relógio**:
o player chama o módulo e informa o tempo atual da música a cada quadro.

```
drumlift/player/
  index.html              player atual (a integração entra depois)
  kit3d/
    kit3d.js              ponto de entrada: export mountKit3D
    skeleton.js, rig.js   esqueleto humano e o baterista que decide a pose
    perform.js, moves.js  performance assada a partir da captura (Worker: performworker.js)
    moves/mmip.json       biblioteca de golpes e de corpo (gerada localmente, fora do git)
    ...                   outros módulos (kit, estilos, gato, ik, sticking, timeline)
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
crash) e `ride.json` (sintético, metade dos compassos conduzida no ride, com crash).
As notas do `ride.json` são o gabarito exato da música de teste
(`tests/make_test_song.py --ride`), na grade que o pipeline achou pra ela.

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

Três camadas, todas sem estado entre quadros (seek, loop e velocidade continuam
perfeitos):

- **Esqueleto** (`skeleton.js`): coluna em 3 partes, pescoço, cabeça, clavículas, braço,
  antebraço com torção, mão com 5 dedos e pernas com tornozelo e dedos. Recebe um
  comando por quadro (onde está cada baqueta, rotações da coluna e da cabeça, abertura
  dos cotovelos, pés nos pedais) e resolve o resto: a mão sai da baqueta por uma pegada
  fixa, então a ponta fica onde o comando mandou, qualquer que seja o braço.
- **Baterista** (`rig.js`): decide o comando no tempo `t`. As poses de golpe (fulcro,
  direção e giro da baqueta, cotovelo) encostam a ponta exatamente no ponto de contato
  de cada peça. Sem plano, um modelo procedural interpola entre elas (`motion.js`).
- **Performance assada** (`perform.js`, num Worker: `performworker.js`): quando a música
  abre, cada golpe de cada mão ganha o golpe real mais parecido da biblioteca
  (`moves.js`, `moves/mmip.json`, que cada um gera a partir da base MMIP: veja
  `moves/LEIA-ME.md`), testado no nosso kit (não pode atravessar peça nem
  mergulhar), e o corpo é assado a 30 Hz (giro do tronco que segue as mãos, trechos
  reais de groove no tempo da música, a cabeça olhando pro próximo alvo longe). O rig
  só lê o plano pelo tempo; nas pontas de cada golpe o resíduo é zero, então o contato
  continua exato. Sem a biblioteca, vale o modelo procedural.

Pés: bumbo de calcanhar levantado nas partes fortes (a perna cai no pedal) e de
calcanhar no pedal nas leves; o pé esquerdo segura o chimbal fechado quando a mão toca
nele e faz o "chick" no 2 e no 4 no ride. Mão parada respira; em pausa longa as
baquetas descansam nas coxas.

Desempenho: pose em ~0,5 ms por quadro e plano de uma música de 4 min em menos de 1 s
(no Worker). 60 fps numa Intel Iris Xe.

## Câmeras

`baterista` (por cima do ombro, o que mais ajuda quem está aprendendo), `frente`,
`lado` (mostra os pés) e `cima`. `OrbitControls` pra girar livremente.

## Página de desenvolvimento

`kit3d-dev.html` funciona sozinha, sem o player e sem áudio:

- carrega `?song=<url>` (padrão: `../../tests/fixtures/groove.json`);
- relógio de mentira com tocar/pausar, seek, velocidade (25%–100%) e loop de um compasso;
- botões de câmera e um seletor entre as duas fixtures.

Pra rodar, sirva a raiz do repositório (`python -m http.server` na raiz) e abra
`/drumlift/player/kit3d-dev.html`.

## Critérios de pronto

- Em `groove.json`: o chimbal em colcheia é tocado pela MD, a caixa nos tempos 2 e 4 pela ME,
  o bumbo pelo PD, e as viradas descem pelos tons alternando as mãos.
- Em `ride.json`: a MD vai pro ride nos trechos de condução.
- O golpe acontece no tempo certo: a baqueta encosta em `t` com erro menor que 1 quadro.
- Seek e loop não deixam a pose quebrada.
- Nenhum erro no console. A página não rola na horizontal com 390 px de largura.

## Decisões da implementação

Onde as regras acima não bastaram:

- Ride é sempre MD, mesmo com pouco tempo: a ME não alcança o ride.
- Prato da esquerda (chimbal/crash) + surdo: ME no prato e MD no surdo, sem cruzar os braços.
- 3+ notas de mão juntas: o melhor prato + o melhor tambor (não descarta a caixa por um segundo prato).
- Caixa sozinha logo depois de um par vai pra ME (toque duplo), a menos que a MD esteja
  livre há 180 ms; assim a MD fica no ride.
- Crash segue a mesma regra do chimbal: MD ocupada → ME.
- A câmera `baterista` fica por cima do ombro **esquerdo**: pelo direito a cabeça esconde a caixa.
- O tronco gira pra peças longe e o ombro avança até 7 cm pra alcançar.
- Peças silenciadas desbotam pra cor do fundo, não piscam e não mostram anel, mas o baterista continua tocando.

## Integração

O player tem o botão "Bateria 3D" (`B`), que abre um painel com `mountKit3D`, passando
`songTime` como relógio, as peças silenciadas e as notas editadas ainda não salvas.
O pipeline copia a pasta `player/` inteira pra saída (menos `kit3d-dev.html`).
