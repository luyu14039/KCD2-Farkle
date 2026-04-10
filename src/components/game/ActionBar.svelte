<script lang="ts">
  import {
    gameState, isMyTurn, selectionScore, selectedDieIds, awaitingRoll,
    performRoll, confirmSelection, bankScore, handleHotDice,
    isOpponentDisconnected,
  } from '$lib/stores/gameStore';

  let myTurn = $state(false);
  let phase = $state('selecting');
  let rollCount = $state(0);
  let selection = $state({ valid: false, score: 0 });
  let hasSelection = $state(false);
  let turnScoreVal = $state(0);
  let needsRoll = $state(true);
  let opponentOffline = $state(false);

  isMyTurn.subscribe(v => { myTurn = v; });
  gameState.subscribe($s => {
    phase = $s.phase;
    rollCount = $s.rollCount;
    turnScoreVal = $s.turnScore;
  });
  selectionScore.subscribe(v => { selection = v; });
  selectedDieIds.subscribe(ids => { hasSelection = ids.length > 0; });
  awaitingRoll.subscribe(v => { needsRoll = v; });
  isOpponentDisconnected.subscribe(v => { opponentOffline = v; });

  // 可以掷骰：回合开始时 / 锁定骰子后
  const canRoll = $derived(
    myTurn && phase === 'selecting' && needsRoll && !hasSelection && !opponentOffline
  );
  // 可以锁定：刚掷完骰且选择了有效骰子
  const canConfirm = $derived(
    myTurn && phase === 'selecting' && !needsRoll && hasSelection && selection.valid && !opponentOffline
  );
  // 可以结算：锁定后（已有累积分）
  const canBank = $derived(
    myTurn && phase === 'selecting' && needsRoll && turnScoreVal > 0 && !opponentOffline
  );
  const isHotDice = $derived(phase === 'hot_dice');
</script>

