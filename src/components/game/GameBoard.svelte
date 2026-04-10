<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import DiceGroup from '../dice/DiceGroup.svelte';
  import ScorePanel from './ScorePanel.svelte';
  import ActionBar from './ActionBar.svelte';
  import CommentaryOverlay from '../overlay/CommentaryOverlay.svelte';
  import ParticleEffect from '../overlay/ParticleEffect.svelte';
  import GameOverDialog from '../overlay/GameOverDialog.svelte';
  import DisconnectOverlay from '../overlay/DisconnectOverlay.svelte';
  import RulesModal from '../overlay/RulesModal.svelte';
  import PhasePlacard from './PhasePlacard.svelte';
  import {
    gameState, isMyTurn, selectedDieIds, statusMessage, awaitingRoll, myRole,
    toggleDieSelection, onRollAnimationDone,
    startIdleCommentary, stopIdleCommentary,
    isOpponentDisconnected,
  } from '$lib/stores/gameStore';
  import { getDieDefinition } from '$lib/game/diceRegistry';
  import type { Die, PlayerId } from '$lib/game/types';

  let dice = $state<Die[]>([]);
  let phase = $state('selecting');
  let myTurn = $state(false);
  let selIds = $state<number[]>([]);
  let toastMsg = $state('');
  let needsRoll = $state(true);
  let hostDice = $state<string[]>([]);
  let guestDice = $state<string[]>([]);
  let role = $state<PlayerId>('host');
  let opponentOffline = $state(false);
  let showRules = $state(false);

  gameState.subscribe(s => { dice = s.dice; phase = s.phase; hostDice = s.hostDice; guestDice = s.guestDice; });
  isMyTurn.subscribe(v => { myTurn = v; });
  selectedDieIds.subscribe(v => { selIds = v; });
  statusMessage.subscribe(v => { toastMsg = v; });
  awaitingRoll.subscribe(v => { needsRoll = v; });
  myRole.subscribe(v => { role = v; });
  isOpponentDisconnected.subscribe(v => { opponentOffline = v; });

  // 游戏星现时开启酒馆环境音，离开时停止
  onMount(() => startIdleCommentary());
  onDestroy(() => stopIdleCommentary());

  const isRolling = $derived(phase === 'rolling' || phase === 'bust');
  // 对手断线时禁用选中操作
  const canSelect = $derived(phase === 'selecting' && myTurn && !needsRoll && !opponentOffline);

  // 当前玩家的特殊骰子列表
  const mySpecialDice = $derived(
    (role === 'host' ? hostDice : guestDice)
      .filter(id => id !== 'NormalDie')
      .map(id => getDieDefinition(id))
  );
</script>

