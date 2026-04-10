<script lang="ts">
  import { onDestroy } from 'svelte';
  import { commentary } from '$lib/stores/gameStore';

  type Bubble = {
    text: string;
    speaker: string;
    key: number;
    visible: boolean;
    duration: number;
  };

  /** 同屏最多气泡数（群体惊呼时三条同现） */
  const MAX_BUBBLES = 3;
  /** 事件旁白默认停留时间（ms） */
  const DEFAULT_DURATION = 5000;
  /** 滑出过渡时长，需与 CSS transition 保持一致 */
  const FADE_OUT_MS = 380;

  let bubbles = $state<Bubble[]>([]);

  const unsub = commentary.subscribe(v => {
    if (!v) return;
    // 去重
    if (bubbles.find(b => b.key === v.key)) return;
    // 满员时挤掉最旧的一条（即时移除，让新旁白取而代之）
    const base = bubbles.length >= MAX_BUBBLES ? bubbles.slice(1) : bubbles;

    const duration = v.duration ?? DEFAULT_DURATION;
    const bubble: Bubble = {
      text: v.text,
      speaker: v.speaker,
      key: v.key,
      visible: false,
      duration,
    };
    bubbles = [...base, bubble];

    // 等 DOM 更新后触发入场动画
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        bubbles = bubbles.map(b =>
          b.key === v.key ? { ...b, visible: true } : b
        );
      })
    );

    // 自动离场
    setTimeout(() => dismiss(v.key), duration);
  });

  onDestroy(unsub);

  function dismiss(key: number) {
    // 触发滑出动画
    bubbles = bubbles.map(b => (b.key === key ? { ...b, visible: false } : b));
    // 动画结束后从 DOM 移除
    setTimeout(() => {
      bubbles = bubbles.filter(b => b.key !== key);
    }, FADE_OUT_MS);
  }
</script>

<!--
  气泡堆：底部右对齐，新条目追加到末尾（视觉上在最下方），
  旧条目自然向上浮。每条独立计时，互不干扰。
-->
<div class="bubble-stack" aria-live="polite" aria-label="旁观者旁白">
  {#each bubbles as b (b.key)}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
    <aside class="bubble" class:visible={b.visible} onclick={() => dismiss(b.key)} title="点击关闭">
      <button class="bubble-close" onclick={(e) => { e.stopPropagation(); dismiss(b.key); }} aria-label="关闭旁白">×</button>
      <div class="speaker">{b.speaker}</div>
      <p class="text">{b.text}</p>
    </aside>
  {/each}
</div>

<style>
  /* 容器：固定在右下角，flex 列排列，子项右对齐（宽度自适应） */
  .bubble-stack {
    position: fixed;
    bottom: 9rem;
    right: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    align-items: flex-end;
    z-index: 300;
    max-width: 215px;
  }

  /* 单条气泡 */
  .bubble {
    position: relative;
    width: 100%;
    background: linear-gradient(150deg, #2e2010 0%, #1a1008 100%);
    border: 1px solid #4a3418;
    border-left: 3px solid #d4a843;
    border-radius: 8px;
    padding: 0.6rem 1.6rem 0.6rem 0.8rem;
    color: #e8d8b0;
    font-size: 0.81rem;
    line-height: 1.55;
    box-shadow:
      0 4px 18px rgba(0, 0, 0, 0.65),
      inset 0 1px 0 rgba(212, 168, 67, 0.07);
    /* 初始：滑至右侧屏幕外 + 透明 */
    transform: translateX(calc(100% + 1.4rem));
    opacity: 0;
    transition:
      transform 0.36s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.36s ease-out;
    cursor: pointer;
  }

  /* 可见态：归位 */
  .bubble.visible {
    transform: translateX(0);
    opacity: 1;
  }

  .bubble:hover {
    border-left-color: #e8bf5a;
  }

  /* 关闭按钮（右上角） */
  .bubble-close {
    position: absolute;
    top: 0.25rem;
    right: 0.3rem;
    width: 18px;
    height: 18px;
    padding: 0;
    background: none;
    border: none;
    color: #5a4a2a;
    font-size: 0.85rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    transition: color 0.12s, background 0.12s;
    font-family: inherit;
  }

  .bubble-close:hover {
    color: #d4a843;
    background: rgba(212, 168, 67, 0.12);
  }

  .speaker {
    font-size: 0.67rem;
    color: #d4a843;
    font-weight: 700;
    margin-bottom: 0.25rem;
    letter-spacing: 0.06em;
  }

  .text {
    margin: 0;
    font-style: italic;
    color: #e0d0a8;
  }

  @media (max-width: 480px) {
    .bubble-stack {
      max-width: 170px;
      bottom: 11rem;
      right: 0.5rem;
    }
    .bubble {
      font-size: 0.76rem;
    }
  }
</style>
