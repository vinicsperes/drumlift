# Baterista humano: plano

O baterista 3D é a parte principal do sistema, e hoje ele toca travado: cada
membro vai e volta de cada peça como um braço de robô. Este plano troca as
regras soltas por movimento de bateristas de verdade, sem perder o que já
funciona: o golpe acerta a nota com erro zero, e seek, loop e velocidade
continuam perfeitos.

## Por que parece travado

1. **O golpe sai sempre do mesmo jeito.** O pulso sobe e a baqueta gira juntos,
   na mesma proporção, em qualquer peça e andamento. Gente não toca assim. Na
   captura de um baterista real (abaixo), a mão quase não se mexe no ride
   (1,2 cm); o movimento é do pulso e dos dedos. Na caixa do contratempo, a mão
   sobe ~10 cm e puxa a baqueta.
2. **O esqueleto é pobre.** O tronco é um bloco só, sem coluna nem clavícula,
   o antebraço não gira e não há dedos. O ombro fica parado e o braço parece
   pendurado num cabide.
3. **O corpo não reage.** O tronco não sente o tranco dos golpes, a cabeça não
   olha pro próximo alvo e a mão que não está tocando fica congelada.
4. **As pernas são mínimas.** O bumbo só gira o pé no calcanhar. Não há
   calcanhar levantado (heel-up), que é como se toca rock.
5. **Não há planejamento.** Cada quadro é calculado com regras locais, sem olhar
   pra frente: o baterista não se prepara pra virada, nem pro acento, nem
   escolhe o caminho entre as peças.

## O que a pesquisa diz

- **Biomecânica do golpe (Sofia Dahl, KTH).** Antes de um acento a baqueta sobe
  ~10 cm a mais. Na subida a mão vai na frente e a baqueta vem atrás. A descida
  é uma chicotada do pulso. O acento faz um "laço" maior que a nota normal.
- **Especialistas usam o rebote** e contraem menos os músculos opostos do pulso.
  Por isso o golpe deles é econômico (Beveridge et al., 2020).
- **Movimento humano de alcance minimiza o "jerk"** (a variação da aceleração),
  com perfil de velocidade em sino (Flash e Hogan, 1985). Serve pra troca de peça.
- **Estado da arte em animação de bateria:**
  - *Generalized Audio-Driven Synthesis of Precise Drummer Motion* (Disney
    Research, melhor artigo do SCA 2026). É um modelo de difusão treinado com
    3,5 h de captura óptica. O corpo fica natural, mas a baqueta erra o alvo em
    ~1,9 cm. Ele precisa de áudio só da bateria e de um kit fixo.
  - *DRUMS* (MIG 2025, os mesmos autores do MMIP). Vai do MIDI pro corpo inteiro:
    uma rede pras mãos, busca de trechos reais pro tronco e pro rosto, e pedais
    procedurais.
  - Conclusão: o nosso trunfo é o contato exato. O que falta é o corpo humano.
- **Dados reais: base MMIP** (Universidade de Chipre / CYENS, CC BY-NC-SA 4.0).
  - Conteúdo: 44 min de bateria, 14 músicas de rock alternativo e punk, de 75 a
    133 BPM, tocadas por um baterista.
  - Captura: roupa Rokoko com luvas (os dedos são capturados), mais MIDI, áudio
    e 5 vídeos por música.
  - **Testado aqui:**
    - o FBX abre no Three.js (61 ossos, 60 quadros por segundo);
    - o MIDI está sincronizado com o movimento: a mão esquerda chega no ponto
      mais baixo +20 ms depois da caixa, depois de cair 10 cm;
    - o baterista pisa o pedal do chimbal 312 vezes numa música de 3 min: o pé
      esquerdo marca o tempo o tempo todo.

## A ideia central

**Tocar como gente = movimento real + as garantias que já temos.** São três camadas:

1. **Captura real** (MMIP): uma biblioteca de golpes e de movimento de corpo de
   um baterista de verdade, já sincronizada com o MIDI. É o "rastreamento"
   pronto, sem ruído de vídeo.
2. **Gerador da performance**: pra cada nota da nossa tab, busca os golpes reais
   mais parecidos (peça, força, intervalo antes e depois, troca de peça) e
   costura um no outro (*motion matching*, a técnica dos jogos). O tronco, os
   ombros e a cabeça vêm de trechos reais com o mesmo andamento e densidade.
