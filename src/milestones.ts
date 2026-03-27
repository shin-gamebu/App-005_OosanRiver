import type { AppState } from './logic';
import {
  GROWTH_CM_PER_SECOND,
  GROWTH_TARGET_CM,
  backgroundGaugeDecayMultiplier,
  computeGrowthMultiplier,
  computeIsNight,
  formatOosanLengthCm,
} from './logic';

export type MilestoneTier = 'low' | 'medium' | 'high' | 'banner';

export type MilestonePhase = 'intro' | 'hourly' | 'slowlife';

export interface MilestoneDef {
  id: string;
  targetCm: number;
  name: string;
  tier: MilestoneTier;
  phase: MilestonePhase;
  /** 導入フェーズ: この秒数のフォアグラウンド累計が必要 */
  sessionSec?: number;
}

const MS_HOUR = 60 * 60 * 1000;
const MS_DAY = 24 * MS_HOUR;

/** 導入最終マイルストーンの体長（cm）。ここから中期ステップが始まる */
const INTRO_LAST_TARGET_CM = 0.006;
/** hour 系マイルストーン：各ステップの体長増分（cm）。x1 成長で約1時間ぶん */
const HOURLY_STEP_CM = 0.036;
/** 導入終了後〜はじまりから約24時間のあいだに順に現れるマイルストーン数 */
const HOURLY_MILESTONE_COUNT = 23;

/** hour_* の表示名（各1つずつ計23） */
const HOURLY_MILESTONE_NAMES: readonly string[] = [
  '一滴の誓い',
  'ふたつの波紋',
  '水底の目覚め',
  '岩陰の胎動',
  '静寂の伸び',
  'せせらぎの杯',
  '深淵の手前',
  '冷たい帯のなか',
  '川霧の仮面',
  '波紋の系譜',
  'ひとすじの前進',
  '水面の刃',
  '石床の鼓動',
  '吸う息のあいだ',
  '淀みを裂いて',
  '兆しの脈打ち',
  '透明の帰依',
  '淵のささやき',
  '重なる潮流',
  '暁前の潜み',
  '満ち寄るひととき',
  'うねりの証明',
  'はじまり一日の約束',
];

/** オフライン達成まとめ：この件数以上ならモーダルを分割 */
export const OFFLINE_BACKLOG_SPLIT_THRESHOLD = 10;
/** 分割時の1画面あたりの最大件数 */
export const OFFLINE_BACKLOG_PAGE_SIZE = 9;

function hourlyMilestoneDisplayName(k: number): string {
  const n = HOURLY_MILESTONE_NAMES[k - 1];
  return n != null && n !== '' ? n : `刻の一歩 ${k}`;
}

/** 「あと約N秒」… 日・時間・分への換算つき（括弧内にそのまま入れる用） */
function formatSecondsEstimateClause(secTotal: number): string {
  if (secTotal >= 86400) {
    return `あと約${secTotal.toLocaleString()}秒 ≒ ${(secTotal / 86400).toFixed(1)}日`;
  }
  if (secTotal >= 3600) {
    return `あと約${secTotal}秒 ≒ ${(secTotal / 3600).toFixed(1)}時間`;
  }
  if (secTotal >= 60) {
    return `あと約${secTotal}秒 ≒ ${Math.round(secTotal / 60)}分`;
  }
  return `あと約${secTotal}秒`;
}

/** 体長のみのマイルストーン用：残り cm を HUD と同じ成長倍率で割った秒の目安 */
function formatGrowthDurationHint(remCm: number, growthMultiplier: number): string {
  if (!(growthMultiplier > 1e-12) || remCm <= 0) return '';
  const cmPerSec = GROWTH_CM_PER_SECOND * growthMultiplier;
  const secTotal = Math.ceil(remCm / cmPerSec);
  if (!Number.isFinite(secTotal) || secTotal <= 0) return '';
  return `（今の成長ペースで ${formatSecondsEstimateClause(secTotal)}）`;
}

