<script lang="ts">
  import { untrack } from 'svelte';
  import { getRememberedRoomRole, initRoom, networkState, rememberRoomRole, setAutoReconnect } from '$lib/network/trystero';
  import { PROTOCOL_VERSION } from '$lib/network/protocol';
  import { myRole, myName, initMessageHandler, sendReliableGameMessage, appView } from '$lib/stores/gameStore';
  import ManualConnect from './ManualConnect.svelte';

  let {
    initialCode = '',
  }: {
    initialCode?: string;
  } = $props();

  let roomCode = $state(untrack(() => initialCode));
  let playerName = $state('客人');
  let status = $state('idle');
  let waitingSince = $state<number | null>(null);
  let joined = $state(false);
  let showManual = $state(false);
  let helloSent = $state(false);

  networkState.subscribe(ns => {
    status = ns.status;
    waitingSince = ns.waitingSince;
  });

  function handleJoin() {
    if (!roomCode.trim()) return;
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    const role = getRememberedRoomRole(normalizedRoomCode) ?? 'guest';
    myRole.set(role);
    rememberRoomRole(normalizedRoomCode, role);
    setAutoReconnect(role !== 'host');
    myName.set(playerName);
    initRoom(normalizedRoomCode);
    initMessageHandler();
    joined = true;
  }

  // 连接成功后自动发送 hello
  $effect(() => {
    if (status !== 'connected') {
      helloSent = false;
    }

    if (status === 'connected' && joined) {
      if (helloSent) return;
      const role = getRememberedRoomRole(roomCode.trim().toUpperCase()) ?? 'guest';
      sendReliableGameMessage({ type: 'player_hello', name: playerName, protocolVersion: PROTOCOL_VERSION, role });
      helloSent = true;
    }
  });

  // 已等待秒数
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

<div class="join-room">
  {#if !joined}
    <label class="field">
      <span class="label">你的名字</span>
      <input type="text" bind:value={playerName} maxlength="12" placeholder="输入昵称" />
    </label>

    <label class="field">
      <span class="label">房间码</span>
      <input
        type="text"
        class="code-input"
        bind:value={roomCode}
        maxlength="6"
        placeholder="输入6位房间码"
      />
    </label>

    <button class="btn-primary" onclick={handleJoin} disabled={!roomCode.trim()}>
      加入房间
    </button>

  {:else if status === 'signaling'}
    <div class="waiting">
      <span class="dot-anim"></span>
      正在连接 MQTT 服务器…
    </div>

  {:else if status === 'waiting_peer'}
    <div class="waiting">
      <span class="dot-anim"></span>
      正在连接房间 <strong>{roomCode}</strong>…{elapsedSeconds > 0 ? `（已等待 ${elapsedSeconds} 秒）` : ''}
    </div>

  {:else if status === 'timeout'}
    <div class="timeout-info">
      <p class="error">⌛ 连接超时（60 秒），未能加入房间</p>
      {#if !showManual}
        <p class="hint">请检查房间码是否正确，或让房主重新创建房间</p>
        <button class="btn-primary" onclick={() => { joined = false; showManual = false; }}>重新输入</button>
        <button class="btn-manual" onclick={() => showManual = true}>⚡ 手动连接（备用）</button>
      {:else}
        <ManualConnect role="guest" playerName={playerName} />
        <button class="btn-back" onclick={() => showManual = false}>← 返回</button>
      {/if}
    </div>

  {:else if status === 'connected'}
    <div class="connected">
      <p class="success">已连接！等待房主开始游戏…</p>
    </div>

  {:else if status === 'disconnected'}
    <p class="error">连接已断开</p>
    <button class="btn-primary" onclick={() => { joined = false; }}>重新加入</button>
  {/if}
</div>

<style>
  .join-room {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    width: 100%;
    max-width: 380px;
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

  .code-input {
    font-size: 1.5rem;
    text-align: center;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    font-family: 'Courier New', monospace;
  }

  .waiting {
    color: #8a7a5a;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
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

  .connected {
    text-align: center;
  }

  .success {
    color: #7dcea0;
    font-size: 1.1rem;
  }

  .error {
    color: #e74c3c;
  }

  .hint {
    color: #8a7a5a;
    font-size: 0.85rem;
    text-align: center;
  }

  .timeout-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    text-align: center;
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

  .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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
