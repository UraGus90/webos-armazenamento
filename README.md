# Armazenamento (webOS TV)

App para TV LG em **modo desenvolvedor** cuja ideia era mostrar onde está indo o espaço interno
(espaço livre, tamanho de cada app de desenvolvedor com navegação por pastas, outras áreas, RAM) e
limpar o cache do Kodi.

Testado em **webOS TV Lite 10.3.2** (Node 16.20 no serviço).

---

## ⚠️ Limitação importante — não funciona como esperado na TV

**Quando instalado, o serviço do app roda dentro de uma _sandbox_ (jaula) do webOS que só enxerga os
próprios arquivos — um `/media/developer` isolado de ~668 MB.** Ele **não vê o Kodi** nem nenhum outro
app. Confirmado na TV real:

- "Espaço para apps" mostra **~668 MB** (a visão isolada), não os **1,35 GB** reais.
- A lista de apps mostra **apenas o próprio `org.local.armazenamento`** — Kodi, YouTube etc. não aparecem.
- O cache do Kodi aparece como **0 KB** e a limpeza diz **"Nada para limpar"**.

Ou seja: **medir ou limpar o cache do Kodi (o objetivo principal) é impossível por este app sem root**,
e o webOS 10.x não tem root público. É limitação da plataforma, não do código.

### Por que os testes e o protótipo pareciam corretos

O acesso por **SSH do modo desenvolvedor roda _fora_ da jaula** e enxerga tudo (Kodi, 1,35 GB, o cache).
O **protótipo** (`npm run prototype`) usa um _snapshot_ capturado por esse SSH, então aparece completo.
O **serviço instalado**, jailado, enxerga só a si mesmo. Essa diferença só ficou evidente comparando o
que o app mostra na TV com o que o SSH mostra.

### O que o serviço jailado consegue de fato

- **RAM** (`/proc/meminfo`) — informativo.
- Tamanho do **próprio app**.
- Partições de sistema montadas na jaula (ex.: `/var/luna/preferences`, somente leitura).

Não consegue: tamanho de outros apps, cache do Kodi, remover apps da LG, mudar ajustes do sistema.

### Como realmente limpar o cache do Kodi (sem root)

- **Dentro do Kodi:** usar um addon de limpeza (ex.: `script.limpeza.Matrix`) ou as opções de limpar
  cache/thumbnails do próprio Kodi (que roda como o uid dele e pode apagar o que é seu).
- **Por SSH do modo desenvolvedor** (fora da jaula): apagar com segurança
  `~/.kodi/userdata/Thumbnails`, `~/.kodi/addons/packages` e `~/.kodi/temp` (o Kodi recria o que precisar).

> Nota: a lógica de medição/limpeza (`du`, deleção com allow-list) **funciona** quando executada fora da
> jaula — foi validada por SSH. O que não funciona é o serviço jailado enxergar o Kodi.

---

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `app/` | Interface web (HTML/CSS/JS sem dependências) |
| `service/` | Serviço Node que roda `df`/`du` e responde pelo barramento Luna |
| `tests/` | Testes com `node:test` (56 testes; rodam no PC e no Node 16 da TV) |
| `tools/` | Ícones, empacotador `.ipk`, protótipo para o navegador e scripts da TV |

## Comandos

```sh
npm test            # testes
npm run icons       # gera app/icon.png e app/largeIcon.png
npm run prototype   # dist/prototype/index.html com o snapshot capturado da TV (dados de SSH, não da jaula)
npm run build       # testes + dist/org.local.armazenamento_<versão>_all.ipk
```

Instalar: abrir o `.ipk` no webOS Dev Manager, ou copiar para `/media/developer/temp/` e rodar
`sh tools/tv-install.sh <arquivo.ipk>` na TV.

## Notas de segurança e desenho

- **Sem shell**: `execFile` com binários de caminho absoluto (`/bin/df`, `/usr/bin/du`), argumentos em
  lista, `PATH` mínimo, tempo limite e limite de saída.
- **Limpeza restrita por allow-list**: a interface manda uma _chave_ (`thumbnails`/`packages`/`temp`),
  nunca um caminho; o caminho vem de uma lista fixa dentro de `.kodi`, com recheck de `realpath` e sem
  seguir symlink. (Só relevante fora da jaula — ver limitação acima.)
- **Só o próprio app chama o serviço**: qualquer outro remetente recebe `FORBIDDEN`.
- **Um pedido por vez**, com fila limitada (`BUSY`).
- **Erros internos não vazam**: a interface recebe mensagem genérica; o detalhe vai para o log.
- **Interface**: CSP `default-src 'none'`, sem script/estilo inline, todo texto via `textContent`, sem
  armazenamento local nem rede, `appinfo.json` sem permissões extras.
- **Build reproduzível**: datas e donos fixos no `.ipk`.

## Status

Arquivado como referência. Funciona tecnicamente (empacota, instala, abre, mede e limpa **fora da
jaula**), mas **não cumpre o objetivo na TV** pela limitação da sandbox descrita acima. Mantido pelo
aprendizado sobre o modelo de permissões do webOS em modo desenvolvedor.
