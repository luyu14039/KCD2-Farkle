<script lang="ts">
  import { gameState, myRole, floatingScore } from '$lib/stores/gameStore';

  type PlayerInfo = { id: string; name: string; totalScore: number; turnScore: number };

  let players = $state<[PlayerInfo, PlayerInfo]>([
    { id: 'host', name: '房主', totalScore: 0, turnScore: 0 },
    { id: 'guest', name: '客人', totalScore: 0, turnScore: 0 },
  ]);
  let currentIdx = $state<0|1>(0);
  let turnScore = $state(0);
  let target = $state(4000);
  let role = $state<string>('host');

  // 飘字动画
  let floatVal = $state<{ value: number; key: number } | null>(null);
  floatingScore.subscribe(v => { floatVal = v; });

  // totalScore 弹跳标志
  let popFlags = $state([false, false]);
  const prevTotals = [0, 0];

  gameState.subscribe($s => {
    $s.players.forEach((p, i) => {
      if (p.totalScore !== prevTotals[i] && prevTotals[i] > 0) {
        popFlags[i] = true;
        setTimeout(() => { popFlags[i] = false; }, 450);
      }
      prevTotals[i] = p.totalScore;
    });
    players = $s.players;
    currentIdx = $s.currentPlayerIndex;
    turnScore = $s.turnScore;
    target = $s.config.targetScore;
  });

  myRole.subscribe(r => { role = r; });

  // turnScore 颜色分级
  const turnScoreColor = $derived(
    turnScore >= 1000 ? '#d4a843' : turnScore >= 500 ? '#7dcea0' : '#a0b898'
  );
</script>

<div class="score-panel">
  {#each players as player, i}
    {@const isMe = player.id === role}
    {@const isActive = i === currentIdx}
    <div class="player-card" class:active={isActive} class:me={isMe}>

      <div class="player-header">
        <span class="name">
          {#if isActive}<span class="name-dot" aria-hidden="true"></span>{/if}
          {player.name}{isMe ? '（你）' : ''}
        </span>
        {#if isActive}
          <span class="turn-badge">当前回合</span>
        {/if}
      </div>

      <div class="score-row">
        <span class="total-score" class:pop={popFlags[i]}>{player.totalScore}</span>
        <span class="separator">/</span>
        <span class="target">{target}</span>
      </div>

      {#if isActive && turnScore > 0}
        <div class="turn-score" style:color={turnScoreColor}>
          +{turnScore}
        </div>
      {/if}

      <div class="progress-bar">
        <div
          class="progress-fill"
          style:width="{Math.min(100, (player.totalScore / target) * 100)}%"
        ></div>
      </div>
    </div>
  {/each}

  <!-- 飘字覆盖层：position:fixed 脱离所有 overflow:hidden 裁剪 -->
  {#if floatVal}
    {#key floatVal.key}
      <div class="float-score">+{floatVal.value}</div>
    {/key}
  {/if}
</div>

<style>
  .score-panel {
    display: flex;
    gap: 1rem;
    width: 100%;
    max-width: 600px;
    justify-content: center;
  }

  .player-card {
    flex: 1;
    position: relative;
    background: linear-gradient(160deg, #2e2010 0%, #231808 100%);
    border: 1px solid #3a2e1a;
    border-top: 2px solid transparent;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    transition: border-color 0.25s, box-shadow 0.25s;
    min-width: 0;
    /* overflow: hidden 已移除（避免裁剪飘字动画） */
  }

  /* 顶部金色渐变线（用 ::before 实现，不影响 border-radius） */
  .player-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 10%;
    right: 10%;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(212, 168, 67, 0.25), transparent);
    border-radius: 1px;
    transition: opacity 0.25s;
    opacity: 0;
  }

  /* 左侧金色竖线（激活玩家） */
  .player-card::after {
    content: '';
    position: absolute;
    left: 0;
    top: 20%;
    height: 60%;
    width: 3px;
    background: linear-gradient(180deg, transparent, #d4a843, transparent);
    border-radius: 0 2px 2px 0;
    opacity: 0;
    transition: opacity 0.3s;
  }

  .player-card.active {
    border-color: rgba(212, 168, 67, 0.55);
    box-shadow:
      inset 0 0 24px rgba(212, 168, 67, 0.06),
      0 4px 16px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(212, 168, 67, 0.12);
  }

  .player-card.active::before {
    opacity: 1;
    left: 5%;
    right: 5%;
    background: linear-gradient(90deg, transparent, rgba(212, 168, 67, 0.55), transparent);
  }

  .player-card.active::after {
    opacity: 1;
  }

  .player-card.me {
    background: linear-gradient(160deg, #332514 0%, #281c0a 100%);
  }

  .player-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.4rem;
  }

  .name {
    color: #c8b888;
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 0.35em;
  }

  /* 激活玩家名字前的脉冲圆点 */
  .name-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #d4a843;
    flex-shrink: 0;
    animation: pulse-dot 1.4s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.35; transform: scale(0.7); }
  }

  .turn-badge {
    background: linear-gradient(135deg, #e0b84a 0%, #a07820 100%);
    color: #1a1008;
    font-size: 0.65rem;
    font-weight: bold;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    white-space: nowrap;
    box-shadow: 0 1px 4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,100,0.3);
    letter-spacing: 0.02em;
  }

  .score-row {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    margin-bottom: 0.3rem;
  }

  .total-score {
    font-size: 1.8rem;
    font-weight: bold;
    color: #f0e6c8;
    display: inline-block;
  }

  .total-score.pop {
    animation: pop 0.42s ease-out;
  }

  @keyframes pop {
    0%   { transform: scale(1); }
    35%  { transform: scale(1.22); color: #e8bf5a; }
    100% { transform: scale(1); }
  }

  .separator {
    color: #5a4a2a;
    font-size: 1rem;
  }

  .target {
    color: #5a4a2a;
    font-size: 0.9rem;
  }

  .turn-score {
    font-size: 1.1rem;
    font-weight: bold;
    margin-bottom: 0.3rem;
    transition: color 0.3s;
  }

  .progress-bar {
    height: 4px;
    background: #1a1008;
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #a07820, #e0b84a 60%, #c89028);
    border-radius: 2px;
    transition: width 0.4s ease-out;
    box-shadow: 0 0 6px rgba(212, 168, 67, 0.4);
  }

  /* ── 飘字动画（position:fixed 确保不被任何 overflow 裁剪）── */
  .float-score {
    position: fixed;
    top: 38vh;
    left: 50%;
    transform: translateX(-50%);
    font-size: 2rem;
    font-weight: bold;
    color: #e8bf5a;
    text-shadow: 0 0 18px rgba(212, 168, 67, 0.85), 0 2px 6px rgba(0, 0, 0, 0.8);
    pointer-events: none;
    z-index: 200;
    white-space: nowrap;
    animation: floatUp 1.4s ease-out forwards;
  }

  @keyframes floatUp {
    0%   { opacity: 0; transform: translateX(-50%) translateY(10px) scale(0.7); }
    18%  { opacity: 1; transform: translateX(-50%) translateY(0)   scale(1.1); }
    60%  { opacity: 1; transform: translateX(-50%) translateY(-28px) scale(1); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-70px) scale(0.9); }
  }
</style>
