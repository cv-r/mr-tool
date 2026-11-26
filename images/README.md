# 界面截图

扩展的截图统一放在这个目录，根目录的 `README.md` 会自动引用。

## 文件约定

| 文件 | 内容 | 状态 |
| --- | --- | --- |
| `sidebar.png` | 侧边栏总览（创建 / 分配给我 / 待我评审） | 已上传 |
| `home.png` | 创建合并请求面板 | 已上传 |
| `my-mrs.png` | 分配给我的 MR | 占位图 |
| `my-reviews.png` | 待我评审的 MR | 占位图 |
| `my-created.png` | 我发起的 MR / 编辑面板 | 占位图 |

## 上传要求

- 正方形（1:1），建议 1000×1000 或 1280×1280，PNG 格式
- 单张建议不超过 500KB
- 当前放的是占位图，直接用同名文件覆盖即可，README 不需要改
- 想新增截图：放入本目录，并在根目录 `README.md` 的「界面截图」表格中加一行

## Marketplace 显示说明

- **VS Code 扩展详情页**：相对路径可用，图片会随 VSIX 一起打包
- **Marketplace 网页**：相对路径需要仓库公开且 `package.json` 配置了 `repository` 才能解析；否则请改用绝对 URL，例如 `https://raw.githubusercontent.com/<用户>/<仓库>/main/images/xxx.png`
