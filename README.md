# SnapBudget

拍照即記帳：收據、支付截圖、價目表／食物照片 → Gemini Vision 辨識 → 預算儀表板。

## 檔案結構

```
snapbudget/
├── index.html              # 前端（Tailwind + Chart.js，資料存在 localStorage）
├── manifest.json           # PWA 設定
├── sw.js                   # Service Worker
└── functions/api/analyze.js  # Cloudflare Pages Function：呼叫 Gemini（金鑰藏在這裡）
```

## 部署（Cloudflare Pages + GitHub）

1. 把整個資料夾推到 GitHub repo（**不要**把 API key 寫進任何檔案）。
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git，選這個 repo。
   - Framework preset: None
   - Build command: （留空）
   - Build output directory: `/`
3. 部署完成後：Settings → Variables and Secrets → 新增
   - `GEMINI_API_KEY` = 你的 key（選 Secret）
   - （可選）`GEMINI_MODEL` = 想用的模型名稱，預設 `gemini-3.8-flash`
4. 重新部署一次讓變數生效，用手機打開網址測試。

## 本機測試（可選）

```
npx wrangler pages dev . --binding GEMINI_API_KEY=你的key
```

## Demo 備案

- 辨識失敗時，App 會跳出確認視窗讓你手動補金額，不會卡住。
- 現場網路不穩：先錄一段完整操作影片當備案。