/** 導入：画面を開く秒と体長到達秒の遅い方を1つにまとめる */
function introUnifiedOpenAppHint(
  remCm: number,
  sessionRemainMs: number,
  growthMultiplier?: number
): string {
  const sessionWall =
    sessionRemainMs > 0
      ? sessionForegroundWallClockSecRemain(sessionRemainMs, growthMultiplier)
      : 0;

  if (sessionWall <= 0) {
    const gh =
      growthMultiplier != null
        ? formatGrowthDurationHint(remCm, growthMultiplier)
        : '';
    return gh !== '' ? gh : '（あとは体長の成長を待とう）';
  }

  let growthSec = 0;
  if (growthMultiplier != null && growthMultiplier > 1e-12 && remCm > 0) {
    const sec = Math.ceil(remCm / (GROWTH_CM_PER_SECOND * growthMultiplier));
    if (Number.isFinite(sec) && sec > 0) growthSec = sec;
  }

  const eta = growthSec > 0 ? Math.max(sessionWall, growthSec) : sessionWall;
  return `（${formatSecondsEstimateClause(eta)}ほど 画面を開いていれば達成の目安）`;
}

/**
 * 前景では sessionForegroundMs に 1 秒あたり 1000×成長倍率 が加わる。
 * 残り ms を「このペースであと何秒ほど開いていればよいか」の実時間秒に換算する。
 */
function sessionForegroundWallClockSecRemain(
  sessionRemainMs: number,
  growthMultiplier?: number
): number {
  if (sessionRemainMs <= 0) return 0;
  const mult =
    growthMultiplier != null && growthMultiplier > 1e-12
      ? growthMultiplier
      : 1;
  return Math.max(1, Math.ceil(sessionRemainMs / (1000 * mult)));
}

/**
 * オフライン達成一覧をモーダル用にページ分割する。
 * 件数が閾値未満なら 1 ページにまとめる。
 */
export function paginateOfflineBacklog(items: MilestoneDef[]): MilestoneDef[][] {
  if (items.length < OFFLINE_BACKLOG_SPLIT_THRESHOLD) {
    return items.length === 0 ? [] : [items];
  }
  const pages: MilestoneDef[][] = [];
  for (let i = 0; i < items.length; i += OFFLINE_BACKLOG_PAGE_SIZE) {
    pages.push(items.slice(i, i + OFFLINE_BACKLOG_PAGE_SIZE));
  }
  return pages;
}

/** アプリ開始から実時間 24 時間未満なら hourly 系の補助ラベルを出す目安 */
export function isWithinFirst24hWallClock(state: AppState, nowMs: number): boolean {
  return nowMs - state.growthAnchorMs < MS_DAY;
}

export function buildMilestoneList(): MilestoneDef[] {
  const list: MilestoneDef[] = [];

  list.push({
    id: 'intro_cell',
    targetCm: 0.0006,
    name: '細胞の目覚め',
    tier: 'medium',
    phase: 'intro',
    sessionSec: 60,
  });
  list.push({
    id: 'intro_pulse',
    targetCm: 0.003,
    name: '微かな鼓動',
    tier: 'medium',
    phase: 'intro',
    sessionSec: 300,
  });
  list.push({
    id: 'intro_step',
    targetCm: 0.006,
    name: '小さな一歩',
    tier: 'high',
    phase: 'intro',
    sessionSec: 600,
  });

  for (let k = 1; k <= HOURLY_MILESTONE_COUNT; k++) {
    list.push({
      id: `hour_${k}`,
      targetCm: INTRO_LAST_TARGET_CM + k * HOURLY_STEP_CM,
      name: hourlyMilestoneDisplayName(k),
      tier: 'banner',
      phase: 'hourly',
    });
  }

  list.push({
    id: 'slowlife_1cm',
    targetCm: 1.0,
    name: '1cmの大台突破',
    tier: 'high',
    phase: 'slowlife',
  });

  const slowNames = [
    '2日目の試練',
    '3日目の休息',
    '4日目の揺らぎ',
    '5日目の流域',
    '6日目の静けさ',
    '7日目の約束',
    '8日目の深み',
    '9日目の水面',
    '10日目の流れ',
    '11日目の石陰',
    '12日目の朝',
    '13日目の夕',
    '14日目の夢',
  ];
  let cm = 1.0 + 0.864;
  for (let i = 0; i < slowNames.length; i++) {
    list.push({
      id: `slowlife_day_${i + 2}`,
      targetCm: cm,
      name: slowNames[i]!,
      tier: i % 4 === 0 ? 'high' : 'medium',
      phase: 'slowlife',
    });
    cm += 0.864;
  }

  return list.sort((a, b) => a.targetCm - b.targetCm || a.id.localeCompare(b.id));
}

