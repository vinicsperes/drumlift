# Golpes de um baterista de verdade

O baterista do player pode tocar com golpes de uma captura real, guardados em
`mmip.json` nesta pasta. O arquivo não vem no repositório: ele é derivado da base
**MMIP** (Multi-Modal Instrument Performances), da Universidade de Chipre e do
CYENS – Centre of Excellence (https://mmip.cs.ucy.ac.cy), que tem licença
**CC BY-NC-SA 4.0** (uso não comercial, com crédito, e derivados com a mesma
licença). Sem ele, o baterista usa o modelo procedural.

O arquivo guarda o movimento de cada mão entre duas notas seguidas (cerca de 15 mil
golpes de 14 performances), em relação ao caminho reto entre as duas poses de
golpe, comprimido por PCA. Pra gerar:

```sh
uv run python tools/mmip.py fetch 1 2 3 4 5 6 7 8 9 10 11 12 13 14
node tools/mmip_bones.mjs songs/mmip/*/
uv run python tools/mmip_moves.py
```

O `mmip.json` gerado segue a licença da base MMIP e fica fora do git.
