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
