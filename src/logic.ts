import {
  healthyMessages,
  healthyNightMessages,
  healthyAdultPhaseMessages,
} from './healthyMessages';

// 状態の型定義
export type Condition = 'healthy' | 'weak' | 'dead';

/** 最後の訪問からこの日数で、再訪を促す通知と弱り状態にする。 */
export const DAYS_UNTIL_INACTIVITY_REMINDER = 14;
/** 最後の訪問からこの日数で、死亡状態にする。 */
export const DAYS_UNTIL_DEATH = 30;

export interface AppState {
  startDate: string;
  lastVisitDate: string;
  lastGrowthDate: string;
  sizeFactor: number;
  /** 体長カウントの起点（経過秒 × GROWTH_CM_PER_SECOND で増加、上限 TARGET_CM） */
  growthAnchorMs: number;
  /** 表示・成長に用いる体長（cm）。1秒ごとに倍率を掛けて加算 */
  bodyLengthCm: number;
  /** 満腹度 0〜100 */
  fullness: number;
  /** ヌメリ度 0〜100 */
  viscosity: number;
  condition: Condition;
  latestLog: string;
  /** 達成演出済みマイルストーン ID */
  claimedMilestoneIds: string[];
  /** フォアグラウンド累計（導入フェーズ用・ms）。1秒あたりの加算は成長倍率に比例する */
  sessionForegroundMs: number;
  /** 最後に成長ティックを処理した時刻（オフライン追い込み用） */
  lastGrowthTickMs: number;
}

/** 目標体長（cm）。表示・画像スケールの上限の目安 */
export const GROWTH_TARGET_CM = 100;

/** 1 秒あたりの体長増分（cm）。固定値 */
export const GROWTH_CM_PER_SECOND = 0.00001;

/** 体長が TARGET_CM に達するまでの経過時間（ms）。MAX 表示テスト用アンカー計算に使う */
export const MS_TO_REACH_TARGET_LENGTH =
  (GROWTH_TARGET_CM / GROWTH_CM_PER_SECOND) * 1000;

/** 体長表示の桁数（0.00001 cm 単位＝小数第5位まで） */
export const GROWTH_CM_DISPLAY_DECIMALS = 5;

export const getOosanLengthCm = (growthAnchorMs: number, nowMs: number = Date.now()): number => {
  const elapsedMs = nowMs - growthAnchorMs;
  if (elapsedMs <= 0) return 0;
  const cm = (elapsedMs / 1000) * GROWTH_CM_PER_SECOND;
  return Math.min(GROWTH_TARGET_CM, cm);
};

/** 画像スケール用 0〜1（体長が TARGET_CM に達すると 1） */
export const getOosanGrowthProgress = (
  growthAnchorMs: number,
  nowMs: number = Date.now()
): number => {
  return getOosanLengthCm(growthAnchorMs, nowMs) / GROWTH_TARGET_CM;
};

/** 表示は GROWTH_CM_PER_SECOND（0.00001cm）の倍数に丸めてから表示 */
export const formatOosanLengthCm = (cm: number): string => {
  const units = Math.round(cm / GROWTH_CM_PER_SECOND);
  const snapped = units * GROWTH_CM_PER_SECOND;
  return snapped.toFixed(GROWTH_CM_DISPLAY_DECIMALS);
};

/** 夜間（19時〜翌6時） */
export const computeIsNight = (d: Date = new Date()): boolean => {
  const h = d.getHours();
  return h >= 19 || h < 6;
};

/**
 * 朝の UI 用（6時〜11時未満）。夜明けと同時に true になり、夜とは重ならない。
 */
export const computeIsMorning = (d: Date = new Date()): boolean => {
  const h = d.getHours();
  return h >= 6 && h < 11;
};

/**
 * 昼の UI 用（11時〜19時未満）。朝（6〜11）・夜（19〜6）と重ならない。
 */
export const computeIsDaytime = (d: Date = new Date()): boolean => {
  const h = d.getHours();
  return h >= 11 && h < 19;
};

/** 夜間時のケア倍率（既定 1.18）。デバッグ用に 1.5 などを上書き可能 */
export const DEFAULT_NIGHT_CARE_MULTIPLIER = 1.18;

/**
 * 満腹・ヌメリ・夜間ボーナスから成長倍率（表示用・1秒加算に使用）
 * おなか・ヌメリが空に近いときは x1 を基準にし、高いほど上乗せ（両方100%で昼おおよそ x3）。
 * 夜間はその上に nightCareMultiplier を掛ける。
 */
