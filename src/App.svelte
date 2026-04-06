<script lang="ts">
  import CreateRoom from './components/lobby/CreateRoom.svelte';
  import JoinRoom from './components/lobby/JoinRoom.svelte';
  import RockPaperScissors from './components/rps/RockPaperScissors.svelte';
  import GameBoard from './components/game/GameBoard.svelte';
  import DiceSelector from './components/selection/DiceSelector.svelte';
  import DraftSelector from './components/selection/DraftSelector.svelte';
  import { appView, gameState, myRole, floatingScore, triggerCommentary, celebrationLevel } from '$lib/stores/gameStore';
  import type { AppView } from '$lib/stores/gameStore';
  import { getRoomCodeFromUrl } from '$lib/network/trystero';

  // 检查 URL 是否携带房间码（受邀加入）
  const urlRoomCode = getRoomCodeFromUrl();
  let lobbyMode = $state<'choose' | 'create' | 'join'>(urlRoomCode ? 'join' : 'choose');

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
    };
    console.info('%c[Farkle Debug] 调试接口已挂载到 window.__farkle', 'color:#d4a843;font-weight:bold');
    console.info('  __farkle.float(500)            → 触发飘字动画');
    console.info('  __farkle.comment("bust")       → 触发旁白（爆点）');
    console.info('  __farkle.comment("score_1000") → 触发旁白（1000分）');
    console.info('  __farkle.comment("hot_dice")   → 触发旁白（满盘）');
    console.info('  __farkle.celebrate(1)          → 小粒子（8枚金币）');
    console.info('  __farkle.celebrate(2)          → 中粒子（金币+骰子）');
    console.info('  __farkle.celebrate(3)          → 大粒子+屏缘金光）');
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
        </div>
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

  {:else if view === 'rps'}
    <RockPaperScissors />

  {:else if view === 'dice_selection'}
    {#if selectionMode === 'draft'}
      <DraftSelector />
    {:else}
      <DiceSelector />
    {/if}

  {:else if view === 'game'}
    <GameBoard />
  {/if}
</main>

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
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
    padding: 1rem;
    gap: 1rem;
  }

  .title {
    font-size: 2.5rem;
    color: #d4a843;
    text-shadow: 0 0 28px rgba(212, 168, 67, 0.4), 0 2px 8px rgba(0, 0, 0, 0.9);
    margin-bottom: 0;
    letter-spacing: 0.06em;
  }

  .subtitle {
    color: #8a7a5a;
    font-size: 1rem;
    margin-bottom: 0;
  }

  .lobby-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    width: 100%;
  }

  .btn-primary {
    background: #d4a843;
    color: #1a1008;
    border: none;
    border-radius: 8px;
    padding: 0.85rem 1.5rem;
    font-size: 1.1rem;
    font-weight: bold;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-primary:hover {
    background: #e8bf5a;
  }

  .btn-secondary {
    background: transparent;
    color: #d4a843;
    border: 2px solid #5a4a2a;
    border-radius: 8px;
    padding: 0.85rem 1.5rem;
    font-size: 1.1rem;
    font-weight: bold;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .btn-secondary:hover {
    border-color: #d4a843;
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
    background: rgba(18, 11, 3, 0.88);
    border: 1px solid #4a3820;
    border-radius: 12px;
    padding: 1.5rem;
    width: 100%;
    max-width: 320px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(212, 168, 67, 0.07);
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

  :global(.btn-primary:active),
  :global(.btn-secondary:active) {
    transform: translateY(1px);
    filter: brightness(0.95);
  }
</style>
