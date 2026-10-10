# Bateria 3D: estilo pelúcia

Um segundo visual pra bateria 3D (`docs/kit3d.md`): um **gato humanoide de pelúcia**
tocando uma **bateria de pelúcia**, com luz de estúdio suave. A referência é um
brinquedo de feltro fotografado em fundo creme: formas estufadas, tecido fosco com
brilho suave nas bordas, costuras visíveis, olhos de botão e sombra borrada no chão.

Só muda a aparência. Linha do tempo, quem toca o quê, curvas de golpe e IK
(`timeline.js`, `sticking.js`, `motion.js`, `ik.js`) continuam os mesmos, e o golpe
continua encostando na peça exatamente no `t` da nota.

## Contrato

O estilo atual passa a se chamar `manequim`. O novo é `pelucia` e vira o padrão.

```js
const view = mountKit3D(container, { song, getTime, style: "pelucia" }); // ou "manequim"
view.setStyle("pelucia" | "manequim");  // troca ao vivo, sem perder câmera nem tempo
view.style;                             // estilo atual
```

Exporte também `STYLE_NAMES` e `STYLE_LABELS` (`{ manequim: "Manequim", pelucia: "Pelúcia" }`).
O resto do contrato não muda.

## O gato

- **Corpo de gente, pele de gato.** As mesmas proporções e medidas do manequim
  (`layout.js`), então os braços alcançam as mesmas peças. Formas estufadas, sem quinas.
- **Cabeça:** orelhas triangulares com o lado de dentro rosa, focinho creme, nariz rosa,
  boca costurada, olhos de botão pretos com reflexo, bigodes de linha escura.
- **Patas no lugar das mãos:** luvas arredondadas com almofadinhas rosa ("feijõezinhos")
  visíveis, segurando as baquetas. Os pés também são patas.
- **Rabo** saindo por trás do banco, balançando de leve.
- **Pelagem:** gato laranja rajado, com peito, focinho e patas creme. As listras são uma
  textura gerada em canvas. Ofereça também `cinza` e `frajola` (preto e branco) como paletas,
  escolhidas por opção (`catColors`), só na página de desenvolvimento por enquanto.
- **Legenda dos membros** (MD/ME/PD/PE): pulseiras e tornozeleiras de feltro nas cores atuais.

## A bateria de pelúcia

- Cascos de feltro nas cores das peças (as mesmas da tab, um pouco mais pastel pra parecer
  tecido), peles creme, costura em volta do aro, estantes como cordas grossas de tecido.
- Pratos de feltro dourado com brilho suave, ainda com a cor da peça na borda ou no centro,
  pra continuar dando pra relacionar com a tab.
- **No golpe:** a pele afunda e o casco amassa um pouco (squash and stretch), e o prato
  balança molenga. Mantenha o flash de cor, mais suave.

## Movimento extra

Tudo como função pura do tempo, igual ao resto:

- o rabo balança no andamento (use `beats`);
- a cabeça acompanha o pulso de leve;
- as orelhas mexem num golpe de prato de ataque;
- o gato pisca de tempos em tempos (determinístico a partir de `t`, nada de `Math.random` por quadro).

## Material e luz

- `MeshPhysicalMaterial` com `sheen` (tecido/veludo), `roughness` perto de 1, e um mapa de
  fibras de feltro gerado em canvas (normal ou bump), que repete sem emenda. Sem arquivos de textura.
- Costuras: tubos finos escuros com pontinhos (instanced) nas emendas principais.
- Luz de estúdio: hemisférica + uma luz principal suave, e um ambiente
  (`RoomEnvironment` + PMREM) pro brilho do tecido.
- Sombra no chão: textura radial borrada embaixo do banco e do kit. É barata e é o que dá
  o ar de foto de produto.
- Fundo creme no tema claro (perto de `#ece8e1`), marrom bem escuro e quente no escuro
  (perto de `#1b1916`). Continua seguindo `prefers-color-scheme`.

## Desempenho

A máquina alvo é fraca (GeForce MX350 / GPU integrada).

- Até ~150 draw calls e ~80 mil triângulos no estilo pelúcia. Use instancing nas costuras.
- Se a média do quadro passar de 25 ms por 2 s, baixe o `devicePixelRatio` pra 1 sozinho.
- Ao trocar de estilo, libere geometrias, materiais e texturas do estilo anterior.

## Página de desenvolvimento

`kit3d-dev.html` ganha um seletor de estilo e outro de paleta do gato.

## Critérios de pronto

- Os mesmos de `docs/kit3d.md`, valendo para os dois estilos, incluindo a verificação
  numérica do golpe (ponta da baqueta encosta em `t`, erro menor que 1 quadro).
- `setStyle` ao vivo mantém câmera, tempo e peças silenciadas, e não vaza memória
  (`renderer.info.memory` volta ao mesmo valor depois de ir e voltar 5 vezes).
