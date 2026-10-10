# drumSomething

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
uv run drumsomething run "minha musica.mp3"
```

Processa a música, grava tudo em `out/minha-musica/` e abre o player no navegador.
Numa CPU comum uma música de 4 minutos leva uns 2 a 3 minutos (quase tudo é o Demucs).
As etapas pesadas ficam em cache, então rodar de novo é rápido.

```sh
uv run drumsomething play out/minha-musica          # abre o player de novo
uv run drumsomething retab out/minha-musica --grid 3 # refaz só a tab (segundos)
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

Ele mostra a tab rolando junto com a música, com a coluna atual destacada.

**Pra validar a tab:**
- O padrão é **banda sem bateria + tab tocando**. Se soar igual à música, a tab está certa.
- **A/B** (tecla `A`) alterna entre a bateria original e a tab, mantendo a banda. É o jeito mais rápido de achar diferença.
- Clique no nome de uma peça (`HH`, `SD`…) pra silenciar ela na tab, ou `Shift`+clique pra ouvir só ela.
  Pra conferir só o chimbal, por exemplo, deixe "Bateria isolada" ligada e sole o `HH`.
- Kit `bipes` toca cada peça num tom diferente, assim dá pra ouvir as linhas separadas.
- Nota apagada = o modelo teve pouca confiança nela. Comece conferindo essas.

**Pra estudar:**
- Clique no número do compasso pra pular pra ele, `Shift`+clique em outro pra fazer **loop** do trecho.
- **Velocidade** de 50% a 100%. O som fica mais grave quando você desacelera.
- **Metrônomo** marca as batidas detectadas (o primeiro tempo do compasso é mais agudo).

**Pra corrigir:** ligue **Editar** (`E`), clique nas casas pra pôr ou tirar notas
(`Alt`+clique na caixa = nota fantasma), `Ctrl+Z` desfaz e **Salvar** (`Ctrl+S`) regrava
`tab.txt`, `drums.mid` e os áudios.

Atalhos: `espaço` tocar/pausar · `←` `→` compasso · `L` loop · `M` metrônomo · `F` seguir a tab.

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
uv run drumsomething run songs/teste.wav --no-play
uv run python tests/score.py out/teste songs/teste.truth.json
```

Resultados atuais (F1): andamento fixo 0.99, acelerando de 96 a 116 BPM 0.98, shuffle em tercina 0.98.

## Licenças

- Modelo ADTOF: CC BY-NC-SA 4.0, **só uso não comercial** ([ADTOF](https://github.com/MZehren/ADTOF), [ADTOF-pytorch](https://github.com/xavriley/ADTOF-pytorch)).
- Demucs: MIT. beat_this: MIT.
