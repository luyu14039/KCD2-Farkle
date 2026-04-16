<script lang="ts">
  import { untrack } from 'svelte';
  import type { DieFace, DieType } from '$lib/game/types';
  import { getDieDefinition } from '$lib/game/diceRegistry';
  import DiceFace from './DiceFace.svelte';

  // ── Props ────────────────────────────────────────
  let {
    value    = 1 as DieFace,      // 目标面值（动画结束后显示）
    dieType  = 'NormalDie' as DieType,  // 骰子定义 ID
    rolling  = false,             // true → 触发滚动动画
    kept     = false,             // 骰子是否已被锁定
    selected = false,             // 骰子是否被玩家选中（待锁定）
    duration = 1200,              // 动画时长 ms
    onSettled,                    // 动画结束回调
  }: {
    value?:     DieFace;
    dieType?:   DieType;
    rolling?:   boolean;
    kept?:      boolean;
    selected?:  boolean;
    duration?:  number;
    onSettled?: () => void;
  } = $props();

  // ── 从注册表获取骰子信息 ──────────────────────────
  const dieDef = $derived(getDieDefinition(dieType));
  const hasWildcard = $derived(dieDef.wildcardFace !== undefined);
  const themeColor = $derived(dieDef.color);

  // ── 常量（根据骰子类型生成条带） ──────────────────
  const COPIES    = 8;   // 条带重复次数
  const FACE_H    = 80;  // px，需与 CSS 保持一致

  // 有百搭面的骰子条带包含 face=0；其余只含 1-6
  const STANDARD_ORDER: DieFace[] = [1, 2, 3, 4, 5, 6];
  const WILDCARD_ORDER: DieFace[] = [1, 2, 3, 4, 5, 6, 0];

  const faceOrder = $derived(hasWildcard ? WILDCARD_ORDER : STANDARD_ORDER);
  const numFaces  = $derived(faceOrder.length);
  const strip     = $derived(Array.from({ length: COPIES }, () => faceOrder).flat());

  function faceIndex(v: DieFace): number {
    const i = faceOrder.indexOf(v);
    return i === -1 ? 0 : i;
  }

  // ── 内部状态 ─────────────────────────────────────
  let stripEl:       HTMLDivElement | undefined = $state();
  let displayedFace: DieFace = untrack(() => value);
  let isAnimating    = $state(false);

  // ── 动画效果 ─────────────────────────────────────
  // 关键：isAnimating 仅写不读，不作为依赖，避免 settle() 触发二次动画
  $effect(() => {
    if (!rolling) {
      // 非掷骰状态：立即同步骰面到当前值（无动画）
      if (stripEl) {
        stripEl.style.transition = 'none';
        stripEl.style.transform  = `translateY(${-(faceIndex(value) * FACE_H)}px)`;
      }
      displayedFace = value;
      isAnimating   = false;
      return;
    }

    if (!stripEl) return;

    isAnimating = true;

    const targetFace = value; // 捕获当次目标
    const nf = numFaces;

    // 当前显示面在条带第一份副本中的等效位置（防止视觉跳变）
    const snapY = -(faceIndex(displayedFace) * FACE_H);

    // 随机自 3~5 圈后停在目标面
    const spinCycles = 3 + Math.floor(Math.random() * 3);
    const finalY = snapY - (spinCycles * nf + faceIndex(targetFace)) * FACE_H;

    // 1. 瞬移到等效位置（无过渡）
    stripEl.style.transition = 'none';
    stripEl.style.transform  = `translateY(${snapY}px)`;
    void stripEl.offsetHeight; // 强制重排

    // 2. 启动过渡动画
    stripEl.style.transition = `transform ${duration}ms cubic-bezier(0.17, 0.67, 0.35, 1.0)`;
    stripEl.style.transform  = `translateY(${finalY}px)`;

    let settled = false;
    function settle() {
      if (settled) return;
      settled = true;
      stripEl?.removeEventListener('transitionend', onEnd);
      displayedFace = targetFace;
      isAnimating   = false;
      onSettled?.();
    }

    function onEnd(e: TransitionEvent) {
      if (e.propertyName !== 'transform') return;
      settle();
    }

    stripEl.addEventListener('transitionend', onEnd);

    // 安全超时：如果 transitionend 未触发，强制结束
    const safetyTimer = setTimeout(settle, duration + 200);

    return () => {
      clearTimeout(safetyTimer);
      stripEl?.removeEventListener('transitionend', onEnd);
    };
  });
</script>

<div
  class="reel-viewport"
  class:kept={kept}
  class:selected={selected}
  class:rolling={rolling}
  class:special={dieType !== 'NormalDie'}
  style:--die-color={themeColor}
>
  <div class="reel-strip" bind:this={stripEl}>
    {#each strip as face}
      <div class="reel-face">
        <DiceFace value={face} />
      </div>
    {/each}
  </div>
</div>

<style>
  .reel-viewport {
    width:     80px;
    height:    80px;   /* 必须与 FACE_H 一致 */
    overflow:  hidden;
    border-radius:   10px;
    border:    2px solid #5a4a2a;
    background:      #2a1e0e;
    cursor:    pointer;
    transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s, opacity 0.2s;
    /* 骰子点数颜色：默认米白 */
    color: #f0e6c8;
    position: relative;
    user-select: none;
  }

  /* 普通悬停（未选中、未锁定）：轻微上浮 */
  .reel-viewport:hover:not(.kept):not(.selected) {
    transform: translateY(-2px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(212, 168, 67, 0.12);
    border-color: #7a6a3a;
  }

  /* 选中（待锁定）：金色高亮 + 放大 + 内发光 */
  .reel-viewport.selected {
    border-color: #d4a843;
    border-width: 2px;
    transform: scale(1.06);
    box-shadow:
      inset 0 0 10px rgba(212, 168, 67, 0.18),
      0 0 14px rgba(212, 168, 67, 0.55),
      0 0 0 1px rgba(212, 168, 67, 0.25);
    color: #d4a843;
  }

  /* 特殊骰子：使用定义中的主题色 */
  .reel-viewport.special {
    border-color: var(--die-color, #5a4a2a);
    box-shadow:   0 0 6px color-mix(in srgb, var(--die-color, #5a4a2a) 35%, transparent);
  }

  .reel-viewport.special.selected {
    border-color: var(--die-color, #d4a843);
    box-shadow:   0 0 12px color-mix(in srgb, var(--die-color, #d4a843) 60%, transparent);
  }

  /* 已锁定（kept）：压暗去饱和，不可再点击 */
  .reel-viewport.kept {
    border-color: #3a2e1a;
    background:   #1a1208;
    opacity:      0.65;
    filter:       saturate(0.35);
    cursor:       default;
  }

  .reel-strip {
    /* 初始位置：展示第一枚面（index 0 = 面值 1） */
    transform: translateY(0);
    will-change: transform;
    filter: none;
    transition: filter 0.3s ease-out;
  }

  /* 掷骰中：运动模糊效果 */
  .reel-viewport.rolling .reel-strip {
    filter: blur(0.7px);
  }

  .reel-face {
    width:  80px;
    height: 80px;  /* FACE_H */
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px;
  }
</style>
