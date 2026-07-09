# 數A 特訓系統 — Web App 系統設計（交接文件）

> 2026-07-09 建立。給接手開發 app 的模型：這份講**程式本身的架構、資料模型、功能系統、修改與部署方式**。內容生產線（題庫/類題/蒸餾）看 OPERATIONS.md。戰略與診斷看 README.md。

## 0. 一句話架構

**單頁純前端 vanilla JS，無框架、無 build step、無 npm**。四個檔案（index.html/style.css/bank.js/app.js）直接開就能跑。資料離線優先存 localStorage，登入後鏡像同步到 Supabase。手機電腦皆可，響應式。

## 1. 檔案結構（worktree 分支 claude/math-exam-prep-7c2pg4）

```
index.html   16 行：外殼。<header><nav></nav></header> + <main id="app"></main> + supabase CDN + bank.js + app.js
style.css    ~230 行：白底考卷風（飼主指定：不分系統亮暗一律白底），CSS 變數在 :root；body.session-on 做題時隱藏 header/同步燈
bank.js      513 行：TOPICS(14單元) + DIFF_TARGET + BANK(83題陣列) + GRADE_TABLE
app.js       1621 行：全部邏輯。載入即 boot()，用 hash-less 的 nav() 切換 7 個 view，每個 view 是一個 render 函式把 HTML 塞進 #app
```

**渲染模型**：沒有虛擬 DOM。每個 view 是 `renderXxx()` 函式，直接 `app().innerHTML = \`...\``。互動用 inline `onclick="fn()"` 呼叫全域函式（所有函式都是全域，因為 app.js 不是 module）。狀態變了就重新 render 整個 view。

## 2. 資料模型

### 2.1 全域狀態 S（存 localStorage 的 key = 'mathA13'）
```js
S = {
  attempts: [ { qid, ok, ms, err, d(日期), mode, ts(時間戳), p?(手寫過程) } ],  // 每次作答
  wrong:    { <qid>: { fails, wins, itv(間隔天數), err, due(下次重測日) } },       // 錯題本
  drills:   { <drillKey>: [ { d, med(中位數ms), acc } ] },                          // 速度特訓歷史
  mocks:    [ { d, ok, n, acc } ],                                                  // 模擬成績
  daily:    { <日期>: { <taskKey>: true } },                                        // 每日清單打勾
  extbank:  [ …外部題(官方/講義/類題) ],   // 私有層題庫，見 OPERATIONS.md §3
  ver: 1,   // （舊資料可能殘留 inkcfg——橡皮擦已移除，欄位閒置無害）
}
```
`load()`(app.js:8) 讀 localStorage，`save()`(app.js:15) 寫回並觸發 `syncQueue()`（雲端 debounce 上傳）。

### 2.2 題目 schema（BANK 與 extbank 共用）
```js
{ id, topic(14單元鍵), type('single'|'multi'|'fill'), diff(1|2|3), q,
  opts?(選擇題陣列), ans(single/multi=0-based索引陣列; fill=[字串]),
  sol(詳解), tip(快解), target?(自訂目標秒數), src?(來源標記) }
```
- 14 單元鍵見 TOPICS：num line poly seq comb prob data trig1 trig2 exp vec svec splane mat
- `qTarget(q)`(app.js:473)：目標時間 = q.target || DIFF_TARGET[q.diff]（易90/中150/難240秒）
- `checkFill`(app.js:461)：填充題判分，先 norm() 正規化（全形/負號/空白/x=前綴），再 parseFrac 比數值
- `applyExtBank()`(app.js:30)：把 S.extbank 併進全域 BANK 陣列（id 去重），boot 時與雲端 pull 後都會呼叫

## 3. 七個 View（nav 切換，VIEWS 物件 app.js:518）

| view | 函式 | 功能 |
|---|---|---|
| 📋 診斷 home | renderHome:545 | 首頁：倒數天數、體感級分、診斷書、四訓練線、三階段路線、考場SOP |
| ⚡ 速度特訓 drill | renderDrillMenu:770 | 12 種基本運算限時連發（見 §4.1）|
| 🎯 主題刷題 prac | renderPracConfig:913 | 選單元→逐題計時作答→錯因分類（見 §4.2）|
| ⏱️ 模擬實戰 mock | renderMockIntro:1084 | 12題36分、兩輪作答、考場模式（見 §4.3）|
| 📓 錯題本 wrong | renderWrong:1267 | 間隔重測 1→3→7→14 天（見 §4.4）|
| 📊 數據 stats | renderStats:1322 | 單元答對率/速度、錯因處方、過程診斷、雲端同步卡、備份卡 |
| 🗓️ 作戰計畫 plan | renderPlan:1404 | 每日清單、三階段路線表、考場SOP |