3. **Correção de contato**: um IK suave puxa a ponta da baqueta exatamente pro
   ponto da nossa peça, só perto do golpe. O movimento real vira exato sem perder
   a naturalidade.

Tudo isso é **assado** (*baked*) num Web Worker quando a música abre: o gerador
calcula a música inteira uma vez, e o player só lê a animação pronta pelo tempo.
Assim seek, loop e velocidade continuam perfeitos, e dá pra usar cálculo pesado
(busca, otimização, suavização) sem custo por quadro.

## Fases

### 1. Laboratório "real × nosso"

Antes de mexer no baterista, um jeito de medir.

- **Página de comparação:** toca uma performance MMIP (FBX) ao lado do nosso
  baterista tocando o mesmo MIDI (convertido pro song.json), sincronizados e com
  a mesma câmera.
- **Métricas automáticas**, comparadas com o real:
  - altura da preparação × força da nota;
  - quanto mexem mão e pulso, por peça e andamento;
  - perfil de velocidade (*jerk*) nas trocas de peça;
  - balanço do tronco e aceno da cabeça (energia e fase em relação à batida);
  - quanto a mão parada se mexe.
- **Entrega:** os números de quão longe estamos do humano, e o vídeo lado a lado.

### 2. Esqueleto humano completo

- **Ossos:** coluna em 3 partes, clavículas, pescoço e cabeça, antebraço que
  gira, pulso com 2 eixos, mão com dedos segurando a baqueta (fulcro entre
  polegar e indicador) e pernas com tornozelo e dedos.
- **Compatível com a captura**, pra transferir o movimento direto.
- **Limites de junta:** cotovelo não dobra pra trás, pulso não dá a volta.
- **Os dois estilos no esqueleto novo:**
  - o gato de pelúcia ganha o esqueleto novo; como o corpo dele é gerado, basta
    recalcular os pesos;
  - o manequim vira um boneco articulado de madeira (de desenho), que mostra as
    juntas e é ótimo pra aprender.

### 3. Biblioteca de golpes

- **Conversão:** baixar as 14 performances (~280 MB, ficam fora do repositório;
  um script baixa) e converter o FBX em trilhas por osso (Three.js no navegador
  headless, já testado).
- **Kit e baquetas:** achar a posição dos pads do kit deles (o ponto mais baixo
  da mão em cada nota, agrupado por peça) e inferir a baqueta pela pegada da mão
  e pela direção do pad.
- **Recortes de golpe:** cada golpe por membro, de −400 a +300 ms em volta da
  nota, descrito em relação ao alvo (assim serve pro nosso kit). Atributos:
  peça, força, intervalos, troca de peça e tipo de golpe do método Moeller
  (cheio, descendente, batida, ascendente).
- **Recortes de corpo:** tronco, ombros e cabeça por compasso, com andamento,
  densidade e peças.
- **Saída:** um arquivo compacto derivado, com crédito e a mesma licença
  (CC BY-NC-SA), que entra no repositório.

### 4. Gerador da performance (o coração)

Um Worker que assa a música inteira a 60 Hz.

1. **Plano olhando pra frente:**
   - tipo de golpe pela força desta nota e da próxima;
   - altura pela curva medida nos dados;
   - revisão de quem toca o quê;
   - caminho entre peças por cima dos aros, sem cruzar a outra baqueta;
   - pra onde a cabeça olha.
2. **Mãos:** golpes reais buscados na biblioteca e esticados no tempo, pra o
   impacto cair exatamente na nota. A transição entre golpes usa inercialização
   e o IK de contato garante a ponta exata.
3. **Corpo:** tronco, ombros e cabeça de trechos reais parecidos, mais a reação
   aos golpes (mola amortecida). A cabeça olha pro próximo alvo ~200 ms antes.
4. **Pernas:**
   - bumbo com calcanhar levantado no rock e calcanhar baixo nas partes leves;
   - pé esquerdo marcando o tempo no pedal do chimbal, como na captura.
5. **Pausas:**
   - a mão parada respira e flutua a poucos centímetros da peça;
   - em pausa longa, as baquetas descansam no colo;
   - contagem com as baquetas antes de entrar.
