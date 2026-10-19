# Armazenamento (webOS TV)

App para TV LG em modo desenvolvedor que mostra, **somente leitura**, onde está indo o espaço interno:
espaço livre para apps, quanto cada app de desenvolvedor ocupa (com navegação por pastas) e as outras
áreas (partição de configurações, memória temporária, pendrive).

Testado em webOS TV Lite 10.3.2 (Node 16.20 no serviço).

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `app/` | Interface web (HTML/CSS/JS sem dependências) |
| `service/` | Serviço Node que roda `df`/`du` na TV e responde pelo barramento Luna |
| `tests/` | Testes com `node:test` (rodam no PC e no Node 16 da TV) |
| `tools/` | Ícones, empacotador `.ipk`, protótipo para o navegador e scripts da TV |

## Comandos

```sh
npm test            # testes
npm run icons       # gera app/icon.png e app/largeIcon.png
npm run prototype   # dist/prototype/index.html com dados reais capturados da TV
npm run build       # testes + dist/org.local.armazenamento_<versão>_all.ipk
```

O protótipo aceita `index.html#pasta=<caminho>` para abrir direto uma pasta.

Para instalar: abrir o `.ipk` no webOS Dev Manager, ou copiar para `/media/developer/temp/` e rodar
`sh tools/tv-install.sh <arquivo.ipk>` na TV.

## Decisões de segurança

- **Somente leitura**: o serviço não escreve, não apaga e não acessa a rede. Testes estáticos garantem isso.
- **Sem shell**: `execFile` com binários de caminho absoluto (`/bin/df`, `/usr/bin/du`), argumentos em
  lista, `PATH` mínimo, tempo limite e limite de saída.
- **Caminhos restritos**: só pastas abaixo de `applications/` e `services/` dos apps de desenvolvedor; o
  caminho é normalizado e o `realpath` é conferido de novo, então links simbólicos não escapam.
- **Só o próprio app chama o serviço**: qualquer outro remetente recebe `FORBIDDEN`. Isso foi conferido na TV.
- **Um pedido por vez**, com fila limitada (`BUSY`), para não sobrecarregar a TV.
- **Erros internos não vazam**: a interface recebe uma mensagem genérica; o detalhe vai para o log.
- **Interface**: CSP `default-src 'none'`, sem script/estilo inline, todo texto via `textContent`, sem
  armazenamento local nem rede, `appinfo.json` sem permissões extras.
- **Build reproduzível**: datas e donos fixos no `.ipk`; links simbólicos são recusados no empacotamento.
