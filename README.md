# xiangqi-online · 在线象棋

网页版中国象棋对弈平台。引擎 [Pikafish](https://github.com/official-pikafish/Pikafish)（皮卡鱼）编译为 WebAssembly 直接在浏览器里运行，
不需要引擎服务器；可选难度，不选难度时按对局成绩自动评级并匹配强度；注册登录后保存棋谱并复盘。

状态：开发中（2026-10）。

| 目录 | 内容 |
|---|---|
| `pikafish-web/` | Pikafish → WebAssembly 的补丁、桥接代码、构建脚本与编译产物 `dist/` |
| `site/` | 前端静态站源码（部署到 Cloudflare Pages） |
| `scripts/build-site.sh` | 组装 `public/`：拷贝站点与引擎、下载并切块 48 MB 权重 |
| `engine/nnue.lock` | 当前引擎构建所匹配的权重文件 sha256（权重不入库） |

## 本地运行

```bash
bash scripts/build-site.sh          # 生成 public/（首次会下载 48 MB 权重到 .cache/）
node pikafish-web/demo/serve.js 8080 public   # 带 COOP/COEP 头的本地静态服务器
# 打开 http://localhost:8080/
```

## 测试

```bash
npm test                                   # 规则库：perft(1..3) 对比标准值 + 规则点
node tests/rules.test.js 4                 # 含 perft(4) = 3,290,240
node tests/e2e.play.js                     # 无头 Chromium 端到端对弈（需 playwright 与 public/）
node pikafish-web/test/node-test.js <pikafish.nnue> 2   # 引擎 WASM 冒烟测试
```

## 部署（Cloudflare Pages）

Workers & Pages → Create → Pages → Connect to Git → 选择本仓库，构建设置：

| 项 | 值 |
|---|---|
| Framework preset | None |
| Build command | `bash scripts/build-site.sh` |
| Build output directory | `public` |
| 环境变量 | 不需要 |

`site/_headers` 已配置 wasm 多线程所需的 COOP/COEP 响应头与缓存策略；
48 MB 权重在构建时下载并切成 20 MiB 分块（Cloudflare 单文件上限 25 MiB），浏览器端用 Cache API 缓存。

## 目录（补充）

| 目录 | 内容 |
|---|---|
| `site/js/xiangqi.js` | 规则库：走法生成、将军/合法性、终局判定、中文记谱 |
| `site/js/engine.js` / `engine-worker.js` | 引擎控制层：Worker 封装、权重分块加载、难度分级选着 |
| `site/js/board.js` / `app.js` | SVG 棋盘与对弈页面 |
| `tests/` | 规则测试与端到端测试 |

## 许可

Pikafish 及 `pikafish-web/` 为 GPL-3.0；本仓库其余代码 MIT。