<div class="game-board">
  <!-- 规则按钮（随时可查） -->
  <button class="btn-rules" onclick={() => showRules = true} title="查看规则">?</button>

  <!-- 状态 Toast -->
  {#if toastMsg}
    <div class="toast">{toastMsg}</div>
  {/if}

  <!-- 双方比分 -->
  <ScorePanel />

  <!-- 装饰分隔线 -->
  <div class="section-divider" aria-hidden="true">
    <span class="divider-line"></span>
    <span class="divider-symbol">⬡</span>
    <span class="divider-line"></span>
  </div>

  <!-- 阶段牌匾 -->
  <PhasePlacard />

  <!-- 骰子区域 -->
  <div class="dice-area">
    <span class="corner corner-tl" aria-hidden="true"></span>
    <span class="corner corner-tr" aria-hidden="true"></span>
    <span class="corner corner-bl" aria-hidden="true"></span>
    <span class="corner corner-br" aria-hidden="true"></span>
    {#if mySpecialDice.length > 0}
      <div class="dice-composition">
        {#each mySpecialDice as def}
          <span class="dice-chip" style:background={def.color}>{def.shortName}</span>
        {/each}
      </div>
    {/if}
    <DiceGroup
      {dice}
      rolling={isRolling}
      canSelect={canSelect}
      selectedIds={selIds}
      onSelect={toggleDieSelection}
      onAllSettled={onRollAnimationDone}
    />
  </div>

  <!-- 操作栏 -->
  <ActionBar />
</div>

<!-- 中世纪旁白覆盖层 -->
<CommentaryOverlay />
<!-- 粒子庆祝 -->
<ParticleEffect />
<!-- 游戏结束对话框 -->
<GameOverDialog />
<!-- 对手断线提示 -->
<DisconnectOverlay />
<!-- 规则弹窗 -->
{#if showRules}
  <RulesModal onClose={() => showRules = false} />
{/if}

<style>
  .game-board {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.9rem;
    padding: 1rem;
    width: 100%;
    max-width: 700px;
    margin: 0 auto;
    min-height: 100dvh;
    justify-content: center;
    position: relative;
  }

  /* ── 背景层 A: 静态暖色大气（火炎漫射 + 深棣底） ────────────── */
  .game-board::before {
    content: '';
    position: fixed;
    inset: 0;
    background:
      /* 天花板火炎向下漫射 */
      radial-gradient(ellipse 130% 28% at 50% -3%, rgba(190, 100, 12, 0.22) 0%, transparent 58%),
      /* 左侧火炎温暖晕晕 */
      radial-gradient(ellipse 55% 75% at -5% 40%, rgba(175, 75, 8, 0.16) 0%, transparent 60%),
      /* 右侧火炎温暖晕晕 */
      radial-gradient(ellipse 55% 75% at 105% 40%, rgba(175, 75, 8, 0.16) 0%, transparent 60%),
      /* 中央暗棣面底色 */
      radial-gradient(ellipse 90% 65% at 50% 25%, #1e1507 0%, transparent 78%),
      #09060300;
    z-index: -2;
    pointer-events: none;
  }

  /* ── 背景层 B: 火炎跳动动画光晕 ──────────────────── */
  .game-board::after {
    content: '';
    position: fixed;
    inset: 0;
    background:
      radial-gradient(ellipse 42% 62% at -1% 32%, rgba(215, 88, 5, 0.15) 0%, transparent 55%),
      radial-gradient(ellipse 42% 62% at 101% 32%, rgba(215, 88, 5, 0.15) 0%, transparent 55%);
    z-index: -1;
    pointer-events: none;
    animation: torch-flicker 3.8s ease-in-out infinite;
  }

  @keyframes torch-flicker {
    0%   { opacity: 0.50; }
    18%  { opacity: 0.95; }
    32%  { opacity: 0.65; }
    56%  { opacity: 1.00; }
    72%  { opacity: 0.70; }
    88%  { opacity: 0.88; }
    100% { opacity: 0.52; }
  }

  /* ── 装饰分隔线 ─────────────────────────────────── */
  .section-divider {
    display: flex;
    align-items: center;
    width: 100%;
    gap: 0.6rem;
    padding: 0 0.5rem;
    opacity: 0.45;
  }
  .divider-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, transparent, #d4a843 40%, #d4a843 60%, transparent);
  }
  .divider-symbol {
    color: #d4a843;
    font-size: 0.8rem;
    line-height: 1;
    flex-shrink: 0;
  }

  /* ── 骰子区：木质楐左案台 ────────────────────────── */
  .dice-area {
    background:
      /* 水平木纹线（微弱） */
      repeating-linear-gradient(
        0deg,
        transparent 0px, transparent 4px,
        rgba(255, 200, 80, 0.018) 4px, rgba(255, 200, 80, 0.018) 5px
      ),
      /* 近垂直纹质强化溺和感 */
      repeating-linear-gradient(
        92deg,
        transparent 0px, transparent 8px,
        rgba(0, 0, 0, 0.028) 8px, rgba(0, 0, 0, 0.028) 9px
      ),
      /* 中央火烛光投在桐面 */
      radial-gradient(ellipse 70% 50% at 50% 22%, rgba(195, 115, 20, 0.11) 0%, transparent 65%),
      /* 深色橡木底色 */
      linear-gradient(175deg, #231c0d 0%, #1c1509 55%, #161008 100%);
    border: 1.5px solid #7a5220;
    border-radius: 16px;
    padding: 1.2rem 1rem 1rem;
    width: 100%;
    position: relative;
    box-shadow:
      /* 内侧暗边线（双边框错觉） */
      inset 0 0 0 1px rgba(0, 0, 0, 0.55),
      /* 深角压暗 */
      inset 0 5px 80px rgba(0, 0, 0, 0.72),
      /* 顶部火烛反射暖光 */
      inset 0 -2px 50px rgba(185, 100, 10, 0.09),
      /* 外框微金广 */
      0 0 0 1px rgba(212, 168, 67, 0.12),
      /* 暄影 */
      0 8px 40px rgba(0, 0, 0, 0.75);
  }

  /* ── 角标（加大 + 菱形饰点） ──────────────────────── */
  .corner {
    position: absolute;
    width: 22px;
    height: 22px;
    pointer-events: none;
    z-index: 1;
  }
  .corner-tl { top: 6px; left: 6px; border-top: 2px solid rgba(212,168,67,0.55); border-left: 2px solid rgba(212,168,67,0.55); border-radius: 3px 0 0 0; }
  .corner-tr { top: 6px; right: 6px; border-top: 2px solid rgba(212,168,67,0.55); border-right: 2px solid rgba(212,168,67,0.55); border-radius: 0 3px 0 0; }
  .corner-bl { bottom: 6px; left: 6px; border-bottom: 2px solid rgba(212,168,67,0.55); border-left: 2px solid rgba(212,168,67,0.55); border-radius: 0 0 0 3px; }
  .corner-br { bottom: 6px; right: 6px; border-bottom: 2px solid rgba(212,168,67,0.55); border-right: 2px solid rgba(212,168,67,0.55); border-radius: 0 0 3px 0; }

  /* 菱形饰点：每个 L 形括弧的内角处 */
  .corner::before {
    content: '';
    position: absolute;
    width: 5px;
    height: 5px;
    background: rgba(212, 168, 67, 0.62);
    clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  }
  .corner-tl::before { bottom: -1px; right: -1px; }
  .corner-tr::before { bottom: -1px; left: -1px; }
  .corner-bl::before { top: -1px; right: -1px; }
  .corner-br::before { top: -1px; left: -1px; }

  /* ── 特殊骰子提示徽章 ──────────────────────────── */
  .dice-composition {
    display: flex;
    justify-content: center;
    gap: 0.4rem;
    margin-bottom: 0.6rem;
    flex-wrap: wrap;
  }
  .dice-chip {
    font-size: 0.7rem;
    font-weight: 700;
    color: #000;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    white-space: nowrap;
  }

  /* ── Toast 状态提示 ──────────────────────────────── */
  .toast {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(42, 30, 14, 0.95);
    border: 1px solid #d4a843;
    color: #f0e6c8;
    padding: 0.6rem 1.2rem;
    border-radius: 8px;
    font-size: 0.95rem;
    z-index: 100;
    animation: fadeIn 0.2s ease-out;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  /* ── 规则按钮（右上角固定） ──────────────────────── */
  .btn-rules {
    position: fixed;
    top: 0.75rem;
    right: 0.75rem;
    z-index: 50;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(30, 20, 8, 0.82);
    border: 1px solid rgba(212, 168, 67, 0.45);
    color: #d4a843;
    font-size: 1.1rem;
    font-weight: bold;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.15s, background 0.15s, transform 0.1s;
    backdrop-filter: blur(4px);
    padding: 0;
  }

  .btn-rules:hover {
    border-color: #d4a843;
    background: rgba(50, 35, 10, 0.92);
    transform: scale(1.08);
  }
</style>