export const computeGrowthMultiplier = (
  fullness: number,
  viscosity: number,
  isNight: boolean,
  nightCareMultiplier: number = DEFAULT_NIGHT_CARE_MULTIPLIER
): number => {
  const f = Math.max(0, Math.min(1, fullness / 100));
  const v = Math.max(0, Math.min(1, viscosity / 100));
  const care = 1 + f + v;
  const night = isNight ? nightCareMultiplier : 1;
  return Math.round(care * night * 1000) / 1000;
};

export const formatGrowthMultiplier = (m: number): string => `x${m.toFixed(2)}`;

/** この体長から、赤ちゃんの姿ではなく成体の姿を表示する。 */
export const ADULT_OOSAN_MIN_LENGTH_CM = 20;

export const getGrowthPhaseLabel = (bodyLengthCm: number): string =>
  bodyLengthCm < ADULT_OOSAN_MIN_LENGTH_CM ? '幼生期（外鰓あり）' : '成体（ヌシへの道）';

/** 満腹度バー色（緑→黄→赤） */
export const fullnessBarColor = (fullness: number): string => {
  if (fullness >= 60) return '#4caf50';
  if (fullness >= 30) return '#ffeb3b';
  return '#f44336';
};

// 初期状態を生成
export const createInitialState = (): AppState => {
  const today = new Date().toISOString().split('T')[0];
  const now = Date.now();
  return {
    startDate: today,
    lastVisitDate: today,
    lastGrowthDate: today,
    sizeFactor: 1.0,
    growthAnchorMs: now,
    bodyLengthCm: 0,
    fullness: 92,
    viscosity: 92,
    condition: 'healthy',
    latestLog: '川の底で静かに過ごしています。',
    claimedMilestoneIds: [],
    sessionForegroundMs: 0,
    lastGrowthTickMs: now,
  };
};

/**
 * デバッグで体長を上書きするときに更新するフィールドだけを揃える。
 * 次の目標（体長・sessionForegroundMs・claimed）と 1 秒ティック（アンカー・lastGrowthTick）が噛み合うようにする。
 * startDate・満腹・ログなどそれ以外は据え置き。
 */
export function patchStateForDebugBodyLengthCm(
  s: AppState,
  bodyLengthCm: number,
  atMs: number = Date.now()
): AppState {
  const clamped = Math.max(0, Math.min(GROWTH_TARGET_CM, bodyLengthCm));
  const sessionForegroundMs =
    clamped <= 0 ? 0 : Math.round((clamped / GROWTH_CM_PER_SECOND) * 1000);
  return {
    ...s,
    bodyLengthCm: clamped,
    claimedMilestoneIds: [],
    sessionForegroundMs,
    growthAnchorMs: atMs,
    lastGrowthTickMs: atMs,
  };
}

/** セーブデータを現在の AppState 形に合わせる */
export const migrateAppState = (raw: Partial<AppState> & Record<string, unknown>): AppState => {
  const base = createInitialState();
  const { lastFeedOrWaterMs: _legacyLfw, ...rawSansLegacy } = raw as Partial<AppState> & {
    lastFeedOrWaterMs?: unknown;
  };
  void _legacyLfw;
  const merged: AppState = {
    ...base,
    ...(rawSansLegacy as AppState),
  };
  if (typeof raw.bodyLengthCm !== 'number' || !Number.isFinite(raw.bodyLengthCm)) {
    merged.bodyLengthCm = getOosanLengthCm(merged.growthAnchorMs);
  }
  if (typeof raw.fullness !== 'number' || !Number.isFinite(raw.fullness)) {
    merged.fullness = base.fullness;
  }
  if (typeof raw.viscosity !== 'number' || !Number.isFinite(raw.viscosity)) {
    merged.viscosity = base.viscosity;
  }
  if (Array.isArray(raw.claimedMilestoneIds)) {
    merged.claimedMilestoneIds = raw.claimedMilestoneIds.filter(
      (x): x is string => typeof x === 'string'
    );
  } else {
    merged.claimedMilestoneIds = [];
  }
  if (typeof raw.sessionForegroundMs !== 'number' || !Number.isFinite(raw.sessionForegroundMs)) {
    merged.sessionForegroundMs = 0;
  }
  if (typeof raw.lastGrowthTickMs !== 'number' || !Number.isFinite(raw.lastGrowthTickMs)) {
    merged.lastGrowthTickMs = Date.now();
  }
  return merged;
};

// 日付の差分を計算（日数）
export const getDaysDiff = (date1: string, date2: string): number => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

