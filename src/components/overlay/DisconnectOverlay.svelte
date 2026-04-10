<script lang="ts">
  import {
    isOpponentDisconnected,
    reconnectCountdown,
    opponentName,
  } from '$lib/stores/gameStore';
  import { rematchLobby } from '$lib/stores/gameStore';
  import { networkState } from '$lib/network/trystero';

  let disconnected = $state(false);
  let countdown = $state<number | null>(null);
  let opName = $state('对手');
  let roomCode = $state<string | null>(null);

  isOpponentDisconnected.subscribe(v => { disconnected = v; });
  reconnectCountdown.subscribe(v => { countdown = v; });
  opponentName.subscribe(v => { opName = v; });
  networkState.subscribe(ns => { roomCode = ns.roomCode; });

  // 60 秒倒计时归零后显示"返回大厅"按钮（countdown 变为 null）
  const canLeave = $derived(countdown === null && disconnected);
</script>

{#if disconnected}
  <div class="disconnect-overlay" role="alertdialog" aria-modal="true" aria-label="对手断线">
    <div class="panel">
      <div class="icon">🔌</div>
      <h2 class="title">连接已断开</h2>
      <p class="desc">
        <span class="name">{opName}</span> 已断开连接，正在等待对方重新加入…
      </p>

      {#if countdown !== null}
        <div class="countdown">
          等待重连：<span class="count">{countdown}</span> 秒
        </div>
        {#if roomCode}
          <div class="room-code-hint">
            <span class="room-code-label">房间码</span>
            <span class="room-code-val">{roomCode}</span>
          </div>
          <p class="hint">让对方输入此房间码重新加入</p>
        {:else}
          <p class="hint">对方可使用原来的房间码重新加入</p>
        {/if}
      {:else}
        <p class="timeout-msg">⌛ 等待超时，对方未能重新连接</p>
      {/if}

      <button class="btn-leave" onclick={rematchLobby}>
        返回大厅
      </button>
    </div>
  </div>
{/if}

<style>
  .disconnect-overlay {
    position: fixed;
    inset: 0;
    background: rgba(10, 7, 2, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    backdrop-filter: blur(4px);
  }

  .panel {
    background: #1e160a;
    border: 2px solid #7a5a1a;
    border-radius: 12px;
    padding: 2.5rem 2rem;
    max-width: 380px;
    width: 90%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  }

  .icon {
    font-size: 3rem;
    animation: flicker 2s ease-in-out infinite;
  }

  @keyframes flicker {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.5; }
  }

  .title {
    color: #e8d8a0;
    font-size: 1.4rem;
    font-weight: bold;
    margin: 0;
  }

  .desc {
    color: #8a7a5a;
    font-size: 0.95rem;
    margin: 0;
  }

  .name {
    color: #d4a843;
    font-weight: bold;
  }

  .countdown {
    color: #c8b888;
    font-size: 1.05rem;
    padding: 0.5rem 1rem;
    border: 1px solid #4a3a1a;
    border-radius: 8px;
    background: #14100668;
  }

  .count {
    color: #e07050;
    font-size: 1.3rem;
    font-weight: bold;
    font-variant-numeric: tabular-nums;
    min-width: 2ch;
    display: inline-block;
    text-align: center;
  }

  .hint {
    color: #6a5a3a;
    font-size: 0.82rem;
    margin: -0.2rem 0 0;
  }

  .timeout-msg {
    color: #c07050;
    font-size: 0.95rem;
    margin: 0;
  }

  .btn-leave {
    margin-top: 0.5rem;
    background: #5a3a1a;
    color: #f0e6c8;
    border: 1px solid #8a6a2a;
    border-radius: 8px;
    padding: 0.6rem 1.5rem;
    font-size: 0.95rem;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-leave:hover {
    background: #7a5a2a;
  }

  .room-code-hint {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    background: #0d0802;
    border: 1px solid #6a5a2a;
    border-radius: 8px;
    padding: 0.5rem 1.5rem;
    margin-top: 0.2rem;
  }

  .room-code-label {
    font-size: 0.72rem;
    color: #8a7a5a;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .room-code-val {
    font-family: 'Courier New', monospace;
    font-size: 1.8rem;
    font-weight: bold;
    color: #d4a843;
    letter-spacing: 0.35em;
    line-height: 1;
  }
</style>
