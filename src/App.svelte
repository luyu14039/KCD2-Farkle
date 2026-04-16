<script lang="ts">
  import { fade } from 'svelte/transition';
  import CreateRoom from './components/lobby/CreateRoom.svelte';
  import JoinRoom from './components/lobby/JoinRoom.svelte';
  import RockPaperScissors from './components/rps/RockPaperScissors.svelte';
  import GameBoard from './components/game/GameBoard.svelte';
  import DiceSelector from './components/selection/DiceSelector.svelte';
  import DraftSelector from './components/selection/DraftSelector.svelte';
  import RulesModal from './components/overlay/RulesModal.svelte';
  import { appView, gameState, myRole, floatingScore, triggerCommentary, celebrationLevel, awaitingRoll } from '$lib/stores/gameStore';
  import type { AppView } from '$lib/stores/gameStore';
  import { getRoomCodeFromUrl } from '$lib/network/trystero';

  // 检查 URL 是否携带房间码（受邀加入）
  const urlRoomCode = getRoomCodeFromUrl();
  let lobbyMode = $state<'choose' | 'create' | 'join'>(urlRoomCode ? 'join' : 'choose');
  let showRulesLobby = $state(false);

  // 开屏提示：仅在首次访问时弹出（localStorage 标记）
  const NOTICE_KEY = 'farkle_notice_v1';
  let showNotice = $state(
    typeof localStorage !== 'undefined' && !localStorage.getItem(NOTICE_KEY)
  );
  function dismissNotice() {
    localStorage.setItem(NOTICE_KEY, '1');
    showNotice = false;
  }

  let view = $state<AppView>('lobby');
  appView.subscribe(v => { view = v; if (v === 'lobby') lobbyMode = 'choose'; });
  let selectionMode = $state<'free' | 'draft'>('free');
  gameState.subscribe(s => { selectionMode = s.config.selectionMode; });

  // ── 调试接口（浏览器控制台可用） ──────────────────
  // 用法：打开 DevTools Console，输入以下命令：
  //   __farkle.float(500)      → 触发飘字动画，数值可自定义
  //   __farkle.float()         → 默认触发 +350
  if (typeof window !== 'undefined') {
    (window as any).__farkle = {
      /** 触发得分飘字动画: __farkle.float(500) */
      float: (value = 350) => {
        floatingScore.set({ value, key: Date.now() });
        console.info(`[Farkle Debug] float triggered: +${value}`);
      },
      /** 触发旁白消息: __farkle.comment('bust') */
      /** 可用事件: bust / hot_dice / score_500 / score_1000 / bank_500 / bank_1000 / straight */
      comment: (event = 'score_500') => {
        triggerCommentary(event);
        console.info(`[Farkle Debug] commentary triggered: ${event}`);
      },
      /** 触发粒子庆祝: __farkle.celebrate(3) — level 1/2/3 */
      celebrate: (level: 1 | 2 | 3 = 2) => {
        celebrationLevel.set(level);
        console.info(`[Farkle Debug] celebration level ${level} triggered`);
      },
      /**
       * 模拟满盘(Hot Dice)局面，用于调试重投流程。
       * __farkle.hotDice()           → 以 host 身份、350 回合积分触发满盘
       * __farkle.hotDice(800, 'guest') → 以 guest 身份、800 分触发满盘
       */
      hotDice: (turnScore = 350, asRole: 'host' | 'guest' = 'host') => {
        myRole.set(asRole);
        appView.set('game');
        gameState.update(s => ({
          ...s,
          phase: 'hot_dice',
          currentPlayerIndex: asRole === 'host' ? 0 : 1,
          turnScore,
          rollCount: 1,
          dice: s.dice.map(d => ({ ...d, kept: true, active: true })),
        }));
        awaitingRoll.set(true);
        console.info(`[Farkle Debug] hotDice triggered: asRole=${asRole}, turnScore=${turnScore}`);
        console.info('[Farkle Debug] → 点击「🔥 满盘！重新掷全部骰子」继续测试重投流程');
      },
      /** 模拟游戏结束: __farkle.gameOver('host') or __farkle.gameOver('guest', 'guest') */
      gameOver: (winner: 'host' | 'guest' = 'host', asRole?: 'host' | 'guest') => {
        if (asRole) myRole.set(asRole);
        appView.set('game');
        gameState.update(s => ({
          ...s,
          phase: 'game_over',
          winner,
          players: [
            { ...s.players[0], totalScore: winner === 'host' ? 4200 : 1800 },
            { ...s.players[1], totalScore: winner === 'guest' ? 4100 : 2300 },
          ],
        }));
        setTimeout(() => celebrationLevel.set(3), 300);
        console.info(`[Farkle Debug] game over: winner=${winner}, asRole=${asRole ?? 'unchanged'}`);
      },
      /**
       * 展示得分面板（直接跳转游戏视图）。
       * __farkle.scorePanel()                    → host 900＋guest 2400，当前回合 host
       * __farkle.scorePanel(1800, 3200, 'guest') → 自定义得分 + 当前回合 guest
       */
      scorePanel: (hostTotal = 900, guestTotal = 2400, active: 'host' | 'guest' = 'host', asRole: 'host' | 'guest' = 'host') => {
        myRole.set(asRole);
        appView.set('game');
        gameState.update(s => ({
          ...s,
          phase: 'rolling',
          currentPlayerIndex: active === 'host' ? 0 : 1,
          turnScore: 350,
          rollCount: 1,
          players: [
            { ...s.players[0], name: '房主', totalScore: hostTotal },
            { ...s.players[1], name: '客人', totalScore: guestTotal },
          ],
        }));
        console.info(`[Farkle Debug] scorePanel: host=${hostTotal}, guest=${guestTotal}, active=${active}, asRole=${asRole}`);
      },
    };
    console.info('%c[Farkle Debug] 调试接口已挂载到 window.__farkle', 'color:#d4a843;font-weight:bold');
    console.info('  __farkle.float(500)            → 触发飘字动画');
    console.info('  __farkle.comment("bust")       → 触发旁白（爆点）');
    console.info('  __farkle.comment("score_1000") → 触发旁白（1000分）');
    console.info('  __farkle.comment("hot_dice")   → 触发旁白（满盘）');
    console.info('  __farkle.celebrate(1)          → 小粒子（8枚金币）');
    console.info('  __farkle.celebrate(2)          → 中粒子（金币+骰子）');
    console.info('  __farkle.celebrate(3)          → 大粒子+屏缘金光）');
    console.info('  __farkle.hotDice()             → 满盘局面（host，350分）');
    console.info('  __farkle.hotDice(800, "guest") → 满盘局面（guest，800分）');
    console.info('  __farkle.scorePanel()          → 展示得分面板（host 900 vs guest 2400）');
    console.info('  __farkle.scorePanel(1800,3200,"guest","guest") → 自定义得分');
  }
