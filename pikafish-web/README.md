# pikafish-web — 浏览器里运行的皮卡鱼（Pikafish）象棋引擎

把 [official-pikafish/Pikafish](https://github.com/official-pikafish/Pikafish)（GPL-3.0）编译成 WebAssembly，
在 Web Worker 中以 UCI 协议驱动，供网页象棋平台做"人机对弈 / 复盘分析"的本地引擎，**不需要任何引擎服务器**。

做法参考 Lichess 的 [lila-stockfish-web](https://github.com/lichess-org/lila-stockfish-web)：
用一个 JS 命令队列替换 `std::getline(std::cin)`，引擎主循环跑在一个 pthread（`-sPROXY_TO_PTHREAD`）里阻塞等待命令。
对 Pikafish 源码的全部改动在 `patches/pikafish-web.patch`（约 60 行，全部用 `#ifdef __EMSCRIPTEN__` 包起来，不影响原生构建）。

## 目录

```
pikafish-web/
├── dist/                    编译产物：pikafish.js  pikafish.wasm  (pikafish.worker.js，旧版 emsdk 才有)
├── patches/pikafish-web.patch   对 Pikafish 源码的补丁（基于 master ce9fb839, 2026-10-14）
├── src/glue.hpp, glue.cpp   JS <-> 引擎 桥：命令队列、uci()、setNnueBuffer()
├── src/pre.js               注入到 Emscripten 工厂函数里的 JS API
├── src/main_shim.cpp        仅旧版工具链需要的入口垫片（build.sh 自动判断）
├── Makefile / build.sh      一键构建（自动克隆固定版本的 Pikafish、打补丁、编译）
├── test/node-test.js        Node 冒烟测试
├── demo/                    浏览器自测页（index.html + engine-worker.js + 带 COOP/COEP 头的本地静态服务器）
└── .github/workflows/build-wasm.yml   GitHub Actions：用官方 emsdk 构建并上传产物
```

## 用法

```js
// 在 Web Worker 里（见 demo/engine-worker.js）
importScripts('/engine/pikafish.js');
const engine = await Pikafish({
  locateFile: f => '/engine/' + f,             // pikafish.wasm 所在目录
  mainScriptUrlOrBlob: '/engine/pikafish.js',  // 搜索线程会再次加载主脚本
  listen: line => postMessage(line),           // 引擎每输出一行调用一次
  onError: msg => console.error(msg),
});
const nnue = new Uint8Array(await (await fetch('/engine/pikafish.nnue')).arrayBuffer());
engine.setNnueBuffer(nnue);          // 直接喂下载来的 pikafish.nnue（zstd 压缩态，引擎自己解压）
engine.uci('uci');
engine.uci('setoption name Threads value 2');
engine.uci('position startpos moves h2e2');
engine.uci('go movetime 1000');      // 之后 listen 会收到 info ... 和 bestmove ...
```

API：`uci(cmd)`、`setNnueBuffer(Uint8Array)`、`getRecommendedNnue()`（返回 `"pikafish.nnue"`）、`listen`、`onError`。
UCI 命令与原生 Pikafish 完全一致（`uci / isready / ucinewgame / position / go / stop / setoption / quit`）。

### 必须满足的部署条件

1. **cross-origin isolation**：wasm 多线程依赖 `SharedArrayBuffer`，页面必须带响应头
   `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`。
   * 能自定义响应头的托管直接配置即可（Cloudflare Pages `_headers`、Netlify `_headers`、Vercel `vercel.json`、自己的 Nginx）。
   * GitHub Pages 不能设置响应头，用 [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) 在首次加载后由 Service Worker 补上这两个头（demo 页会检测 `crossOriginIsolated` 并提示）。
2. **网络权重文件** `pikafish.nnue` 约 48 MB（zstd 压缩态，已基本不可再压缩），加载后占内存约 61 MB。
   不要提交进 git；部署时从 <https://github.com/official-pikafish/Networks/releases/download/master-net/pikafish.nnue> 下载并与站点同源托管，
   前端用 Cache API / Service Worker 缓存一次即可。注意 Cloudflare Pages 单文件上限 25 MB，需拆分或放 R2。
3. 内存：`INITIAL_MEMORY=192MB`，可增长到 2 GB。手机浏览器也能跑，但建议 `Threads` 不超过 `hardwareConcurrency - 1`。

### 实测（本次构建，emcc 3.1.6，沙箱 2 核）

| 场景 | 结果 |
|---|---|
| 实例化到 `uciok` | ~0.45 s |
| 加载 48 MB 网络 | ~1.2 s（不含下载） |
| 起始局面 `go depth 14` | 0.25 s，单线程 ~25 万 NPS；2 线程 ~52 万 NPS |
| Chromium 无头浏览器 `go movetime 1000` | 开局达到 depth 26 |
| `MultiPV 3`、`go infinite` + `stop`、`quit` | 正常 |

## 难度分级怎么做

当前 Pikafish **没有** `Skill Level` / `UCI_LimitStrength` / `UCI_Elo` 选项（早年版本有，后来删掉了），
`uci` 只返回：Threads、Hash、Ponder、MultiPV、Move Overhead、nodestime、UCI_ShowWDL、EvalFile 等。
所以"难度"在 JS 层实现，三个旋钮组合：

1. **搜索量**：`go depth N` 或 `go nodes N`（比 `movetime` 更可复现、不受设备快慢影响）；
2. **候选着法随机化**：`setoption name MultiPV value K`，从 K 个候选里按分差做加权随机（分差越大越少选），低难度 K 大、温度高；
3. **偶发失误**：低难度以一定概率从"分差在 X 厘兵以内的次优着"中选。

每一级对应一组 `(nodes, MultiPV, 温度, 失误概率)`；用户没选难度时，用用户的对局成绩做 Elo/Glicko 评级，再映射到最接近的一级——这就是项目描述里"像模型迭代一样跟着用户涨"的机制。
引擎输出的 `score cp` 还可直接用于复盘：每一步的失分、最佳着、胜率曲线。

## 构建

```bash
# 本机：先安装并激活 Emscripten（https://emscripten.org/docs/getting_started/downloads.html）
./build.sh                      # 克隆 Pikafish 固定提交 → 打补丁 → make → dist/
node test/node-test.js /path/to/pikafish.nnue 2     # 冒烟测试
node demo/serve.js 8080 && 打开 http://localhost:8080/demo/   # 浏览器自测（需把 pikafish.nnue 放到 ../nnue/）
```

CI：`.github/workflows/build-wasm.yml` 用官方 emsdk 构建并上传 `dist/`，打 Release 时自动附到 Release 上。

跟进上游更新：改 `build.sh` 里的 `PIKAFISH_REF`，若 `git apply` 失败则按补丁逐处手工合并（改动点都很小）。

## 许可

Pikafish 与本目录中的补丁、桥接代码均为 **GPL-3.0**。
网页平台通过 `postMessage` 与引擎 Worker 通信，平台本身代码可用其他许可，但分发 `dist/` 时需同时提供（或链接到）对应源码与补丁，本仓库已满足。