<div class="action-bar">
  {#if phase === 'bust'}
    <div class="bust-message">
      <span class="bust-icon">💥</span>
      爆点！分数清零！
    </div>

  {:else if phase === 'game_over'}
    <div class="game-over">
      游戏结束！
    </div>

  {:else if !myTurn}
    <div class="waiting-turn">
      等待对手操作…
    </div>

  {:else if isHotDice}
    <button class="btn-action btn-hot" onclick={handleHotDice} disabled={opponentOffline}>
      🔥 满盘！重新掷全部骰子
    </button>

  {:else}
    <div class="buttons">
      <button
        class="btn-action btn-roll"
        onclick={performRoll}
        disabled={!canRoll}
      >
        🎲 掷骰子
        {#if rollCount === 0}
          <span class="sub">（首掷）</span>
        {/if}
      </button>

      {#if hasSelection}
        <button
          class="btn-action btn-confirm"
          onclick={confirmSelection}
          disabled={!canConfirm}
        >
          ✅ 锁定
          {#if selection.valid}
            <span class="score-preview">+{selection.score}</span>
          {/if}
        </button>
      {/if}

      {#if canBank}
        <button
          class="btn-action btn-bank"
          onclick={bankScore}
        >
          💰 结算 (+{turnScoreVal})
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .action-bar {
    display: flex;
    justify-content: center;
    padding: 1rem;
    width: 100%;
    max-width: 600px;
  }

  .buttons {
    display: flex;
    gap: 0.9rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  /* ── 通用按钮基础 ─────────────────────────────── */
  .btn-action {
    border-radius: 12px;
    padding: 0.85rem 1.8rem;
    font-size: 1rem;
    font-weight: bold;
    font-family: inherit;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition:
      transform 0.1s ease,
      filter 0.15s ease,
      box-shadow 0.15s ease;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    /* 浮雕感：上边缘亮线 + 下方阴影 */
    border: none;
    position: relative;
  }

  .btn-action:hover:not(:disabled) {
    transform: scale(1.04);
    filter: brightness(1.12);
  }

  .btn-action:active:not(:disabled) {
    transform: scale(0.97) translateY(1px);
    filter: brightness(0.95);
  }

  .btn-action:disabled {
    opacity: 0.28;
    cursor: not-allowed;
    filter: grayscale(30%);
    box-shadow: none !important;
  }

  /* ── 掷骰（金色） ──────────────────────────────── */
  .btn-roll {
    background: linear-gradient(160deg, #e8bf5a 0%, #c89030 55%, #a87020 100%);
    color: #1a0e05;
    border: 1px solid #b87828;
    box-shadow:
      inset 0 1px 0 rgba(255, 230, 130, 0.45),
      inset 0 -1px 0 rgba(0, 0, 0, 0.25),
      0 4px 16px rgba(212, 168, 67, 0.35),
      0 2px 4px rgba(0, 0, 0, 0.4);
    text-shadow: 0 1px 0 rgba(255, 220, 100, 0.3);
  }

  .btn-roll:hover:not(:disabled) {
    box-shadow:
      inset 0 1px 0 rgba(255, 230, 130, 0.45),
      inset 0 -1px 0 rgba(0, 0, 0, 0.25),
      0 6px 22px rgba(212, 168, 67, 0.55),
      0 2px 6px rgba(0, 0, 0, 0.4);
  }

  /* ── 锁定（翡翠绿） ────────────────────────────── */
  .btn-confirm {
    background: linear-gradient(160deg, #2ecc71 0%, #1ea855 55%, #167a3e 100%);
    color: #fff;
    border: 1px solid #158a40;
    box-shadow:
      inset 0 1px 0 rgba(100, 255, 160, 0.3),
      inset 0 -1px 0 rgba(0, 0, 0, 0.2),
      0 4px 16px rgba(39, 174, 96, 0.3),
      0 2px 4px rgba(0, 0, 0, 0.35);
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.25);
  }

  .btn-confirm:hover:not(:disabled) {
    box-shadow:
      inset 0 1px 0 rgba(100, 255, 160, 0.3),
      inset 0 -1px 0 rgba(0, 0, 0, 0.2),
      0 6px 22px rgba(39, 174, 96, 0.5),
      0 2px 6px rgba(0, 0, 0, 0.35);
  }

  /* ── 结算（深蓝宝石） ──────────────────────────── */
  .btn-bank {
    background: linear-gradient(160deg, #3498db 0%, #1f78b4 55%, #155e8e 100%);
    color: #fff;
    border: 1px solid #1565a0;
    box-shadow:
      inset 0 1px 0 rgba(130, 200, 255, 0.3),
      inset 0 -1px 0 rgba(0, 0, 0, 0.2),
      0 4px 16px rgba(41, 128, 185, 0.3),
      0 2px 4px rgba(0, 0, 0, 0.35);
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.25);
  }

  .btn-bank:hover:not(:disabled) {
    box-shadow:
      inset 0 1px 0 rgba(130, 200, 255, 0.3),
      inset 0 -1px 0 rgba(0, 0, 0, 0.2),
      0 6px 22px rgba(41, 128, 185, 0.5),
      0 2px 6px rgba(0, 0, 0, 0.35);
  }

  /* ── 满盘（火焰橙，动态发光） ───────────────────── */
  .btn-hot {
    background: linear-gradient(160deg, #f39c12 0%, #e67e22 50%, #c0621a 100%);
    color: #fff;
    border: 1px solid #b05a10;
    font-size: 1.1rem;
    box-shadow:
      inset 0 1px 0 rgba(255, 210, 100, 0.35),
      inset 0 -1px 0 rgba(0, 0, 0, 0.2),
      0 4px 16px rgba(230, 126, 34, 0.4),
      0 2px 4px rgba(0, 0, 0, 0.4);
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
    animation: glow 1s ease-in-out infinite alternate;
  }

  @keyframes glow {
    from {
      box-shadow:
        inset 0 1px 0 rgba(255, 210, 100, 0.35),
        inset 0 -1px 0 rgba(0, 0, 0, 0.2),
        0 4px 16px rgba(230, 126, 34, 0.4),
        0 2px 4px rgba(0, 0, 0, 0.4);
    }
    to {
      box-shadow:
        inset 0 1px 0 rgba(255, 220, 120, 0.5),
        inset 0 -1px 0 rgba(0, 0, 0, 0.2),
        0 6px 28px rgba(230, 126, 34, 0.75),
        0 0 12px rgba(255, 160, 40, 0.4),
        0 2px 6px rgba(0, 0, 0, 0.4);
    }
  }

  .sub {
    font-size: 0.75rem;
    opacity: 0.7;
    font-weight: normal;
  }

  .score-preview {
    font-size: 0.85rem;
    background: rgba(255,255,255,0.2);
    padding: 0.1rem 0.4rem;
    border-radius: 4px;
  }

  .bust-message {
    color: #e74c3c;
    font-size: 1.3rem;
    font-weight: bold;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    animation: shake 0.4s ease-in-out;
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25%      { transform: translateX(-8px); }
    75%      { transform: translateX(8px); }
  }

  .bust-icon {
    font-size: 2rem;
  }

  .game-over {
    color: #d4a843;
    font-size: 1.5rem;
    font-weight: bold;
  }

  .waiting-turn {
    color: #8a7a5a;
    font-size: 1rem;
  }
</style>