</script>

{#if view === 'lobby'}
  <div class="bg-deco" aria-hidden="true">
    <span class="bg-elem" style="--r: 15deg; --x: 14%; --y: 62%">🎲</span>
    <span class="bg-elem" style="--r: -28deg; --x: 76%; --y: 58%">🎲</span>
    <span class="bg-elem" style="--r: 42deg; --x: 60%; --y: 78%">⚔️</span>
  </div>
{/if}

<main class="app">
  {#if view === 'lobby'}
    <div transition:fade={{ duration: 200 }} class="view-wrapper">
    <h1 class="title">KCD2 Farkle</h1>
    <p class="subtitle">天国拯救2 · 骰子酒馆桌游</p>
    <div class="divider" aria-hidden="true">
      <span class="divider-line"></span>
      <span class="divider-icon">⚜</span>
      <span class="divider-line"></span>
    </div>

    {#if lobbyMode === 'choose'}
      <div class="card-panel">
        <div class="lobby-buttons">
          <button class="btn-primary" onclick={() => lobbyMode = 'create'}>
            创建房间
          </button>
          <button class="btn-secondary" onclick={() => lobbyMode = 'join'}>
            加入房间
          </button>
          <button class="btn-rules-lobby" onclick={() => showRulesLobby = true}>
            📜 游戏规则
          </button>
        </div>
      </div>

      <a
        class="star-banner"
        href="https://github.com/luyu14039/KCD2-Farkle"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span class="star-icon">★</span>
        如果喜欢这个项目，请在 GitHub 给我一个 Star ！
        <span class="star-icon">★</span>
      </a>

      <!-- 作者其他项目 -->
      <div class="other-projects">
        <div class="op-header">
          <span class="op-line"></span>
          <span class="op-title">作者的其他项目</span>
          <span class="op-line"></span>
        </div>

        <p class="op-subtitle">🕯️ 密教模拟器 / 司辰之书 同人二创系列</p>
        <div class="op-grid">
          <a class="op-card" href="https://github.com/luyu14039/Which-hour-will-you-serve" target="_blank" rel="noopener noreferrer">
            <span class="op-card-name">漫宿回响</span>
            <span class="op-card-desc">人格测试：寻觅你命定的司辰</span>
          </a>
          <a class="op-card" href="https://github.com/luyu14039/pale-notes" target="_blank" rel="noopener noreferrer">
            <span class="op-card-name">苍白卷宗</span>
            <span class="op-card-desc">AI 驱动文字 RPG · 1900 年代伦敦防剿局探员</span>
          </a>
          <a class="op-card" href="https://github.com/luyu14039/tarot-but-hours" target="_blank" rel="noopener noreferrer">
            <span class="op-card-name">司辰塔罗</span>
            <span class="op-card-desc">沉浸式塔罗占卜 · AI 守密人亲自解读命运</span>
          </a>
          <a class="op-card" href="https://github.com/luyu14039/Hush-House" target="_blank" rel="noopener noreferrer">
            <span class="op-card-name">噤声书屋</span>
            <span class="op-card-desc">游戏文本可视化知识图谱与互动阅读室</span>
          </a>
        </div>

        <a class="op-card op-card-wide" href="https://github.com/luyu14039/lovers-notebook" target="_blank" rel="noopener noreferrer">
          <span class="op-card-name">💑 恋爱小本本</span>
          <span class="op-card-desc">专为情侣设计的「相爱相杀」记录 App · 记仇 / 甜蜜回忆双系统 · 支持 Android</span>
        </a>
      </div>

    {:else if lobbyMode === 'create'}
      <div class="lobby-view">
        <button class="btn-back" onclick={() => lobbyMode = 'choose'}>返回</button>
        <CreateRoom />
      </div>

    {:else if lobbyMode === 'join'}
      <div class="lobby-view">
        {#if !urlRoomCode}
          <button class="btn-back" onclick={() => lobbyMode = 'choose'}>返回</button>
        {/if}
        <JoinRoom initialCode={urlRoomCode ?? ''} />
      </div>
    {/if}
  </div>

  {:else if view === 'rps'}
    <div transition:fade={{ duration: 200 }} class="view-wrapper">
      <RockPaperScissors />
    </div>

  {:else if view === 'dice_selection'}
    <div transition:fade={{ duration: 200 }} class="view-wrapper">
      {#if selectionMode === 'draft'}
        <DraftSelector />
      {:else}
        <DiceSelector />
      {/if}
    </div>

  {:else if view === 'game'}
    <div transition:fade={{ duration: 200 }} class="view-wrapper">
      <GameBoard />
    </div>
  {/if}
</main>

{#if showRulesLobby}
  <RulesModal onClose={() => showRulesLobby = false} />
{/if}

{#if showNotice}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="notice-backdrop" onclick={dismissNotice} role="dialog" aria-modal="true" aria-label="访问提示" tabindex="-1">
    <div class="notice-panel" role="presentation" onclick={(e) => e.stopPropagation()}>
      <div class="notice-header">
        <span class="notice-icon">📡</span>
        <h2 class="notice-title">联机提示</h2>
      </div>
      <div class="notice-body">
        <p>本项目采用 <strong>P2P 点对点</strong>方式联机，无中继服务器。</p>
        <p>⚠️ <strong>不推荐</strong>使用手机自带浏览器访问，P2P 连接成功率较低。</p>
        <p>✅ 推荐使用 <strong>Via 浏览器</strong> 或其他基于 Chromium 的轻量浏览器，以获得更稳定的连接体验。</p>
      </div>
      <div class="notice-footer">
        <label class="notice-check">
          <input type="checkbox" onchange={(e) => { if ((e.target as HTMLInputElement).checked) localStorage.setItem(NOTICE_KEY, '1'); else localStorage.removeItem(NOTICE_KEY); }} />
          不再提示
        </label>
        <button class="notice-btn" onclick={dismissNotice}>我知道了</button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    background: #1a1008;
    background-image: url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 20 L20 0 L40 20 L20 40 Z' fill='none' stroke='%238a6020' stroke-width='0.8' opacity='0.07'/%3E%3C/svg%3E");
    color: #f0e6c8;
    font-family: 'Georgia', serif;
    min-height: 100dvh;
  }

  :global(::selection) {
    background: rgba(212, 168, 67, 0.35);
    color: #f0e6c8;
  }

  .app {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    animation: page-enter 0.55s ease-out;
  }

  .view-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
    padding: 1rem;
    gap: 1rem;
    width: 100%;
  }

  .app::before {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background: radial-gradient(
      ellipse 80% 70% at 50% 50%,
      transparent 30%,
      rgba(5, 2, 0, 0.45) 100%
    );
  }

  @keyframes page-enter {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .title {
    font-size: 2.5rem;
    color: #d4a843;
    text-shadow: 0 0 28px rgba(212, 168, 67, 0.4), 0 2px 8px rgba(0, 0, 0, 0.9);
    margin-bottom: 0;
    letter-spacing: 0.1em;
    animation: shimmer-gold 8s ease-in-out infinite;
  }

  @keyframes shimmer-gold {
    0%, 100% { text-shadow: 0 0 28px rgba(212, 168, 67, 0.4), 0 2px 8px rgba(0,0,0,0.9); }
    50%       { text-shadow: 0 0 44px rgba(212, 168, 67, 0.72), 0 0 18px rgba(212,168,67,0.28), 0 2px 8px rgba(0,0,0,0.9); }
  }

  .subtitle {
    color: #9a8a68;
    font-size: 1rem;
    margin-bottom: 0;
    letter-spacing: 0.04em;
  }

  .lobby-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    width: 100%;
  }

  .btn-primary {
    background: linear-gradient(160deg, #e0b84a 0%, #a07820 100%);
    color: #1a1008;
    border: 1px solid #c89028;
    border-radius: 8px;
    padding: 0.85rem 1.5rem;
    font-size: 1.1rem;
    font-weight: bold;
    font-family: inherit;
    cursor: pointer;
    box-shadow:
      inset 0 1px 0 rgba(255, 220, 100, 0.35),
      0 4px 14px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(212, 168, 67, 0.18);
    transition: transform 0.1s, filter 0.15s, box-shadow 0.15s;
  }

  .btn-primary:hover {
    filter: brightness(1.1);
    transform: scale(1.02);
    box-shadow:
      inset 0 1px 0 rgba(255, 220, 100, 0.4),
      0 6px 20px rgba(0, 0, 0, 0.6),
      0 0 0 1px rgba(212, 168, 67, 0.3);
  }

  .btn-secondary {
    background: rgba(30, 20, 8, 0.65);
    color: #d4a843;
    border: 1px solid rgba(212, 168, 67, 0.3);
    border-radius: 8px;
    padding: 0.85rem 1.5rem;
    font-size: 1.1rem;
    font-weight: bold;
    font-family: inherit;
    cursor: pointer;
    box-shadow:
      inset 0 1px 0 rgba(255, 220, 100, 0.07),
      0 3px 10px rgba(0, 0, 0, 0.4);
    transition: transform 0.1s, filter 0.15s, border-color 0.15s, background 0.15s;
  }

  .btn-secondary:hover {
    border-color: #d4a843;
    background: rgba(212, 168, 67, 0.08);
    transform: scale(1.01);
  }

  .btn-rules-lobby {
    background: transparent;
    color: #9a8a6a;
    border: 1px solid #4a3820;
    border-radius: 8px;
    padding: 0.65rem 1.2rem;
    font-size: 0.95rem;
    font-family: inherit;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    align-self: stretch;
  }

  .btn-rules-lobby:hover {
    color: #d4a843;
    border-color: #7a6a4a;
  }

  /* ── 开屏提示弹窗 ── */
  .notice-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 3, 1, 0.82);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 500;
    backdrop-filter: blur(4px);
    padding: 1rem;
  }

  .notice-panel {
    background: linear-gradient(160deg, #231a09 0%, #1a1206 100%);
    border: 1.5px solid #7a5a1a;
    border-radius: 14px;
    width: 100%;
    max-width: 400px;
    box-shadow:
      0 0 0 1px rgba(212, 168, 67, 0.12),
      0 16px 56px rgba(0, 0, 0, 0.8),
      inset 0 1px 0 rgba(212, 168, 67, 0.12);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .notice-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 1rem 1.2rem 0.85rem;
    border-bottom: 1px solid #3a2a10;
  }

  .notice-icon {
    font-size: 1.3rem;
    line-height: 1;
  }

  .notice-title {
    margin: 0;
    font-size: 1.05rem;
    color: #e8d8a0;
    font-weight: bold;
    letter-spacing: 0.05em;
  }

  .notice-body {
    padding: 1rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .notice-body p {
    margin: 0;
    font-size: 0.88rem;
    color: #c8b888;
    line-height: 1.6;
  }

  .notice-body strong {
    color: #e8d8a0;
  }

  .notice-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.2rem 1rem;
    border-top: 1px solid #3a2a10;
    gap: 1rem;
  }

  .notice-check {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.82rem;
    color: #7a6a4a;
    cursor: pointer;
  }

  .notice-check input {
    accent-color: #d4a843;
    cursor: pointer;
  }

  .notice-btn {
    background: linear-gradient(160deg, #c8960a 0%, #a07008 100%);
    border: 1px solid #e8b830;
    border-radius: 8px;
    color: #1a1008;
    font-size: 0.9rem;
    font-weight: 700;
    font-family: inherit;
    padding: 0.5rem 1.2rem;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.1s;
    white-space: nowrap;
  }

  .notice-btn:hover {
    opacity: 0.9;
    transform: scale(1.03);
  }

  .lobby-view {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: 100%;
    max-width: 420px;
  }

  .btn-back {
    background: rgba(58, 46, 26, 0.5);
    border: 1px solid #4a3820;
    border-radius: 20px;
    color: #9a8a6a;
    font-size: 0.88rem;
    cursor: pointer;
    align-self: flex-start;
    padding: 0.35rem 0.9rem 0.35rem 0.6rem;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    transition: border-color 0.2s, color 0.2s, background 0.2s;
    letter-spacing: 0.02em;
  }

  .btn-back::before {
    content: '‹';
    font-size: 1.25em;
    line-height: 1;
    margin-top: -0.05em;
  }

  .btn-back:hover {
    border-color: #d4a843;
    color: #d4a843;
    background: rgba(212, 168, 67, 0.1);
  }

  /* ── 装饰元素 ── */
  .divider {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    max-width: 180px;
  }

  .divider-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(to right, transparent, #5a4a2a, transparent);
  }

  .divider-icon {
    color: #6a5a3a;
    font-size: 0.85rem;
    line-height: 1;
  }

  .card-panel {
    position: relative;
    background: linear-gradient(170deg, #1a1108 0%, #120c04 100%);
    border: 1px solid rgba(212, 168, 67, 0.22);
    border-radius: 12px;
    padding: 1.5rem;
    width: 100%;
    max-width: 320px;
    box-shadow:
      inset 0 1px 0 rgba(212, 168, 67, 0.1),
      inset 0 -1px 0 rgba(0, 0, 0, 0.4),
      0 8px 32px rgba(0, 0, 0, 0.65),
      0 0 0 1px rgba(212, 168, 67, 0.06);
  }

  /* 四角 L 形金色装饰 */
  .card-panel::before,
  .card-panel::after {
    content: '';
    position: absolute;
    width: 12px;
    height: 12px;
    pointer-events: none;
  }

  .card-panel::before {
    top: 6px;
    left: 6px;
    border-top: 1px solid rgba(212, 168, 67, 0.5);
    border-left: 1px solid rgba(212, 168, 67, 0.5);
    border-radius: 2px 0 0 0;
  }

  .card-panel::after {
    bottom: 6px;
    right: 6px;
    border-bottom: 1px solid rgba(212, 168, 67, 0.5);
    border-right: 1px solid rgba(212, 168, 67, 0.5);
    border-radius: 0 0 2px 0;
  }

  .bg-deco {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    overflow: hidden;
  }

  .bg-elem {
    position: absolute;
    font-size: 5rem;
    opacity: 0.04;
    transform: rotate(var(--r, 0deg));
    left: var(--x, 50%);
    top: var(--y, 50%);
    user-select: none;
    line-height: 1;
  }

  :global(.btn-primary:active) {
    transform: scale(0.97) translateY(1px) !important;
    filter: brightness(0.93) !important;
  }

  :global(.btn-secondary:active) {
    transform: translateY(1px);
    filter: brightness(0.95);
  }

  .star-banner {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.2rem;
    padding: 0.5rem 1.1rem;
    border: 1px solid #4a3820;
    border-radius: 20px;
    background: rgba(18, 11, 3, 0.6);
    color: #8a7a5a;
    font-size: 0.82rem;
    text-decoration: none;
    font-family: inherit;
    letter-spacing: 0.02em;
    transition: border-color 0.2s, color 0.2s, background 0.2s;
  }

  .star-banner:hover {
    border-color: #d4a843;
    color: #d4a843;
    background: rgba(212, 168, 67, 0.08);
  }

  .star-icon {
    color: #c8952a;
    font-size: 0.9em;
    transition: color 0.2s;
  }

  .star-banner:hover .star-icon {
    color: #f0c040;
  }

  /* 其他项目卡片区 */
  .other-projects {
    width: 100%;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .op-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.2rem;
  }

  .op-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(to right, transparent, #3a2e1a, transparent);
  }

  .op-title {
    color: #5a4a2a;
    font-size: 0.75rem;
    white-space: nowrap;
    letter-spacing: 0.04em;
  }

  .op-subtitle {
    color: #5a4a2a;
    font-size: 0.72rem;
    text-align: center;
    letter-spacing: 0.02em;
  }

  .op-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.45rem;
  }

  .op-card {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.55rem 0.65rem;
    background: rgba(14, 9, 2, 0.55);
    border: 1px solid #2e2310;
    border-radius: 8px;
    text-decoration: none;
    transition: border-color 0.2s, background 0.2s;
  }

  .op-card:hover {
    border-color: #6a5030;
    background: rgba(30, 20, 5, 0.75);
  }

  .op-card-name {
    color: #b09050;
    font-size: 0.86rem;
    font-weight: bold;
  }

  .op-card-desc {
    color: #6a5a3a;
    font-size: 0.72rem;
    line-height: 1.45;
  }

  .op-card-wide {
    flex-direction: row;
    align-items: center;
    gap: 0.6rem;
  }

  .op-card-wide .op-card-name {
    white-space: nowrap;
  }

  .op-card-wide .op-card-desc {
    flex: 1;
  }
</style>