`nav(view)`(app.js:528)：切 view 前若 sessionActive 會 confirm、關手寫板、停碼表。

## 4. 核心功能系統

### 4.1 速度特訓（DRILLS，app.js:610）
12 種程式隨機生成的基本運算，每輪 12 題。每種是 `{ name, desc, target(秒), gen() }`，gen 回傳一題。
- 種類：tri(特殊角三角值) logexp(指對數) quad(二次頂點) rem(餘式) cnk(排列組合數) dot(向量內積) seqd(等差等比) mul(兩位數心算) quadroot(解一元二次) frac(分數四則) root(根式化簡) mat2(2×2矩陣)。後四種是 2026-07-09 依歷屆原子運算頻率評選新增。
- 流程：startDrill→drillNext→drillSubmit→drillDone。**達標＝中位數≤目標秒 且 12題全對**（兩條件，drillDone:844 有逐條顯示）。結果頁有：判定(敗在速度or準度的對症處方)、錯題卡、卡頓題(耗時>中位數2倍)、逐題明細、近6輪走勢。

### 4.2 主題刷題（renderQuestion:988 共用單題渲染）
選單元→startPrac→pracNext→renderQuestion→qSubmit→qFinish。每題：碼表+目標時間進度條、手寫計算區(見§4.5)、作答後顯示詳解+快解+過程摘要+回放按鈕。答錯→錯因四分類 chips（概念不熟/計算失誤/看錯題意/用猜的）；對但超時1.5倍→標記進錯題本重練速度。`recordAttempt`(485) 記錄並更新 wrong。

### 4.3 模擬實戰（mock）
buildPaper 抽 12 題（易5中5難2、儘量不同單元）。兩輪作答：第一輪知道第一步就做、不知道按跳過；第二輪處理跳過題。36分倒數。手寫板與其他模式相同（飼主 2026-07-10 指示：加長/復原全模式保留）。作答中不顯示對錯；結算流程＝mockGrade→（有手寫填充）mockJudgePanel→mockFinal，見 §4.5b。

### 4.4 錯題本 + 間隔重測（renderWrong:1267）
Leitner 式：itv 1→3→7→14 天。`reviewResult`(499)：對了升級間隔、連對四次(itv>14)畢業移除；錯了打回 itv=1。`dueWrong`(512) 取今天到期題。到期題投報率標為刷新題3倍。訂正標準卡（林岳版：說得出關鍵條件→工具→第一步才算訂正完）。

### 4.5 手寫系統（ink，2026-07-10 大改版）★特色功能
**三個書寫面**：題目畫記層 `#qink-cv`（絕對定位蓋在 .qwrap 上）、計算區 `#ink-cv`、答案區 `#ans-cv`。`sessionInk[qid] = { s:計算筆畫, e:塗改時間, q:題目畫記, a:答案筆畫 }`，每筆 `{t0,t1,c(顏色鍵),pts}`。
- **輸入原則（防誤觸核心）**：三面全部 `touch-action:none`；pointerType `touch` 完全不畫線（手掌怎麼靠都安全），**兩指**手勢＝捲動（計算區捲 .ink-scroll、其他捲頁面）；只有 pen/mouse 畫線。已無「手指」勾選。
- **工具**：黑/紅/綠三色（`INK_COLORS`，預設黑）＋復原(inkUndo，跨三面砍最後一筆)＋加長(inkExtend，僅計算區)。**無橡皮擦**（全模式，含模擬——考場沒有橡皮擦，寫錯劃掉）。筆寬 `INK_W=1.35`。
- **偵測**：起筆猶豫(fi)、題中停頓(hes,≥15s)、塗改(era)、尾段(tail)——inkStop 只統計計算區(s)。
- **時間提醒**：只在「該題目標時間點」由 ticker 觸發 `flashOnce` 一次（頁面 `#q-flash`），無其他警示（inkWatch 已刪）。
- **回放** inkReplay（計算區）；**截圖** inkCapture(qid,'s'|'a')→裁切白底 PNG base64（給 AI 批改與批改面板縮圖）。
- **雲端**：syncInk 上傳完整 `{s,e,q,a}` 到 ink_sessions.strokes，proc 欄夾帶 `{mode, ok, ai}`＋過程指標；速訓也上傳（qid 格式 `drill:<key>:<t0>`）。

