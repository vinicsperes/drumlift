# Golpes de um baterista de verdade

`mmip.json` é derivado da base **MMIP** (Multi-Modal Instrument Performances),
da Universidade de Chipre e do CYENS – Centre of Excellence:
https://mmip.cs.ucy.ac.cy. Licença **CC BY-NC-SA 4.0**: uso não comercial,
com crédito, e derivados com a mesma licença. Este arquivo segue a mesma
licença.

Ele guarda o movimento de cada mão entre duas notas seguidas (cerca de 15 mil
golpes de 14 performances), em relação ao caminho reto entre as duas poses de
golpe, comprimido por PCA. Pra gerar de novo:

```sh
uv run python tools/mmip.py fetch 1 2 3 4 5 6 7 8 9 10 11 12 13 14
node tools/mmip_bones.mjs songs/mmip/*/
uv run python tools/mmip_moves.py
```
