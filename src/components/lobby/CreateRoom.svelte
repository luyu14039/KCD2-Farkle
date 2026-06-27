<script lang="ts">
  import { generateRoomCode, getRoomUrl, initRoom, rememberRoomRole } from '$lib/network/trystero';
  import { networkState } from '$lib/network/trystero';
  import { myRole, myName, opponentName, initMessageHandler, startGame } from '$lib/stores/gameStore';
  import { sendMessage } from '$lib/network/trystero';
  import { PROTOCOL_VERSION } from '$lib/network/protocol';
  import type { GameConfig } from '$lib/game/types';
  import RulesConfig from './RulesConfig.svelte';
  import ManualConnect from './ManualConnect.svelte';

  let roomCode = $state('');
  let shareUrl = $state('');
  let copied   = $state(false);
  let showRules = $state(false);
  let showManual = $state(false);
  let playerName = $state('房主');

  function handleCreate() {
    roomCode = generateRoomCode();
    shareUrl = getRoomUrl(roomCode);
    myRole.set('host');
    rememberRoomRole(roomCode, 'host');
    myName.set(playerName);
    initRoom(roomCode);
    initMessageHandler();
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(shareUrl);
    copied = true;
    setTimeout(() => copied = false, 2000);
  }

  function handleStartGame(config: GameConfig) {
    sendMessage({ type: 'player_ack', hostName: playerName, protocolVersion: PROTOCOL_VERSION });
    startGame(config);
  }

  // 监听连接状态
  let status = $state('idle');
  let waitingSince = $state<number | null>(null);
  networkState.subscribe(ns => {
    status = ns.status;
    waitingSince = ns.waitingSince;
  });

  // 已等待秒数（每秒更新）
  let elapsedSeconds = $state(0);
  $effect(() => {
    if (status !== 'waiting_peer' || waitingSince === null) {
      elapsedSeconds = 0;
      return;
    }
    elapsedSeconds = Math.floor((Date.now() - waitingSince) / 1000);
    const timer = setInterval(() => {
      elapsedSeconds = Math.floor((Date.now() - (waitingSince ?? Date.now())) / 1000);
    }, 1000);
    return () => clearInterval(timer);
  });
</script>

<div class="create-room">
  {#if !roomCode}
    <!-- 尚未创建房间 -->
    <label class="field">
      <span class="label">你的名字</span>
      <input type="text" bind:value={playerName} maxlength="12" placeholder="输入昵称" />
    </label>
    <button class="btn-primary" onclick={handleCreate}>创建房间</button>

  {:else if status === 'signaling'}
    <div class="room-info">
      <p class="room-label">房间码</p>
      <p class="room-code">{roomCode}</p>
      <div class="waiting">
        <span class="dot-anim"></span>
        正在连接 MQTT 服务器…
      </div>
    </div>

  {:else if status === 'waiting_peer'}
    <!-- 信令已就绪，等待对手加入 -->
    <div class="room-info">
      <p class="room-label">房间码</p>
      <p class="room-code">{roomCode}</p>
      <p class="hint">将以下链接发送给好友：</p>
      <div class="share-row">
        <input type="text" class="share-input" value={shareUrl} readonly />
        <button class="btn-copy" onclick={handleCopy}>
          {copied ? '已复制 ✓' : '复制'}
        </button>
      </div>
      <div class="waiting">
        <span class="dot-anim"></span>
        等待对手加入…{elapsedSeconds > 0 ? `（已等待 ${elapsedSeconds} 秒）` : ''}
      </div>
    </div>

  {:else if status === 'timeout'}
    <div class="timeout-info">
      <p class="error">⌛ 连接超时（60 秒），对方没有加入房间</p>
      {#if !showManual}
        <p class="hint">请检查网络连接，或尝试手动连接模式（无需服务器）</p>
        <button class="btn-primary" onclick={handleCreate}>重新创建</button>
        <button class="btn-manual" onclick={() => showManual = true}>⚡ 手动连接（备用）</button>
      {:else}
        <ManualConnect role="host" playerName={playerName} />
        <button class="btn-back" onclick={() => showManual = false}>← 返回</button>
      {/if}
    </div>

  {:else if status === 'connected'}
    <!-- 对手已连接 -->
    {#if !showRules}
      <div class="connected-info">
        <p class="success">对手已连接！</p>
        <button class="btn-primary" onclick={() => showRules = true}>
          设置规则
        </button>
      </div>
    {:else}
      <RulesConfig onConfirm={handleStartGame} />
    {/if}

  {:else if status === 'disconnected'}
    <p class="error">对手已断开连接</p>
    <button class="btn-primary" onclick={handleCreate}>重建房间</button>
  {/if}
</div>

<style>
  .create-room {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    width: 100%;
    max-width: 420px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    width: 100%;
  }

  .label {
    color: #c8b888;
    font-size: 0.9rem;
  }

  input[type="text"] {
    background: #1a1008;
    border: 1px solid #5a4a2a;
    border-radius: 6px;
    color: #f0e6c8;
    padding: 0.5rem 0.75rem;
    font-size: 1rem;
    font-family: inherit;
    width: 100%;
  }

  input[type="text"]:focus {
    outline: none;
    border-color: #d4a843;
  }

  .room-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
  }

  .room-label {
    color: #8a7a5a;
    font-size: 0.85rem;
  }

  .room-code {
    font-size: 2.5rem;
    font-weight: bold;
    color: #d4a843;
    letter-spacing: 0.3em;
    font-family: 'Courier New', monospace;
  }

  .hint {
    color: #8a7a5a;
    font-size: 0.85rem;
  }

  .share-row {
    display: flex;
    gap: 0.5rem;
    width: 100%;
  }

  .share-input {
    flex: 1;
    background: #1a1008;
    border: 1px solid #5a4a2a;
    border-radius: 6px;
    color: #8a7a5a;
    padding: 0.4rem 0.6rem;
    font-size: 0.8rem;
    font-family: monospace;
  }

  .btn-copy {
    background: #3a2e1a;
    color: #d4a843;
    border: 1px solid #5a4a2a;
    border-radius: 6px;
    padding: 0.4rem 0.8rem;
    font-size: 0.85rem;
    cursor: pointer;
    white-space: nowrap;
    font-family: inherit;
  }

  .btn-copy:hover {
    background: #4a3e2a;
  }

  .timeout-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    text-align: center;
  }

  .waiting {
    color: #8a7a5a;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .dot-anim {
    width: 8px;
    height: 8px;
    background: #d4a843;
    border-radius: 50%;
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50%      { opacity: 1; }
  }

  .connected-info {
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: center;
  }

  .success {
    color: #7dcea0;
    font-size: 1.1rem;
  }

  .error {
    color: #e74c3c;
  }

  .btn-primary {
    background: #d4a843;
    color: #1a1008;
    border: none;
    border-radius: 8px;
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: bold;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-primary:hover {
    background: #e8bf5a;
  }

  .btn-manual {
    background: transparent;
    color: #c8b888;
    border: 1px dashed #5a4a2a;
    border-radius: 6px;
    padding: 0.5rem 1.2rem;
    font-size: 0.88rem;
    cursor: pointer;
    font-family: inherit;
    transition: border-color 0.15s, color 0.15s;
  }

  .btn-manual:hover {
    border-color: #d4a843;
    color: #d4a843;
  }

  .btn-back {
    background: transparent;
    color: #8a7a5a;
    border: none;
    font-size: 0.85rem;
    cursor: pointer;
    font-family: inherit;
    padding: 0.3rem 0;
    text-decoration: underline;
  }
</style>