let _cachedList: MilestoneDef[] | null = null;

export function getAllMilestones(): MilestoneDef[] {
  if (!_cachedList) _cachedList = buildMilestoneList();
  return _cachedList;
}

export function milestoneQualifies(m: MilestoneDef, s: AppState, nowMs: number): boolean {
  if (s.bodyLengthCm + 1e-12 < m.targetCm) return false;
  if (m.phase === 'intro' && m.sessionSec != null) {
    return s.sessionForegroundMs >= m.sessionSec * 1000;
  }
  return true;
}

/** 直前状態→現在状態で新たに満たしたマイルストーン（未クレームのみ） */
export function findNewlyCompletedMilestones(
  prev: AppState,
  next: AppState,
  nowMs: number
): MilestoneDef[] {
  const claimed = new Set(next.claimedMilestoneIds);
  const out: MilestoneDef[] = [];
  for (const m of getAllMilestones()) {
    if (claimed.has(m.id)) continue;
    if (milestoneQualifies(m, next, nowMs) && !milestoneQualifies(m, prev, nowMs)) {
      out.push(m);
    }
  }
  return out.sort((a, b) => a.targetCm - b.targetCm);
}

/** オフライン後など、既に条件を満たしているが未クレームのものをまとめて取得 */
export function findBackloggedMilestones(s: AppState, nowMs: number): MilestoneDef[] {
  const claimed = new Set(s.claimedMilestoneIds);
  const out: MilestoneDef[] = [];
  for (const m of getAllMilestones()) {
    if (claimed.has(m.id)) continue;
    if (milestoneQualifies(m, s, nowMs)) out.push(m);
  }
  return out.sort((a, b) => a.targetCm - b.targetCm);
}

export function getNextMilestoneLine(
  s: AppState,
  nowMs: number,
  /** 省略時は秒目安なし。HUD の成長倍率と同じ値を渡すと体長のみの目標に秒が付く */
  growthMultiplier?: number
): { line: string; targetCm: number; name: string } | null {
  const claimed = new Set(s.claimedMilestoneIds);
  for (const m of getAllMilestones()) {
    if (claimed.has(m.id)) continue;
    if (milestoneQualifies(m, s, nowMs)) continue;
    const needSession = m.phase === 'intro' && m.sessionSec != null;
    const bodyOk = s.bodyLengthCm + 1e-12 >= m.targetCm;
    if (needSession && !bodyOk) {
      const rem = Math.max(0, m.targetCm - s.bodyLengthCm);
      const sessionRemainMs = Math.max(0, m.sessionSec! * 1000 - s.sessionForegroundMs);
      const unifiedHint = introUnifiedOpenAppHint(rem, sessionRemainMs, growthMultiplier);
      return {
        line: `次の目標：${m.name} まで あと ${formatOosanLengthCm(rem)} cm${unifiedHint}`,
        targetCm: m.targetCm,
        name: m.name,
      };
    }
    if (needSession && bodyOk) {
      const secLeft = Math.max(0, m.sessionSec! * 1000 - s.sessionForegroundMs);
      const sec = sessionForegroundWallClockSecRemain(secLeft, growthMultiplier);
      return {
        line: `次の目標：${m.name} … あと約${sec}秒ほど（開きっぱなしで）`,
        targetCm: m.targetCm,
        name: m.name,
      };
    }
    const rem = Math.max(0, m.targetCm - s.bodyLengthCm);
    const timeHint =
      growthMultiplier != null
        ? formatGrowthDurationHint(rem, growthMultiplier)
        : '';
    return {
      line: `次の目標：${m.name} まで あと ${formatOosanLengthCm(rem)} cm${timeHint}`,
      targetCm: m.targetCm,
      name: m.name,
    };
  }
  return null;
}

