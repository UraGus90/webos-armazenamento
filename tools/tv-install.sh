#!/bin/sh
# Roda NA TV (usuário prisoner do modo desenvolvedor): instala um .ipk já copiado
# para /media/developer/temp e apaga a cópia depois. Uso: sh tv-install.sh <arquivo.ipk>
set -u
IPK="/media/developer/temp/$(basename "$1")"
[ -f "$IPK" ] || { echo "não encontrado: $IPK"; exit 1; }
timeout 90 luna-send-pub -i luna://com.webos.appInstallService/dev/install \
  "{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$IPK\",\"subscribe\":true}" 2>&1 \
  | grep -o -E '"(state|statusValue|errorText|errorCode|returnValue)": *[^,}]*' \
  | awk '{print} /installed|failed|"returnValue": *false/ {exit}'
rm -f "$IPK"
