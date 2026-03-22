// 状態の型定義
export type Condition = 'healthy' | 'weak' | 'dead';

export interface AppState {
  startDate: string;
  lastVisitDate: string;
  lastGrowthDate: string;
  sizeFactor: number;
  /** 体長カウントの起点（経過秒 × GROWTH_CM_PER_SECOND で増加、上限 TARGET_CM） */
  growthAnchorMs: number;
  condition: Condition;
  latestLog: string;
}

/** 目標体長（cm）。表示・画像スケールの上限の目安 */
export const GROWTH_TARGET_CM = 100;

/** 1 秒あたりの体長増分（cm）。固定値 */
export const GROWTH_CM_PER_SECOND = 0.00001;

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

// 初期状態を生成
export const createInitialState = (): AppState => {
  const today = new Date().toISOString().split('T')[0];
  return {
    startDate: today,
    lastVisitDate: today,
    lastGrowthDate: today,
    sizeFactor: 1.0,
    growthAnchorMs: Date.now(),
    condition: 'healthy',
    latestLog: '川の底で静かに過ごしています。',
  };
};

// 日付の差分を計算（日数）
export const getDaysDiff = (date1: string, date2: string): number => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

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

  if (daysSinceVisit >= 7) {
    newCondition = 'dead';
  } else if (daysSinceVisit >= 3) {
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

// 日次ログを生成
export const generateDailyLog = (state: AppState): string => {
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

  const messages = [
    '今日も静かに過ごしています。',
    'ゆっくりと成長しています。',
    '川の流れに身を任せています。',
    '岩の陰で休んでいます。',
    '水草の間を泳いでいます。',
  ];

  return messages[Math.floor(Math.random() * messages.length)];
};
