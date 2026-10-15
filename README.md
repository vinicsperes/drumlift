# drumlift

Pega uma música, isola a bateria, gera a tablatura e toca a tab de volta
no andamento da música, pra você conferir de ouvido se ela bate com a gravação.

```
música ──► Demucs ──► bateria isolada ──► ADTOF ──► notas (bumbo, caixa, chimbal, tom, pratos)
   │                                                       │
   └──► beat_this ──► batidas + início de compasso ──► grade ──► tab.txt / drums.mid / player
```

- **Demucs** (htdemucs) separa a bateria do resto da banda.
- **ADTOF** (port em PyTorch) transcreve a bateria isolada em 5 classes.
- **beat_this** acha cada batida e o início de cada compasso. A grade segue
  as batidas reais, então a tab não sai do lugar se a banda acelerar ou atrasar.
- As notas são encaixadas na grade: semicolcheia, ou tercina quando a música
  tem levada de shuffle (escolhido sozinho).

## Instalação

Precisa de [uv](https://docs.astral.sh/uv/) e `ffmpeg`.

```sh
uv sync
```

Na primeira execução ele baixa os modelos do Demucs e do beat_this (~160 MB).

## Uso

```sh
uv run drumlift run "minha musica.mp3"
```

Processa a música, grava tudo em `out/minha-musica/` e abre o player no navegador.
Numa CPU comum uma música de 4 minutos leva uns 2 a 3 minutos (quase tudo é o Demucs).
As etapas pesadas ficam em cache, então rodar de novo é rápido.

```sh
uv run drumlift play out/minha-musica          # abre o player de novo
uv run drumlift retab out/minha-musica --grid 3 # refaz só a tab (segundos)
```

Opções úteis (`run` e `retab`):

| opção | o que faz |
|---|---|
| `--grid auto\|4\|3\|6\|8\|2` | divisões por tempo. `4` = semicolcheia, `3` = tercina. Padrão: `auto` |
| `--sens 1.3` | pega notas mais fracas (ghost notes, chimbal baixo). `0.8` fica só com as fortes |
| `--kit pasta/` | usa seus samples no player (`kick.wav`, `snare.wav`, `hihat.wav`, `tom.wav`, `crash.wav`, `ride.wav`) |
| `--from mix` | transcreve da música inteira em vez da bateria isolada (às vezes vai melhor) |
| `--model htdemucs_ft` | separação melhor, 4x mais lenta (só no `run`) |
| `--no-play` | não abre o player no final |

Também aceita um link no lugar do arquivo, se o `yt-dlp` estiver instalado (`uv tool install yt-dlp`).

## O player

A tela toda é o palco: um gato de pelúcia toca a tab em sincronia com a música
(ou um manequim, em **Ajustes → Visual**). Embaixo, a **faixa de notas** mostra as
próximas notas chegando na linha do "agora", uma linha por peça, com a mão que toca
cada nota: **D** (direita) ou **E** (esquerda), a mesma conta que o gato usa.

O baterista pode aprender com um baterista de verdade: com a biblioteca de golpes
gerada, cada golpe usa o golpe mais parecido de uma captura de movimento (14 músicas
tocadas com uma roupa de sensores) e o tronco e a cabeça balançam como os dele. Isso é
calculado quando a música abre, em segundo plano; a ponta da baqueta continua
encostando na peça exatamente na hora de cada nota. A biblioteca não vem no
repositório, porque a captura é de uso não comercial; pra gerar, veja
[`kit3d/moves/LEIA-ME.md`](drumlift/player/kit3d/moves/LEIA-ME.md). Sem ela, o
baterista usa um modelo procedural. Nos dois casos, o pé direito toca de calcanhar
levantado nas partes fortes.

**Pra validar a tab:**
- **Tab / Original** (tecla `A`) alterna entre a banda com a tab tocando e a banda com a
  bateria de verdade. Se as duas soarem iguais, a tab está certa.
- Clique no nome de uma peça na faixa (`HH`, `SD`…) pra silenciar ela; `Shift`+clique pra
  ouvir só ela. Vale pro som e pro gato.
- Kit **Bipes** (em Ajustes → Som) toca cada peça num tom diferente, pra ouvir as linhas separadas.
- Nota apagada = o modelo teve pouca confiança nela. Comece conferindo essas.

**Pra estudar:**
- Arraste na faixa de notas pra marcar um **loop** (`L` liga e desliga); clique pra pular.
- **Velocidade** de 50% a 100% (`[` e `]`). O som fica mais grave quando você desacelera,
  e o gato desacelera junto.
- **Metrônomo** marca as batidas detectadas (o primeiro tempo é mais agudo).
- Câmeras `1` frente, `2` baterista (por cima do ombro), `3` lado (os pés) e `4` cima;
  arraste no palco pra girar. **Antecipação** desenha um anel que fecha na peça na hora do golpe.
- As mãos são deduzidas por regras de baterista destro (chimbal na direita cruzando a
  esquerda na caixa, viradas alternando D-E), então podem não ser as que o baterista
  original usou.

**Pra corrigir:** **Tab completa** (`T`) abre a grade de todos os compassos. Lá, **Editar**
(`E`) e clique nas casas pra pôr ou tirar notas (`Alt`+clique na caixa = nota fantasma);
`Ctrl+Z` desfaz e **Salvar** (`Ctrl+S`) regrava `tab.txt`, `drums.mid` e os áudios.

Atalhos: `espaço` tocar/pausar · `←` `→` compasso · `A` tab/original · `L` loop ·
`M` metrônomo · `[` `]` velocidade · `1`–`4` câmeras · `T` tab completa · `Esc` fecha.

## Arquivos gerados

| arquivo | |
|---|---|
| `tab.txt` | tablatura em texto (compassos repetidos são resumidos) |
| `drums.mid` | MIDI com mapa de andamento: abre já na grade certa no MuseScore, Guitar Pro ou Reaper, e vira partitura |
| `drums.wav` / `no_drums.wav` | bateria isolada / banda sem bateria |
| `tab_synth.wav` / `tab_with_band.wav` | a tab tocada sozinha / tocada junto com a banda |
| `song.json` | tudo que o player usa (batidas, grade, notas) |

## Limitações

- O ADTOF reconhece 5 classes: **bumbo, caixa, chimbal, tom e prato**. Então:
  - chimbal aberto e fechado saem iguais;
  - todos os tons caem na mesma linha `T`;
  - crash ou ride é decidido por heurística: prato tocado em sequência vira ride, batida avulsa vira crash.
- Notas mais rápidas que a grade (fusas num fill) se juntam numa só.
- A fórmula de compasso é a mesma pra música inteira (a mais detectada).
- Mixagem muito densa (metal com dois bumbos, muita distorção) piora a separação e a transcrição.
- No MIDI, o tick 0 é o começo do primeiro compasso, que pode cair um pouco antes do
  áudio começar. O deslocamento fica num marcador no MIDI (`audio original em +X s`).

## Testes

Gera músicas sintéticas com gabarito e mede quantas notas a tab acertou:

```sh
uv run python tests/make_test_song.py songs/teste.wav --bpm 96 --bpm-end 116 --bars 24
uv run drumlift run songs/teste.wav --no-play
uv run python tests/score.py out/teste songs/teste.truth.json
```

Resultados atuais (F1): andamento fixo 0.99, acelerando de 96 a 116 BPM 0.98, shuffle em tercina 0.98.

O palco 3D tem uma página própria pra desenvolvimento, sem áudio: sirva a raiz do
repositório (`python -m http.server`) e abra `/drumlift/player/kit3d-dev.html`.
Detalhes em [`docs/kit3d.md`](docs/kit3d.md). O movimento do baterista e o laboratório
que compara o nosso com o baterista real estão em [`docs/animacao.md`](docs/animacao.md).

## Licença

O código deste projeto é MIT (veja [`LICENSE`](LICENSE)). O que ele usa de fora tem
licença própria:

- **Modelo ADTOF** (baixado na instalação): CC BY-NC-SA 4.0, **só uso não comercial**
  ([ADTOF](https://github.com/MZehren/ADTOF), [ADTOF-pytorch](https://github.com/xavriley/ADTOF-pytorch)).
  É ele que transcreve a bateria, então essa restrição vale pra quem usa o projeto.
- **Demucs** e **beat_this** (código e pesos): MIT.
- **Three.js** e **fflate**, copiados no player: MIT (`drumlift/player/vendor/LICENSE-*.txt`).
- **Fonte Instrument Serif**: SIL Open Font License 1.1 (`drumlift/player/vendor/fonts/OFL.txt`).
- **Biblioteca de golpes** (opcional, fora do repositório): gerada a partir da base
  [MMIP](https://mmip.cs.ucy.ac.cy) (Universidade de Chipre / CYENS), CC BY-NC-SA 4.0,
  **só uso não comercial**.
