// 状態の型定義
export type Condition = 'healthy' | 'weak' | 'dead';

export interface AppState {
  startDate: string;
  lastVisitDate: string;
  lastGrowthDate: string;
  sizeFactor: number;
  condition: Condition;
  latestLog: string;
}

// 初期状態を生成
export const createInitialState = (): AppState => {
  const today = new Date().toISOString().split('T')[0];
  return {
    startDate: today,
    lastVisitDate: today,
    lastGrowthDate: today,
    sizeFactor: 1.0,
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
