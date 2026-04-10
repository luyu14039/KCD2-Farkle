<script lang="ts">
  import { gameState, appView } from '$lib/stores/gameStore';
  import type { GameConfig } from '$lib/game/types';

  let { onClose }: { onClose: () => void } = $props();

  let config = $state<GameConfig | null>(null);
  gameState.subscribe(s => { config = s.config; });

  let currentView = $state<'lobby' | 'game' | 'rps' | 'dice_selection'>('lobby');
  appView.subscribe(v => { currentView = v; });
  let isInGame = $derived(currentView === 'game');

  type Tab = 'guide' | 'scoring' | 'config';
  let activeTab = $state<Tab>('guide');

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  const selectionModeLabel: Record<string, string> = {
    free: '自由选择',
    draft: '轮流抓取',
  };
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- 半透明幕布，点击关闭 -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="backdrop" onclick={onClose} role="dialog" aria-modal="true" aria-label="规则说明" tabindex="-1">
  <!-- 面板内部点击不传播到幕布 -->
  <div class="panel" role="presentation" onclick={(e) => e.stopPropagation()}>

    <!-- 标题栏 -->
    <div class="modal-header">
      <span class="modal-icon">📜</span>
      <h2 class="modal-title">游戏规则</h2>
      <button class="btn-close" onclick={onClose} aria-label="关闭规则">✕</button>
    </div>

    <!-- 标签切换 -->
    <div class="tab-bar">
      <button class="tab {activeTab === 'guide' ? 'tab-active' : ''}" onclick={() => activeTab = 'guide'}>玩法说明</button>
      <button class="tab {activeTab === 'scoring' ? 'tab-active' : ''}" onclick={() => activeTab = 'scoring'}>计分规则</button>
      {#if isInGame}
        <button class="tab {activeTab === 'config' ? 'tab-active' : ''}" onclick={() => activeTab = 'config'}>本局设置</button>
      {/if}
    </div>

    <div class="modal-body">

      <!-- ── 玩法说明 ─────────────────────────── -->
      {#if activeTab === 'guide'}

        <section class="section">
          <h3 class="section-title">🎯 游戏目标</h3>
          <p class="prose">两名玩家轮流掷骰，通过选留得分骰子积累分数。率先将总分累积到双方约定的<strong>目标分数</strong>的玩家获胜。</p>
        </section>

        <div class="divider"></div>

        <section class="section">
          <h3 class="section-title">🔄 轮次结构</h3>
          <ul class="bullet-list">
            <li>每局由两名玩家交替进行回合，每次只有一方操作。</li>
            <li>一方的回合结束后（结算入账或爆点），换另一方开始新回合。</li>
            <li>一方达到目标分数后，对手还有一次机会追平或超越，若追上则继续比较。</li>
          </ul>
        </section>

        <div class="divider"></div>

        <section class="section">
          <h3 class="section-title">🎲 每回合的操作步骤</h3>
          <div class="step-list">
            <div class="step">
              <span class="step-num">1</span>
              <div class="step-body">
                <strong>掷骰</strong>
                <p>掷出所有未锁定的骰子（初始为 6 枚）。</p>
              </div>
            </div>
            <div class="step">
              <span class="step-num">2</span>
              <div class="step-body">
                <strong>选骰</strong>
                <p>从掷出的结果中，点击<strong>至少一枚</strong>有效计分骰子将其选中。无法计分的骰子无法被选中。</p>
              </div>
            </div>
            <div class="step">
              <span class="step-num">3</span>
              <div class="step-body">
                <strong>锁定 &amp; 决策</strong>
                <p>确认选骰后，选中的骰子计入本回合累计分并锁定（不可反选）。此时你可以：</p>
                <ul class="sub-list">
                  <li><span class="choice choice-continue">继续掷骰</span> — 用剩余骰子继续积累分数，但风险更高</li>
                  <li><span class="choice choice-bank">结算入账</span> — 将本回合累计分安全计入总分，回合结束</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <div class="divider"></div>

        <section class="section">
          <h3 class="section-title">⚡ 特殊情况</h3>
          <div class="special-list">
            <div class="special-item special-hotdice">
              <span class="special-icon">🔥</span>
              <div>
                <strong>满盘（Hot Dice）</strong>
                <p>若本次掷出的骰子<strong>全部</strong>可以计分，则骰子全部重置为 6 枚，可继续本回合累计，本回合积分不清零。</p>
              </div>
            </div>
            <div class="special-item special-bust">
              <span class="special-icon">💀</span>
              <div>
                <strong>爆点（Farkle）</strong>
                <p>若本次掷出的骰子<strong>没有任何</strong>得分组合，本回合所有累计分归零，回合立即结束，换对手。</p>
              </div>
            </div>
          </div>
        </section>

      <!-- ── 计分规则 ─────────────────────────── -->
      {:else if activeTab === 'scoring'}

        <section class="section">
          <h3 class="section-title">🎲 计分规则</h3>
          <table class="score-table">
            <thead>
              <tr><th>骰子组合</th><th>得分</th></tr>
            </thead>
            <tbody>
              <tr><td>单个 1</td><td>100</td></tr>
              <tr><td>单个 5</td><td>50</td></tr>
              <tr class="separator"><td colspan="2"></td></tr>
              <tr><td>三个 1</td><td>1000</td></tr>
              <tr><td>三个 N（N≠1）</td><td>N × 100</td></tr>
              <tr class="separator"><td colspan="2"></td></tr>
              <tr><td>四连（比三连翻倍）</td><td>×2</td></tr>
              <tr><td>五连（比四连翻倍）</td><td>×4</td></tr>
              <tr><td>六连（比五连翻倍）</td><td>×8</td></tr>
              <tr class="separator"><td colspan="2"></td></tr>
              <tr><td>顺子 1-2-3-4-5</td><td>500</td></tr>
              <tr><td>顺子 2-3-4-5-6</td><td>750</td></tr>
              <tr><td>顺子 1-2-3-4-5-6</td><td>1500</td></tr>
            </tbody>
          </table>
        </section>

      <!-- ── 本局设置 ─────────────────────────── -->
      {:else if activeTab === 'config'}

        {#if config}
          <section class="section">
            <h3 class="section-title">⚙ 本局设置</h3>
            <div class="config-grid">
              <span class="cfg-label">目标分数</span>
              <span class="cfg-val">{config.targetScore.toLocaleString()} 分</span>
              <span class="cfg-label">特殊骰子</span>
              <span class="cfg-val">{config.specialDiceCount === 0 ? '不使用' : `每人 ${config.specialDiceCount} 枚`}</span>
              {#if config.specialDiceCount > 0}
                <span class="cfg-label">选骰模式</span>
                <span class="cfg-val">{selectionModeLabel[config.selectionMode] ?? config.selectionMode}</span>
              {/if}
            </div>
          </section>
        {/if}

      {/if}

    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 3, 1, 0.78);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 400;
    backdrop-filter: blur(3px);
    padding: 1rem;
  }

  .panel {
    background: linear-gradient(170deg, #231a09 0%, #1a1206 100%);
    border: 1.5px solid #7a5a1a;
    border-radius: 14px;
    width: 100%;
    max-width: 460px;
    max-height: 88dvh;
    display: flex;
    flex-direction: column;
    box-shadow:
      0 0 0 1px rgba(212, 168, 67, 0.1),
      0 12px 48px rgba(0, 0, 0, 0.75),
      inset 0 1px 0 rgba(212, 168, 67, 0.12);
    overflow: hidden;
  }

  /* ── 标题栏 ── */
  .modal-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 1rem 1.2rem 0.9rem;
    border-bottom: 1px solid #3a2a10;
    flex-shrink: 0;
  }

  .modal-icon {
    font-size: 1.3rem;
    line-height: 1;
  }

  .modal-title {
    flex: 1;
    margin: 0;
    font-size: 1.15rem;
    color: #e8d8a0;
    font-weight: bold;
    letter-spacing: 0.05em;
  }

  .btn-close {
    background: none;
    border: 1px solid #4a3a1a;
    border-radius: 6px;
    color: #8a7a5a;
    font-size: 0.9rem;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    padding: 0;
    font-family: inherit;
    flex-shrink: 0;
  }

  .btn-close:hover {
    border-color: #d4a843;
    color: #d4a843;
  }

  /* ── 标签栏 ── */
  .tab-bar {
    display: flex;
    gap: 0;
    border-bottom: 1px solid #3a2a10;
    flex-shrink: 0;
    padding: 0 0.8rem;
  }

  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: #7a6a4a;
    font-size: 0.82rem;
    font-family: inherit;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 0.55rem 0.8rem;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    margin-bottom: -1px;
  }

  .tab:hover {
    color: #c8b070;
  }

  .tab-active {
    color: #d4a843;
    border-bottom-color: #d4a843;
  }

  /* ── 可滚动内容体 ── */
  .modal-body {
    overflow-y: auto;
    padding: 1rem 1.2rem 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* 自定义滚动条 */
  .modal-body::-webkit-scrollbar { width: 5px; }
  .modal-body::-webkit-scrollbar-track { background: transparent; }
  .modal-body::-webkit-scrollbar-thumb { background: #4a3a1a; border-radius: 3px; }

  .divider {
    height: 1px;
    background: linear-gradient(90deg, transparent, #4a3a1a 30%, #4a3a1a 70%, transparent);
    margin: 0.9rem 0;
  }

  /* ── section ── */
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .section-title {
    margin: 0;
    font-size: 0.82rem;
    color: #d4a843;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* ── 玩法说明：散文段落 ── */
  .prose {
    font-size: 0.87rem;
    color: #c8b888;
    line-height: 1.6;
    margin: 0;
  }

  .prose strong {
    color: #e8d8a0;
  }

  /* ── 玩法说明：要点列表 ── */
  .bullet-list {
    margin: 0;
    padding-left: 1.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    color: #c8b888;
    font-size: 0.87rem;
    line-height: 1.55;
  }

  /* ── 步骤列表 ── */
  .step-list {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }

  .step {
    display: flex;
    gap: 0.7rem;
    align-items: flex-start;
  }

  .step-num {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(212, 168, 67, 0.15);
    border: 1px solid rgba(212, 168, 67, 0.35);
    color: #d4a843;
    font-size: 0.75rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 0.05rem;
  }

  .step-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .step-body strong {
    font-size: 0.88rem;
    color: #e8d8a0;
  }

  .step-body p {
    margin: 0;
    font-size: 0.84rem;
    color: #b8a878;
    line-height: 1.5;
  }

  .sub-list {
    margin: 0.3rem 0 0;
    padding-left: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.83rem;
    color: #b8a878;
  }

  .choice {
    font-weight: 600;
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    font-size: 0.8rem;
  }

  .choice-continue {
    color: #7ec8e3;
    background: rgba(126, 200, 227, 0.1);
  }

  .choice-bank {
    color: #7ecf8a;
    background: rgba(126, 207, 138, 0.1);
  }

  /* ── 特殊情况卡片 ── */
  .special-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .special-item {
    display: flex;
    gap: 0.7rem;
    align-items: flex-start;
    padding: 0.65rem 0.8rem;
    border-radius: 8px;
    border: 1px solid transparent;
  }

  .special-item strong {
    font-size: 0.87rem;
    display: block;
    margin-bottom: 0.2rem;
  }

  .special-item p {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.5;
  }

  .special-item strong {
    color: #e8d8a0;
  }

  .special-hotdice {
    background: rgba(212, 120, 30, 0.08);
    border-color: rgba(212, 120, 30, 0.25);
  }

  .special-hotdice p {
    color: #c8a878;
  }

  .special-bust {
    background: rgba(160, 60, 60, 0.08);
    border-color: rgba(160, 60, 60, 0.25);
  }

  .special-bust p {
    color: #b88888;
  }

  .special-icon {
    font-size: 1.3rem;
    line-height: 1;
    flex-shrink: 0;
    margin-top: 0.05rem;
  }

  /* ── 本局配置网格 ── */
  .config-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.35rem 1rem;
  }

  .cfg-label {
    color: #8a7a5a;
    font-size: 0.88rem;
  }

  .cfg-val {
    color: #e8d8a0;
    font-size: 0.88rem;
    font-weight: 600;
  }

  /* ── 计分表格 ── */
  .score-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  .score-table th {
    color: #8a7a5a;
    font-weight: 600;
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-align: left;
    padding: 0 0.5rem 0.4rem;
    border-bottom: 1px solid #3a2a10;
  }

  .score-table th:last-child {
    text-align: right;
  }

  .score-table td {
    padding: 0.3rem 0.5rem;
    color: #d8c8a0;
  }

  .score-table td:last-child {
    text-align: right;
    color: #d4a843;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .score-table tbody tr:nth-child(even):not(.separator) {
    background: rgba(255, 200, 80, 0.03);
  }

  .score-table tbody tr:hover:not(.separator) {
    background: rgba(212, 168, 67, 0.06);
  }

  .score-table .separator td {
    padding: 0.2rem 0;
    border-bottom: 1px solid #2a1e08;
  }

  /* ── 移动端适配 ── */
  @media (max-width: 480px) {
    .panel {
      max-height: 92dvh;
    }
    .modal-header {
      padding: 0.85rem 1rem 0.75rem;
    }
    .modal-body {
      padding: 0.85rem 1rem 1.2rem;
    }
    .tab {
      font-size: 0.78rem;
      padding: 0.5rem 0.65rem;
    }
  }
</style>