/**
 * バックグラウンド目標: おなか 100→0 を約 12h、ヌメリを約 24h。
 * App.tsx の FULLNESS_SECONDS_PER_ONE_PERCENT=15・VISCOSITY_SECONDS_PER_ONE_PERCENT=30 と整合（いずれも 5/144）。
 */
const BG_EMPTY_FULLNESS_H = 12;
const BG_FULLNESS_SEC_PER_ONE_PERCENT = 15;

export const GAUGE_DECAY_MULT_BACKGROUND_STABLE =
  (100 / (BG_EMPTY_FULLNESS_H * 3600)) / (1 / BG_FULLNESS_SEC_PER_ONE_PERCENT);

/** startDate からこの暦日数未満はバックグラウンド減少を EARLY_CARE_BG_EXTRA_MULT 倍（お世話間隔が約半分） */
export const EARLY_CARE_BG_DAYS = 3;
export const EARLY_CARE_BG_EXTRA_MULT = 2;

/**
 * バックグラウンド／オフライン相当のゲージ減少に掛ける倍率（1 秒あたりの基準減少量に乗算）
 */
export function backgroundGaugeDecayMultiplier(state: AppState, atMs: number): number {
  const dayStr = new Date(atMs).toISOString().split('T')[0];
  const daysSinceStart = getDaysDiff(state.startDate, dayStr);
  const early = daysSinceStart < EARLY_CARE_BG_DAYS;
  return GAUGE_DECAY_MULT_BACKGROUND_STABLE * (early ? EARLY_CARE_BG_EXTRA_MULT : 1);
}

// 成長判定と更新
export const processGrowth = (state: AppState): AppState => {
  const today = new Date().toISOString().split('T')[0];
  
  // 今日すでに成長処理済みなら何もしない
  if (state.lastGrowthDate === today) {
    return state;
  }

  // healthy のときのみ成長
  if (state.condition === 'healthy') {
    // 0.1% 〜 0.3% のランダムな成長
    const growthRate = 1.0 + (Math.random() * 0.002 + 0.001);
    return {
      ...state,
      sizeFactor: state.sizeFactor * growthRate,
      lastGrowthDate: today,
    };
  }

  return {
    ...state,
    lastGrowthDate: today,
  };
};

// 放置状態の判定と更新
export const processCondition = (state: AppState): AppState => {
  const today = new Date().toISOString().split('T')[0];
  const daysSinceVisit = getDaysDiff(state.lastVisitDate, today);

  let newCondition: Condition = state.condition;

  if (daysSinceVisit >= DAYS_UNTIL_DEATH) {
    newCondition = 'dead';
  } else if (daysSinceVisit >= DAYS_UNTIL_INACTIVITY_REMINDER) {
    newCondition = 'weak';
  } else {
    newCondition = 'healthy';
  }

  return {
    ...state,
    condition: newCondition,
    lastVisitDate: today,
  };
};

/**
 * healthy 用の日次ログ候補を組み立て、直前の latestLog と同じ文言は避けて 1 件選ぶ。
 * （インデックスではなく文言で比較し、プール構成が変わっても安全に連続回避する）
 */
export const pickHealthyDailyLogMessage = (
  state: Pick<AppState, 'bodyLengthCm' | 'latestLog'>,
  at: Date = new Date()
): string => {
  const pool: string[] = [...healthyMessages];
  if (computeIsNight(at)) {
    pool.push(...healthyNightMessages);
  }
  if (state.bodyLengthCm > 20) {
    pool.push(...healthyAdultPhaseMessages);
  }
  const uniq = [...new Set(pool)];
  let candidates = uniq;
  const prev = state.latestLog;
  if (prev && candidates.includes(prev) && candidates.length > 1) {
    candidates = candidates.filter((m) => m !== prev);
  }
  return candidates[Math.floor(Math.random() * candidates.length)]!;
};

// 日次ログを生成（at はテスト・再現用。省略時は現在時刻）
export const generateDailyLog = (state: AppState, at: Date = new Date()): string => {
  const daysSinceStart = getDaysDiff(state.startDate, state.lastVisitDate);
  
  if (state.condition === 'dead') {
    return '静かな川の流れだけが残っています。';
  }
  
  if (state.condition === 'weak') {
    const messages = [
      '今日も静かに過ごしています。',
      'ゆっくりと時間が流れています。',
      '川の音が聞こえます。',
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  // healthy
  if (daysSinceStart === 0) {
    return '新しい住処を見つけました。';
  }

  return pickHealthyDailyLogMessage(state, at);
};