export function hourlyGoalLabel(state: AppState, nowMs: number): string | null {
  if (!isWithinFirst24hWallClock(state, nowMs)) return null;
  const elapsedH = Math.floor((nowMs - state.growthAnchorMs) / MS_HOUR);
  if (elapsedH < 1) return null;
  for (let k = Math.max(1, elapsedH); k <= HOURLY_MILESTONE_COUNT; k++) {
    const target = INTRO_LAST_TARGET_CM + k * HOURLY_STEP_CM;
    if (target > state.bodyLengthCm + 1e-12) {
      return `次の成長目標：${formatOosanLengthCm(target)} cm`;
    }
  }
  return null;
}

const MAX_OFFLINE_STEP_MS = 14 * MS_DAY;
const SIM_STEP_MS = 60_000;

/**
 * オフライン中の成長・満腹・ヌメリ減少をまとめて反映（1分刻みシミュレーション）。
 * ゲージ減少は各ステップ時刻で backgroundGaugeDecayMultiplier（12h/24h 目安・初日ブースト）を掛ける。
 */
export function applyOfflineCatchUp(
  state: AppState,
  nowMs: number,
  fullnessDecayPerSecBase: number,
  viscosityDecayPerSecBase: number
): AppState {
  if (state.condition === 'dead') {
    return { ...state, lastGrowthTickMs: nowMs };
  }
  const from = Math.min(state.lastGrowthTickMs, nowMs);
  let delta = nowMs - from;
  if (delta < 2000) {
    return { ...state, lastGrowthTickMs: nowMs };
  }
  delta = Math.min(delta, MAX_OFFLINE_STEP_MS);

  let s = { ...state };
  let t = 0;
  while (t + SIM_STEP_MS <= delta) {
    t += SIM_STEP_MS;
    const stepMs = from + t;
    const d = new Date(stepMs);
    const night = computeIsNight(d);
    const mult = computeGrowthMultiplier(s.fullness, s.viscosity, night);
    const sec = SIM_STEP_MS / 1000;
    const bgm = backgroundGaugeDecayMultiplier(s, stepMs);
    s.bodyLengthCm = Math.min(
      GROWTH_TARGET_CM,
      s.bodyLengthCm + GROWTH_CM_PER_SECOND * mult * sec
    );
    s.fullness = Math.max(0, s.fullness - fullnessDecayPerSecBase * bgm * sec);
    s.viscosity = Math.max(0, s.viscosity - viscosityDecayPerSecBase * bgm * sec);
  }

  const remMs = delta - t;
  if (remMs >= 1000) {
    const sec = remMs / 1000;
    const tailMs = from + delta;
    const d = new Date(tailMs);
    const night = computeIsNight(d);
    const mult = computeGrowthMultiplier(s.fullness, s.viscosity, night);
    const bgm = backgroundGaugeDecayMultiplier(s, tailMs);
    s.bodyLengthCm = Math.min(
      GROWTH_TARGET_CM,
      s.bodyLengthCm + GROWTH_CM_PER_SECOND * mult * sec
    );
    s.fullness = Math.max(0, s.fullness - fullnessDecayPerSecBase * bgm * sec);
    s.viscosity = Math.max(0, s.viscosity - viscosityDecayPerSecBase * bgm * sec);
  }

  s.lastGrowthTickMs = nowMs;
  return s;
}
