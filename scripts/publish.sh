#!/usr/bin/env bash
# 发布到 VS Code Marketplace。
#
# 用法：
#   export VSCE_PAT="<Azure DevOps Personal Access Token>"
#   ./scripts/publish.sh              # 发布当前版本
#   ./scripts/publish.sh patch        # 先升版本（0.1.0 -> 0.1.1）再发布
#   ./scripts/publish.sh minor|major  # 升次版本 / 主版本
#
# PAT 创建：https://dev.azure.com/_usersSettings/tokens
#   Organization: All accessible organizations
#   Scopes: Marketplace -> Manage

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node，请先安装 Node.js。" >&2
  exit 1
fi

read_pkg() {
  node -p "require('./package.json').$1"
}

PUBLISHER=$(read_pkg publisher)
NAME=$(read_pkg name)
VERSION=$(read_pkg version)

if [[ -z "${VSCE_PAT:-}" ]]; then
  cat >&2 <<'EOF'
缺少 VSCE_PAT 环境变量。

1. 打开 https://dev.azure.com/_usersSettings/tokens
2. Organization 选择 All accessible organizations
3. Scopes 勾选 Marketplace -> Manage
4. 然后执行：
   export VSCE_PAT="粘贴 token"
   再重新运行本脚本
EOF
  exit 1
fi

case "${1:-}" in
  patch | minor | major)
    npm version "$1" --no-git-tag-version >/dev/null
    VERSION=$(read_pkg version)
    ;;
  "")
    ;;
  *)
    echo "用法: $0 [patch|minor|major]" >&2
    exit 1
    ;;
esac

echo "发布 ${PUBLISHER}.${NAME}@${VERSION}"
echo "token: ${VSCE_PAT:0:4}****"

npm run package
npx @vscode/vsce publish --packagePath "${NAME}-${VERSION}.vsix" -p "$VSCE_PAT"

echo "完成: https://marketplace.visualstudio.com/items?itemName=${PUBLISHER}.${NAME}"
