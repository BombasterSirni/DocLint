#!/usr/bin/env bash
# Собирает статический сайт и публикует его в репозиторий doclint-site.
# Требуется доступ на push в https://github.com/BombasterSirni/doclint-site.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE_REMOTE="${DOCLINT_SITE_REMOTE:-https://github.com/BombasterSirni/doclint-site.git}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cd "$ROOT"
rm -rf dist
mkdir -p dist
cp -r index.html assets sw.js dist/
touch dist/.nojekyll

cp -r dist/. "$TMP/"
cd "$TMP"
git init -q -b main
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-DocLint}" \
    -c user.email="${GIT_AUTHOR_EMAIL:-doclint@users.noreply.github.com}" \
    commit -q -m "Publish DocLint static site"
git push -f "$SITE_REMOTE" main

echo "Опубликовано: https://bombastersirni.github.io/doclint-site/"