6. **Suavização final** no espaço das juntas, preservando os contatos.

**Sem os dados:** o mesmo gerador com um modelo paramétrico ajustado às
estatísticas da captura. O modelo cobre a curva de altura, o atraso da baqueta
em relação à mão, quanto pulso, antebraço e ombro contribuem conforme o tamanho
do golpe, e trocas de peça com mínimo jerk.

### 5. Física e acabamento

- Pratos e peles reagindo (já feito).
- Rebote da baqueta com uma leve flexão.
- Batedor rebatendo na pele do bumbo.
- Rabo, orelhas e barriga do gato em molas, assados junto.

### 6. Validação

- **Metas:**
  - dentro de ±20% do real em altura × força, contribuição das juntas e energia
    do tronco e da cabeça;
  - jerk nas trocas de peça igual ou menor que o real;
  - contato continua em 0 mm;
  - 60 quadros por segundo na Iris Xe;
  - assar uma música de 4 min em menos de 3 s.
- **Teste cego:** 10 trechos, real × nosso.

### Depois: estilo a partir de qualquer vídeo

- **Estilo de um vídeo:** rastrear um vídeo de bateria (MediaPipe Pose e Hands
  rodam no navegador; GVHMR dá o 3D no mundo) e extrair o estilo: amplitude dos
  braços, balanço e cabeça. Vira preset ("jazz econômico", "rock pesado") ou o
  jeito de um baterista específico.
- **"Você × gato":** filmar você tocando pela webcam e comparar com o gato.

## Riscos

- **Licença MMIP CC BY-NC-SA:** uso não comercial, a mesma situação do ADTOF que
  o projeto já usa. Por isso a biblioteca derivada não vai no repositório: cada um
  gera a sua (veja `kit3d/moves/LEIA-ME.md`), e sem ela vale o modelo procedural.
- **Um baterista só:** o estilo dele vira o nosso. A roupa de sensores
  inerciais tem ruído (os pés escorregam), então os pés ficam procedurais.
- **As baquetas não foram capturadas:** são inferidas pela mão e pelo MIDI.
- **O kit deles é diferente:** por isso tudo é descrito em relação ao alvo, com
  o IK no fim.

## Resultados

### Fase 1: laboratório (feito)

`uv run python tools/mmip.py fetch 1` baixa a primeira performance (rock
alternativo, 75 BPM, 1245 notas). Pra abrir o laboratório, sirva a raiz do
repositório e abra `/drumsomething/player/lab.html?take=/songs/mmip/01/`.

As baquetas inferidas caem num raio de 5 a 7 cm em volta do ride, do chimbal e
da caixa. Nos tons o raio é maior (17 a 21 cm), porque há menos golpes e o
mapeamento dos tons do kit eletrônico é incerto.

Primeira calibração (nosso ÷ real, na performance 01):

| métrica | antes | depois |
|---|---|---|
| preparação no acento | 1,41× | 1,25× |
| preparação normal | 3,22× | 1,65× |
| preparação fraca | 6,28× | 1,66× |
| altura × força | 0,46× | 1,10× |
| pulso ÷ ponta, pratos | 4,01× | 1,04× |
| pulso ÷ ponta, tambores | 0,48× | 1,00× |
| cotovelo ÷ ponta, pratos | 6,38× | 1,55× |
| cotovelo ÷ ponta, tambores | 2,73× | 2,95× |
| arco nas trocas | 1,83× | 1,11× |
| balanço do peito | 1,43× | 0,92× |
| balanço da cabeça | 2,02× | 1,28× |
| aceno da cabeça no pulso | 0,44× | 1,14× (mesma fase: 0,28 do tempo) |

O golpe continua exato (0 mm em 771 notas de mão e 272 de bumbo nas
fixtures). Ainda falta:
- **cotovelo nos tambores:** a mão sobe 40% e o IK leva o cotovelo junto. O
  esqueleto novo (fase 2) vai girar o antebraço em volta do cotovelo;
- **mão parada:** a do real se mexe muito mais. Precisa olhar se é ruído da
  captura;
- **jerk:** a medida está dominada pelo ruído da roupa de sensores. Precisa
  filtrar o real antes de comparar.


### Fases 2 a 4: esqueleto, biblioteca e gerador (feito)