- O gato parece de pelúcia: em close na câmera `frente`, dá pra ver tecido, costuras,
  feijõezinhos e olhos de botão.
- Nenhum erro no console. A página não rola na horizontal com 390 px de largura.

## Notas da implementação

- `pelucia` é o estilo padrão no player e na página de desenvolvimento.
- A cabeça do gato é desenhada a 86% e 1,2 cm mais baixa que a do esqueleto, pra não
  esconder o surdo na câmera `baterista`. O esqueleto e os alcances não mudam.
- As listras usam um segundo conjunto de UV, então pontas dos membros e ombros ficam lisos.
- Ao medir vazamento com `renderer.info.memory`, o manequim mostra 1 textura depois da
  primeira troca: é a tabela DFG que o three.js cria uma vez pro material físico. Não cresce.


## Versão 2: corpo contínuo

Feito de cápsulas separadas, o gato parece desmontado: emenda no ombro, braço de
salsicha, juntas aparentes. Um bicho de pelúcia é **uma superfície só**, costurada e
estufada, que dobra nas juntas sem quebrar. É isso que deixa a referência fluida.

### Corpo

- **Uma malha contínua e fechada** pra cabeça, orelhas, tronco, braços, patas, pernas e rabo,
  desenhada como `SkinnedMesh`.
- **Modelagem:** cada parte do corpo é uma forma simples com distância assinada (SDF): cápsula,
  elipsoide ou cone arredondado. As formas se juntam com união suave (smooth-min, raio de alguns
  centímetros), o que dá aquele "estufado" nas emendas.
- **Malha:** a superfície é gerada uma vez, ao montar a cena, com surface nets ou marching cubes.
  As normais saem do gradiente da SDF, pra ficarem lisas sem facetas.
- **Pose de ligação:** a pose sentada tocando (braços dobrados pra frente, pernas dobradas), pra
  que a deformação nas juntas seja pequena durante a música.
- **Pesos de skinning:** saem da própria união suave. Cada forma pertence a um osso, e o peso de
  cada vértice vem da contribuição de cada forma (até 4 ossos), com falloff largo nas juntas pra
  não aparecer o efeito "embrulho de bala" no cotovelo e no pulso.
- **Ossos:** são movidos pelo rig que já existe (`rig.js`). O IK continua decidindo onde ficam
  ombro, cotovelo, pulso, quadril, joelho e tornozelo; os ossos só seguem essas posições.
  O rabo é uma corrente de ossos.
- **Pelagem sem textura e sem emenda:** cores por vértice calculadas na geração (listras de gato
  rajado a partir da posição na pose de ligação, regiões creme no peito, focinho e patas).
  A fibra de feltro é um ruído pequeno no shader, em coordenadas da pose de ligação (triplanar),
  então não aparece emenda de UV em lugar nenhum.
- **Detalhes separados, presos aos ossos e juntados em pouquíssimos draw calls:** olhos de
  botão, nariz, lado de dentro das orelhas, bigodes, feijõezinhos, pulseiras. A silhueta
  (cabeça, orelhas, corpo, membros, rabo) vem toda da malha contínua.

### Movimento fluido

- O golpe continua exato: a ponta da baqueta encosta na peça em `t`.
- Some ação secundária, como função pura do tempo: a cabeça e o tronco seguem o golpe com um
  pequeno atraso, o rabo ondula em corrente, as orelhas balançam e a barriga sacode de leve.
  Calcule como soma de respostas amortecidas aos golpes recentes, sem estado entre quadros.

### Bateria

Cascos com aro arredondado, juntados num só geometry por material. As estantes também viram
uma geometry só. Nada de peças soltas aparecendo emenda.

### Desempenho, medido na GPU real

- Meça com Chrome headless usando a GPU de verdade desta máquina (Intel Iris Xe):
  `--use-angle=gl --ignore-gpu-blocklist --enable-gpu --render-node-override=/dev/dri/renderD128`.
  Confira `WEBGL_debug_renderer_info`: tem que aparecer Iris Xe, não SwiftShader.
- **Orçamento:** até 2 ms por render (render + `gl.finish`) num canvas de 760×760 com
  `devicePixelRatio` 1, até 4 ms com 2. 60 fps constantes tocando, até 40 draw calls.
- **Geração da malha:** até 300 ms ao abrir. Se passar disso, gere num Web Worker.

### Critérios de pronto

- Em close nas câmeras `frente` e `lado`, nenhuma emenda entre partes do corpo, inclusive
  ombro, cotovelo, pulso, quadril, joelho e base do rabo, em várias poses de golpe.
- Os critérios de antes continuam valendo: tempo do golpe, seek, troca de estilo sem vazar
  memória, console limpo e 390 px.