### 4.5b 手寫作答與 AI 批改（免鍵盤）
填充/數值題不再用鍵盤：**答案區手寫 → 按「✅ 算完了」**。
- 有 Anthropic API key（存 localStorage `mathA13_aikey`，數據頁 aiCard 設定，絕不進雲端/備份）→ `aiGradeCall` 直連 API（`anthropic-dangerous-direct-browser-access`，模型預設 claude-sonnet-5）傳答案區＋計算區 PNG，回 JSON `{read,correct,firstError,praise,habit}`；判定可人工改判。等價形式（多根順序不同/未化簡/x= 前綴）算對、座標有序對不可交換。**該題若有老師蒸餾解法（S.teach，279 題），prompt 會一併夾帶老師的教法與口訣，AI 指錯時優先對照老師路線**。
- 老師蒸餾整合共四點：首頁 teachProfileCard、詳解區 teachBlock（老師這樣教＋口訣＋黑板答案）、AI 批改 prompt、**老師方法庫（概念洞 UI）**。前三者資料在雲端 app_state（teachProfile＋teach 279 題，2026-07-10 驗證 205 對 extbank／74 對內建、零孤兒）。
- **老師方法庫（1662 條）**：獨立雲端表 `teacher_methods`（schema.sql；RLS owner-only），資料用 `supabase/upload_methodlib.py` 灌入（源檔在 E:\ 備份）。app 端 `loadMethodLib()` 分頁抓＋localStorage 快取（`mathA13_mlib_v1`，之後離線可看）；UI 進入點：①每題詳解區「調出老師方法庫：單元」按鈕 ②錯題本頁 mlibCard（14 單元 chips）③數據頁「概念不熟」處方指路。渲染一律 escH（方法文字含 < 符號）。
- **AI key 跨裝置**：存 `S.aikey`（＋`aikeyTs`）→ 隨 app_state 雲端同步到所有裝置；mergeState 以 aikeyTs 較新者勝；boot 時 aiKeyMigrate() 把舊版 localStorage key 搬進 S。離線 artifact 版仍僅本機。
- **所有動作按鈕（算完了/下一題/✓✗/送出/開始…）一律置右**（`.actr` flex 容器；飼主右撇子）。選項按鈕維持全寬。
- 沒 key → 顯示正解自評（✓我對了/✗我錯了），一樣免鍵盤。「改用打字（選用）」摺疊輸入框保留給桌機。
- 模擬實戰：作答中不對答案，`mockAns` 存 `{type:'inkfill'}`；結算時進 **批改面板 mockJudgePanel**（縮圖＋正解＋✓/✗，有 key 時 AI 先批＋標出「從哪一步開始錯」）→ mockFinal。
- 單題 ≥6 分鐘按送出時會先問「是否中途離開」，選「有離開」該筆完全不入紀錄（prac 丟棄、mock 排除該題），避免污染數據。
- 中途退出（✕ 或切頁籤）走 `exitFlow` modal：mock 可「保留已作答結算離開」（partial，不 push S.mocks）；prac/review 可「不保留」回滾（snapSession/rollbackSession 還原 attempts 長度與 wrong）。
- **稱讚引擎 praiseFor**：只講有依據的（曾錯今對/★★★拿下/破個人最速/目標內完成），刷題逐題顯示、模擬結果逐題列「先說做得好的」。

### 4.5c 手機專區／一鍵今日菜單／每日投入（2026-07-10 新增）
- **📱 手機專區（renderPhone）**：零碎時間全按鈕作答（不手寫不打字）。三模式：⚡心算快答（DRILLS 生成器 + `optionize()` 自動把數值答案變 4 選 1，12 題連發）、🧠公式必背卡（`FLASH` 常數 66 張：學測數A必背公式/定理/幾何原則，翻面自評記得/忘了）、🧑‍🏫老師口訣卡（methodlib 的 mnemonic 動態成卡，1500+ 條）。卡片記憶 `S.phone.cards`（忘過的權重高、優先再抽）；每日彙總 `S.phone.days`、輪次 `S.phone.hist`——都在 S 內隨 app_state 上雲，mergeState 有專屬合併（days 取大、hist 聯集、cards 取 seen 多者）。
- **▶ 一鍵今日菜單（startDaily/dailyNext/dailyBanner）**：自動排程 速訓（dailyPick 挑沒練過→未達標→達標最久）→ 清到期錯題 → startPracAuto 刷 8 題（自動挑答對率最低/耗時比最高的 3 單元），每段完成畫面出接力橫幅、自動打勾 S.daily（drill/wrongq/prac/log）。中途退出（endSession）即取消接力。入口：首頁 todayCard 與作戰計畫頁。
- **📈 每日投入（dayAgg/dailyChartSVG/dailyCard/todayCard）**：dayAgg 彙總 attempts＋drills（12題/輪估算）＋phone；14 天題數長條＋答對率點線（單色 #0d9488，過 dataviz palette 驗證；同 x 軸兩張小圖，不做雙軸）、🔥連續天數（今天沒練不斷 streak、從昨天回數）、週對比、每日目標 `DAY_GOAL=30` 進度條（首頁也有一份迷你卡）。鼓勵語只在有真實依據時出現（連續≥3天/破紀錄/週增長/差幾題超車）。