**Esqueleto humano** (`kit3d/skeleton.js`). Coluna em 3 partes, pescoço, cabeça,
clavículas, braço, antebraço que gira (metade da torção vai pro meio do antebraço),
mão com 5 dedos fechados na baqueta e pernas com tornozelo e dedos. A mão sai da
baqueta por uma pegada fixa, então o contato não depende do braço. O manequim virou
um boneco de madeira articulado (uma malha, um draw call) e o gato ganhou os ossos
novos: o corpo dele é gerado, então os pesos saem sozinhos.

**Biblioteca** (`tools/mmip_moves.py` → `kit3d/moves/mmip.json`, 1,1 MB, CC BY-NC-SA,
fora do git):
- ~15,6 mil golpes das 14 performances. Cada um é o desvio da mão em relação ao
  caminho reto entre as duas poses de golpe (pulso, giro da mão, cotovelo),
  comprimido por PCA (14 componentes explicam 90–95%).
- O corpo: uma regressão das posições dos pulsos pro giro do tronco e das clavículas,
  e 240 trechos de 8 tempos com o resto (balanço, olhadas, ajustes), no tempo da música.
- O que os dados ensinaram no caminho:
  - o atraso entre o MIDI e o movimento muda de uma gravação pra outra (de −83 a
    +108 ms). Ele sai do tranco médio que um ponto preso na mão leva no golpe;
  - duas sessões gravaram os ossos girados 180° em x;
  - a orientação da mão tem um viés: uma baqueta "anatômica" sai apontando pra cima
    na caixa. Por isso só o movimento relativo é transferido (não depende do viés);
  - a pelve deriva 8–12 cm (roupa de sensores). Fica só o que muda em menos de 2 s.

**Gerador** (`kit3d/perform.js`, num Worker). Pra cada golpe, os 12 recortes mais
parecidos (mesma mão e peças, intervalo, força, vizinhos) são testados no nosso kit:
perde quem atravessa uma peça ou mergulha abaixo das duas peças do golpe. Depois
vem um sorteio determinístico entre os melhores, sem repetir. O corpo é assado a
30 Hz: alcance + groove + a cabeça olhando pro próximo alvo longe. Os pés têm regras:
calcanhar levantado no bumbo forte, chimbal fechado ou "chick" no 2 e no 4. Nas
pausas, a mão respira, e numa pausa longa as baquetas descansam nas coxas.

Garantias: contato em 0 mm em todas as notas (fixtures e gravações), o braço alcança
todos os golpes, o plano de uma música de 4 min sai em menos de 1 s e a pose leva
~0,5 ms por quadro (60 fps na Iris Xe).

Laboratório (nosso ÷ real; o real agora é medido com a mesma pegada do nosso):

| métrica | take 02 | take 05 | take 08 |
|---|---|---|---|
| preparação no acento | 1,22× | 1,33× | 1,09× |
| preparação normal | 1,02× | 1,72× | 1,22× |
| preparação fraca | 1,15× | 1,49× | 1,77× |
| altura × força | 1,29× | 1,18× | 0,96× |
| preparação nos pratos | 1,23× | 1,07× | 1,03× |
| preparação nos tambores | 1,18× | 1,68× | 1,17× |
| pulso ÷ ponta, pratos | 0,92× | 0,98× | 0,73× |
| pulso ÷ ponta, tambores | 1,46× | 1,02× | 0,93× |
| velocidade da ponta | 1,27× | 1,26× | 1,06× |
| arco nas trocas | 0,85× | 1,19× | 1,24× |
| balanço do peito | 1,05× | 0,86× | 1,16× |
| balanço da cabeça | 0,98× | 0,76× | 1,20× |
| aceno da cabeça no pulso | 0,82× | 0,69× | 1,88× |

O gerador toca no estilo médio das 14 gravações, então numa gravação mais leve (a
05) os golpes saem maiores que os daquela música. Ainda falta:
- **cotovelo:** mexe ~2× mais que o real em relação à ponta. As proporções do boneco
  são outras;
- **mão parada:** varia muito entre as gravações (0,4× a 2×);
- **raspões:** a ponta ainda raspa 1–2 cm na borda dos pratos em ~0,1–1% do tempo;
- **fase 5:** física (rebote da baqueta, batedor, molas do gato);
- **fase 6:** teste cego (real × nosso).
