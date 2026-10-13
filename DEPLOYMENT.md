# AutoEllipso V2.1 靜態部署

此專案為 React/TypeScript/Vite 的純前端應用。部署平台只供應 `dist` 中的 HTML、CSS、JavaScript 與瀏覽器 Web Worker；沒有 API、資料庫、帳號、登入、伺服器端 fitting 或實驗資料上傳。使用者開啟 HTTPS 網址即可使用，不需安裝程式。

## 版本與重現

Node 版本由 `.node-version` 指定；pnpm 由 package.json 的 `packageManager` 指定。依賴使用 `pnpm-lock.yaml`。本次全新目錄的安裝未複製 V2 node_modules。

```sh
pnpm install --frozen-lockfile
pnpm run verify
pnpm run build
```

`dist/index.html` 是進入點；Worker 使用 Vite 解析的 module-worker URL，編譯為 `/assets/compute.worker-<hash>.js` 及相關 module chunks。`base: '/'` 適用 Cloudflare Pages 與 Vercel 的網域根目錄。版本顯示於 UI，並提供 `dist/version.json`。

沒有必需的 API key。環境只允許 `VITE_PUBLIC_*` 公開設定；含 KEY/TOKEN/SECRET/PASSWORD 名称會使建置失敗。只讀取平台公開 commit SHA 作为版本資訊，不把其他 process.env 值注入前端。不要把 `.env`、`.qa`、測試憑證或測量檔放進 public/dist。

## Git Repository

本次沒有已設定的 Git remote 或 Cloudflare/Vercel 授權連接，所以沒有發布，也沒有公開網址。若將 V2.1 作為新 repo，可執行：

```sh
git init
git add .
git commit -m "AutoEllipso V2.1 browser-only release"
git branch -M main
git remote add origin <YOUR_GIT_REPOSITORY_URL>
git push -u origin main
```

`<YOUR_GIT_REPOSITORY_URL>` 請替換成自己建立且有權限的 GitHub/GitLab repo；不是已存在的交付網址。若使用整份工作目錄作為 monorepo，部署 root directory 選 `AutoEllipso_V2.1`；如果 repo 內容直接是這個專案，就選 repo 根目錄。

`.github/workflows/ci.yml` 已設定 push/PR 的乾淨安裝、typecheck、科學/Worker tests 及 production build；它沒有部署憑證。此 GitHub Actions workflow 本次尚未在遠端實際執行。

## Cloudflare Pages（優先）

1. 在自己的 Cloudflare 帳號建立 **Pages** 專案，選擇 Git integration 並授權所需 repo。
2. 指定 production branch `main`，root directory 如上述。
3. Build command：`pnpm run build`；Build output directory：`dist`。Node 使用 `.node-version`；如帳號設定需 override，使用 `NODE_VERSION=24.19.0`。pnpm 使用 `11.25.0`。
4. 平台會依 lockfile 安裝依賴。若需要自行控制安裝，可設 `SKIP_DEPENDENCY_INSTALL=1`，build command 改為 `pnpm install --frozen-lockfile && pnpm run build`。
5. 發布後使用平台實際回傳的 production HTTPS 網址；用無痕視窗確認沒有 Access/登入保護。不要啟用實驗資料收集、額外 analytics 或服務端 functions。
6. 後續 push 到 production branch，由 Pages 自動重建/發布；preview branches 與公開 production 網址請分別確認權限。

`wrangler.jsonc` 宣告 Pages 名稱與 `pages_build_output_dir`；沒有 server Worker、storage binding 或帳號密鑰。若用 CLI，先由部署者登入，再執行 `pnpm dlx wrangler pages deploy dist --project-name <YOUR_PAGES_PROJECT_NAME>`，不是啟動 dev server。

此應用沒有 client-side 子頁路由。Pages 沒有頂層 `404.html` 時採 SPA fallback，未知路徑回到根 index，且不覆蓋正常 assets；因此沒有用會錯誤改寫 Worker/JS 的全站 `_redirects`。`public/_headers` 在 build 複製到 dist，供 Pages 套用安全政策。

依據：[Cloudflare build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)、[build image/version overrides](https://developers.cloudflare.com/pages/configuration/build-image/)、[SPA serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/)。

## Vercel

1. Import Git repository，root directory 如上述，Framework Preset 選 Vite。
2. `vercel.json` 已設定 install=`pnpm install --frozen-lockfile`、build=`pnpm run build`、output=`dist`。
3. Node 選與 .node-version 相容的 24.x；production branch 選 main。
4. SPA rewrites 與安全 headers 已設定；沒有 functions/api。發佈後以實際回傳的 production HTTPS URL 在無痕視窗驗證，並確認 production Deployment Protection 未要求使用者登入。
5. 後續 Git push 由 Vercel Git integration 自動重建。CLI 可由部署者登入後 `pnpm dlx vercel --prod`。

依據：[Vite on Vercel / SPA rewrites](https://vercel.com/docs/frameworks/frontend/vite)、[vercel.json configuration](https://vercel.com/docs/project-configuration/vercel-json)。

## 資料與安全政策

所有實驗輸入、參數、候選解與結果在單一分頁記憶體，沒有 localStorage、sessionStorage、IndexedDB 或跨分頁通訊。使用者自行下載 JSON/CSV/Validation Report；關閉分頁終止 Worker，不送資料。清除按鈕停止工作並重新載入空白專案，清掉分頁資料與計算快取。

CSP 設定 `connect-src 'none'`、`worker-src 'self'`、`script-src 'self'`；Worker 只載入相同 origin 的靜態計算模組，不能連接外部 fitting/AI API。安全 headers 在 Pages、Vercel 與 production preview 對齊。網站主機仍會接收到一般靜態網站 GET 請求，沒有實驗資料 payload。

## 本機 production 驗證

```sh
pnpm run preview
```

這只用於本機驗證；公開服务必须由平台托管 production dist，不可把 Vite dev server 暴露出去。本次跨瀏覽器測試另外使用本機臨時 HTTPS 憑證驗證 production preview；測試憑證不在 dist、Git 或交付 ZIP。

部署完成後還需實際驗證平台網址：index、每個 JS/Worker chunk 的 MIME、HTTPS、刷新、CSP、CSV/JSON 匯入匯出、Automatic/Expert、取消、手機控制點、公開訪問權限。平台 CDN/headers/帳號權限本次尚未實際部署驗證，不能以本機通過代替。