### 4.6 數據診斷（renderStats:1322）
單元答對率+速度比(實際耗時÷目標)橫條、錯因分布→對症處方、速度特訓進度、模擬走勢、**過程診斷卡**(起筆/停頓/塗改/最嚴重卡點Top3)、雲端同步卡、備份卡。worst 單元＝答對率最低/耗時比最高→「本週優先攻擊」。

### 4.7 級分換算（GRADE_TABLE bank.js:504, gradeOf app.js:474）
依 113~115 官方級距平均：15級≥84%、14級≥78%、13級🎯≥72%、12級≥66%…9級≥48%。目標雙線制 73%保底13級/80%攻14級。

## 5. 雲端同步（Supabase，app.js:1466~1610）

**離線優先**：沒登入/沒網路一切照常存 localStorage。登入後：
- `save()`→`syncQueue()`(1486) debounce 4秒→`syncPush()`(1514) upsert 整包 S 到 app_state 表
- 登入時 `syncPull()`(1524) 下載雲端 S、用 `mergeState`(1539) 與本機合併（attempts/mocks/drills 聯集、extbank 聯集，不丟資料）→ applyExtBank
- 手寫筆跡逐題 `syncInk`(1567) insert 到 ink_sessions 表（永久歸檔）
- `syncPill`(1492) 右上角常駐狀態燈（🟢已同步/🔴未登入/⚫離線版）；`syncGate`(1505) 開始做題前若未登入攔下來問
- 切分頁/斷網重連時強制補傳（supaInit 的事件監聽）
- **artifact 環境**（claude.ai）CSP 擋外部連線→ supa=null→ 自動降級純本機模式（syncCard 顯示提示）
- 後端細節（帳號、RLS、schema）見 memory `matha-supabase-backend` 與 OPERATIONS.md §二

## 6. 修改與部署

### 改碼流程
1. 在 worktree 改 app.js/bank.js/style.css
2. `node --check app.js && node --check bank.js` 語法檢查
3. preview 驗證：launch.json 有 `matha-static`（port 8737，用 scratchpad 的 serve.js 靜態服務）。preview_start→在瀏覽器實跑→改完 preview_stop
4. `git add … && git commit && git push origin claude/math-exam-prep-7c2pg4`

### 部署三處（順序固定，見 OPERATIONS.md §二）
1. worktree 分支（開發）
2. **matha13 公開 repo → GitHub Pages**（正式站，使用者主入口 https://yen-2cats.github.io/matha13/）：`cp index.html style.css bank.js app.js README.md C:/Users/yenke/desktop/matha13/` → 那邊 commit push → Pages 約40秒生效
3. **artifact 離線備用版**：把 style.css/bank.js/app.js 內嵌成單一 HTML（結構見 OPERATIONS.md §二.3）→ Artifact 工具、favicon 📐、url ee29beef-8400-420d-b68a-a4f6ab489b21

### 測試手法（血淚）
- 背景分頁會節流 setTimeout（自動跳題的500ms變分鐘級）→ 測試時攔截 setTimeout 同步驅動，或保持分頁前景
- 大量互動測試前先 location.reload() 清掉殘留的計時器/session 狀態
- ink 相關測試用 PointerEvent 派發（pointerType:'mouse' 可繞過手掌防誤觸）

## 7. 設計決策（別重新翻案，見 OPERATIONS.md §五）
- 純 vanilla JS 無 build：使用者要能直接開檔、artifact 要能單檔內嵌、降低維護面
- 離線優先 + 雲端鏡像：考生不能因網路斷就不能練
- **白底、全模式同一套手寫工具、無橡皮擦**（2026-07-10 飼主核定，取代舊的「診斷/考場雙模式」設計）：模擬真實考卷、寫錯劃掉
- **作答免鍵盤**：手寫答案區＋「算完了」＋ AI 批改/自評；時間警示只在目標時間點一次（飼主明確要求，勿加回疲勞轟炸式警示）
- 達標雙條件(速度+準度)：手比腦快的錯比慢更貴
- 目標雙線制 73%/80%、檢查15~20分、90秒停損：見 README §五外部核對

## 8. 已知待辦（app 端）
- extbank 破千前把外部題庫從 app_state 搬獨立資料表（每次同步上傳好幾MB會撞瀏覽器上限）
- 需圖的題（needsFigure）目前略過，未來補 SVG 版
- 老師蒸餾的 sol/tip 回寫（見 OPERATIONS.md §3.5）：enrichment 注入雲端 extbank 對應題；教學風格檔案與按單元方法庫要決定存哪（app_state 新欄位 or 獨立結構）+ 做 UI 在錯題/概念洞時調出老師方法
