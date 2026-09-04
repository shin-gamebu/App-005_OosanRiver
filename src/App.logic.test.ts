import {
  healthyMessages,
  healthyNightMessages,
  healthyAdultPhaseMessages,
} from './healthyMessages';
import {
  createInitialState,
  getDaysDiff,
  processGrowth,
  processCondition,
  generateDailyLog,
  pickHealthyDailyLogMessage,
  getOosanGrowthProgress,
  getOosanLengthCm,
  formatOosanLengthCm,
  GROWTH_CM_PER_SECOND,
  GROWTH_TARGET_CM,
  MS_TO_REACH_TARGET_LENGTH,
  computeGrowthMultiplier,
  formatGrowthMultiplier,
  getGrowthPhaseLabel,
  migrateAppState,
  patchStateForDebugBodyLengthCm,
  computeIsNight,
  computeIsMorning,
  computeIsDaytime,
  AppState,
  GAUGE_DECAY_MULT_BACKGROUND_STABLE,
  EARLY_CARE_BG_DAYS,
  EARLY_CARE_BG_EXTRA_MULT,
  backgroundGaugeDecayMultiplier,
} from './logic';
import {
  paginateOfflineBacklog,
  OFFLINE_BACKLOG_PAGE_SIZE,
  OFFLINE_BACKLOG_SPLIT_THRESHOLD,
  getNextMilestoneLine,
} from './milestones';

describe('ロジック関数のテスト', () => {
  describe('getNextMilestoneLine + growthMultiplier', () => {
    test('スローライフの次の目標も渡した成長倍率で秒・日を計算する', () => {
      const s = patchStateForDebugBodyLengthCm(createInitialState(), 1, 1000);
      const line = getNextMilestoneLine(s, 1000, 0.25);
      expect(line).not.toBeNull();
      expect(line!.name).toBe('2日目の試練');
      expect(line!.line).toMatch(/今の成長ペース/);
      // あと 0.864 cm、倍率 0.25 → 0.864 / (0.00001×0.25) = 345600 秒 ≒ 4.0 日
      expect(line!.line).toMatch(/345[,.]?600/);
      expect(line!.line).toMatch(/4\.0日/);
    });

    test('倍率を渡さないときは秒目安なし', () => {
      const s = patchStateForDebugBodyLengthCm(createInitialState(), 1, 1000);
      const line = getNextMilestoneLine(s, 1000);
      expect(line!.line).not.toMatch(/今の成長ペース/);
    });
  });

  describe('patchStateForDebugBodyLengthCm', () => {
    test('体長・セッション・アンカー・クレームをまとめて揃える', () => {
      const base = createInitialState();
      const t = 1_700_000_000_000;
      const s: AppState = {
        ...base,
        bodyLengthCm: 50,
        claimedMilestoneIds: ['intro_cell'],
        sessionForegroundMs: 999_000,
        growthAnchorMs: t - 50_000,
        lastGrowthTickMs: t - 1000,
      };
      const n = patchStateForDebugBodyLengthCm(s, 1, t);
      expect(n.bodyLengthCm).toBe(1);
      expect(n.claimedMilestoneIds).toEqual([]);
      expect(n.sessionForegroundMs).toBe(Math.round((1 / GROWTH_CM_PER_SECOND) * 1000));
      expect(n.growthAnchorMs).toBe(t);
      expect(n.lastGrowthTickMs).toBe(t);
      expect(n.fullness).toBe(s.fullness);
      expect(n.latestLog).toBe(s.latestLog);
    });

    test('0cm でセッションは 0', () => {
      const n = patchStateForDebugBodyLengthCm(createInitialState(), 0, 123);
      expect(n.bodyLengthCm).toBe(0);
      expect(n.sessionForegroundMs).toBe(0);
    });
  });

  describe('MS_TO_REACH_TARGET_LENGTH', () => {
    test('100cm 到達に必要な経過 ms（0.00001cm/s）', () => {
      expect(MS_TO_REACH_TARGET_LENGTH).toBe(10_000_000_000);
    });
  });

  describe('getOosanLengthCm / getOosanGrowthProgress', () => {
    test('固定レート 0.00001 cm/s、上限 TARGET_CM', () => {
      const t0 = 1_000_000_000_000;
      expect(getOosanLengthCm(t0, t0)).toBe(0);
      expect(getOosanGrowthProgress(t0, t0)).toBe(0);
      expect(getOosanLengthCm(t0, t0 + 1000)).toBeCloseTo(GROWTH_CM_PER_SECOND, 12);
      const secToFull = GROWTH_TARGET_CM / GROWTH_CM_PER_SECOND;
      const halfMs = (secToFull / 2) * 1000;
      expect(getOosanLengthCm(t0, t0 + halfMs)).toBeCloseTo(GROWTH_TARGET_CM / 2, 5);
      expect(getOosanGrowthProgress(t0, t0 + halfMs)).toBeCloseTo(0.5, 5);
      const fullMs = secToFull * 1000;
      expect(getOosanLengthCm(t0, t0 + fullMs)).toBe(GROWTH_TARGET_CM);
      expect(getOosanGrowthProgress(t0, t0 + fullMs)).toBe(1);
      expect(getOosanLengthCm(t0, t0 + fullMs + 86400000)).toBe(GROWTH_TARGET_CM);
      expect(getOosanGrowthProgress(t0, t0 + fullMs + 86400000)).toBe(1);
    });
  });

  describe('formatOosanLengthCm', () => {
    test('0.00001cm 単位に丸めて小数第5位まで', () => {
      expect(formatOosanLengthCm(0)).toBe('0.00000');
      expect(formatOosanLengthCm(0.000012)).toBe('0.00001');
      expect(formatOosanLengthCm(12.345678901234)).toBe('12.34568');
    });
  });

  describe('createInitialState', () => {
    test('初期状態が正しく生成される', () => {
      const before = Date.now();
      const state = createInitialState();
      const after = Date.now();
      const today = new Date().toISOString().split('T')[0];
      
      expect(state.startDate).toBe(today);
      expect(state.lastVisitDate).toBe(today);
      expect(state.lastGrowthDate).toBe(today);
      expect(state.sizeFactor).toBe(1.0);
      expect(state.growthAnchorMs).toBeGreaterThanOrEqual(before);
      expect(state.growthAnchorMs).toBeLessThanOrEqual(after);
      expect(state.condition).toBe('healthy');
      expect(state.bodyLengthCm).toBe(0);
      expect(state.fullness).toBe(92);
      expect(state.viscosity).toBe(92);
      expect(state.latestLog).toBe('川の底で静かに過ごしています。');
      expect(state.claimedMilestoneIds).toEqual([]);
      expect(state.sessionForegroundMs).toBe(0);
      expect(typeof state.lastGrowthTickMs).toBe('number');
    });
  });

  describe('computeIsNight / computeIsMorning', () => {
    test('6時に夜が終わり朝が始まる（夜と朝は同時に true にならない）', () => {
      expect(computeIsNight(new Date('2024-06-01T05:59:00'))).toBe(true);
      expect(computeIsMorning(new Date('2024-06-01T05:59:00'))).toBe(false);

      expect(computeIsNight(new Date('2024-06-01T06:00:00'))).toBe(false);
      expect(computeIsMorning(new Date('2024-06-01T06:00:00'))).toBe(true);

      expect(computeIsMorning(new Date('2024-06-01T10:59:00'))).toBe(true);
      expect(computeIsMorning(new Date('2024-06-01T11:00:00'))).toBe(false);
    });

    test('19時から夜', () => {
      expect(computeIsNight(new Date('2024-06-01T18:59:00'))).toBe(false);
      expect(computeIsNight(new Date('2024-06-01T19:00:00'))).toBe(true);
      expect(computeIsMorning(new Date('2024-06-01T19:00:00'))).toBe(false);
    });

    test('11時から昼（19時まで）、朝・夜と排他', () => {
      expect(computeIsDaytime(new Date('2024-06-01T10:59:00'))).toBe(false);
      expect(computeIsDaytime(new Date('2024-06-01T11:00:00'))).toBe(true);
      expect(computeIsMorning(new Date('2024-06-01T11:00:00'))).toBe(false);

      expect(computeIsDaytime(new Date('2024-06-01T18:59:00'))).toBe(true);
      expect(computeIsDaytime(new Date('2024-06-01T19:00:00'))).toBe(false);
      expect(computeIsNight(new Date('2024-06-01T19:00:00'))).toBe(true);
    });
  });

  describe('computeGrowthMultiplier / getGrowthPhaseLabel / migrateAppState', () => {
    test('満腹・ヌメリ・夜間で倍率が変わる', () => {
      const day = computeGrowthMultiplier(100, 100, false);
      const night = computeGrowthMultiplier(100, 100, true);
      expect(day).toBeLessThan(night);
      expect(formatGrowthMultiplier(day)).toMatch(/^x[\d.]+$/);
    });

    test('空っぽは昼 x1、満タンほど加速（両方100%で昼 x3）', () => {
      expect(computeGrowthMultiplier(0, 0, false)).toBe(1);
      expect(computeGrowthMultiplier(100, 100, false)).toBe(3);
      expect(computeGrowthMultiplier(50, 100, false)).toBe(2.5);
    });

    test('フェーズラベルは 20cm 未満で幼生期', () => {
      expect(getGrowthPhaseLabel(0)).toBe('幼生期（外鰓あり）');
      expect(getGrowthPhaseLabel(19.999)).toBe('幼生期（外鰓あり）');
      expect(getGrowthPhaseLabel(20)).toBe('成体（ヌシへの道）');
    });

    test('migrateAppState が欠損フィールドを補う', () => {
      const t0 = Date.now() - 2000;
      const raw = {
        startDate: '2024-01-01',
        lastVisitDate: '2024-01-02',
        lastGrowthDate: '2024-01-02',
        sizeFactor: 1,
        growthAnchorMs: t0,
        condition: 'healthy',
        latestLog: 'x',
      };
      const m = migrateAppState(raw as Record<string, unknown>);
      expect(m.bodyLengthCm).toBeCloseTo(getOosanLengthCm(t0), 10);
      expect(m.fullness).toBe(92);
      expect(m.viscosity).toBe(92);
    });
  });

  describe('getDaysDiff', () => {
    test('日付の差分が正しく計算される', () => {
      expect(getDaysDiff('2024-01-01', '2024-01-02')).toBe(1);
      expect(getDaysDiff('2024-01-01', '2024-01-05')).toBe(4);
      expect(getDaysDiff('2024-01-10', '2024-01-01')).toBe(9);
      expect(getDaysDiff('2024-01-01', '2024-01-01')).toBe(0);
    });
  });

  describe('processGrowth', () => {
    test('healthy状態のとき成長する', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: today,
        lastGrowthDate: yesterday,
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const result = processGrowth(state);
      
      expect(result.sizeFactor).toBeGreaterThan(1.0);
      expect(result.sizeFactor).toBeLessThanOrEqual(1.003);
      expect(result.lastGrowthDate).toBe(today);
    });

    test('今日すでに成長処理済みの場合は成長しない', () => {
      const today = new Date().toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: today,
        lastGrowthDate: today,
        sizeFactor: 1.5,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const result = processGrowth(state);
      
      expect(result.sizeFactor).toBe(1.5);
      expect(result.lastGrowthDate).toBe(today);
    });

    test('weak状態のときは成長しない', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: today,
        lastGrowthDate: yesterday,
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'weak',
        latestLog: 'テスト',
      };
      
      const result = processGrowth(state);
      
      expect(result.sizeFactor).toBe(1.0);
      expect(result.lastGrowthDate).toBe(today);
    });

    test('dead状態のときは成長しない', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: today,
        lastGrowthDate: yesterday,
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'dead',
        latestLog: 'テスト',
      };
      
      const result = processGrowth(state);
      
      expect(result.sizeFactor).toBe(1.0);
      expect(result.lastGrowthDate).toBe(today);
    });
  });

  describe('processCondition', () => {
    test('2日放置はhealthyのまま', () => {
      const today = new Date().toISOString().split('T')[0];
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: twoDaysAgo,
        lastGrowthDate: twoDaysAgo,
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const result = processCondition(state);
      
      expect(result.condition).toBe('healthy');
      expect(result.lastVisitDate).toBe(today);
    });

    test('14日放置でweakになる', () => {
      const today = new Date().toISOString().split('T')[0];
      const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: fourteenDaysAgo,
        lastGrowthDate: fourteenDaysAgo,
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const result = processCondition(state);
      
      expect(result.condition).toBe('weak');
      expect(result.lastVisitDate).toBe(today);
    });

    test('30日放置でdeadになる', () => {
      const today = new Date().toISOString().split('T')[0];
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: thirtyDaysAgo,
        lastGrowthDate: thirtyDaysAgo,
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const result = processCondition(state);
      
      expect(result.condition).toBe('dead');
      expect(result.lastVisitDate).toBe(today);
    });

    test('weakから復帰できる（2日以内に訪問）', () => {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: yesterday,
        lastGrowthDate: yesterday,
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'weak',
        latestLog: 'テスト',
      };
      
      const result = processCondition(state);
      
      expect(result.condition).toBe('healthy');
      expect(result.lastVisitDate).toBe(today);
    });
  });

  describe('generateDailyLog', () => {
    test('dead状態のとき適切なログを返す', () => {
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: '2024-01-10',
        lastGrowthDate: '2024-01-01',
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'dead',
        latestLog: 'テスト',
      };
      
      const log = generateDailyLog(state);
      expect(log).toBe('静かな川の流れだけが残っています。');
    });

    test('weak状態のとき適切なログを返す', () => {
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: '2024-01-05',
        lastGrowthDate: '2024-01-01',
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'weak',
        latestLog: 'テスト',
      };
      
      const log = generateDailyLog(state);
      const weakMessages = [
        '今日も静かに過ごしています。',
        'ゆっくりと時間が流れています。',
        '川の音が聞こえます。',
      ];
      expect(weakMessages).toContain(log);
    });

    test('初日のとき適切なログを返す', () => {
      const today = new Date().toISOString().split('T')[0];
      const state: AppState = {
        startDate: today,
        lastVisitDate: today,
        lastGrowthDate: today,
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      
      const log = generateDailyLog(state);
      expect(log).toBe('新しい住処を見つけました。');
    });

    test('healthy状態のとき適切なログを返す（昼・幼生プールのみ）', () => {
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: '2024-01-05',
        lastGrowthDate: '2024-01-01',
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'healthy',
        latestLog: 'テスト',
      };

      const atDay = new Date('2024-01-05T14:00:00');
      const log = generateDailyLog(state, atDay);
      expect(healthyMessages).toContain(log);
    });

    test('healthy・夜は夜用メッセージが混ざり得る', () => {
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: '2024-01-05',
        lastGrowthDate: '2024-01-01',
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 0,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      const atNight = new Date('2024-01-05T22:00:00');
      expect(computeIsNight(atNight)).toBe(true);
      const log = generateDailyLog(state, atNight);
      const pool = new Set([...healthyMessages, ...healthyNightMessages]);
      expect(pool.has(log)).toBe(true);
    });

    test('healthy・体長20cm超は成体向けメッセージが混ざり得る', () => {
      const state: AppState = {
        startDate: '2024-01-01',
        lastVisitDate: '2024-01-05',
        lastGrowthDate: '2024-01-01',
        sizeFactor: 1.0,
        growthAnchorMs: 0,
        bodyLengthCm: 21,
        fullness: 92,
        viscosity: 92,
        claimedMilestoneIds: [],
        sessionForegroundMs: 0,
        lastGrowthTickMs: 1_700_000_000_000,
        condition: 'healthy',
        latestLog: 'テスト',
      };
      const atDay = new Date('2024-01-05T12:00:00');
      const log = generateDailyLog(state, atDay);
      const pool = new Set([...healthyMessages, ...healthyAdultPhaseMessages]);
      expect(pool.has(log)).toBe(true);
    });

    test('pickHealthyDailyLogMessage は直前と同じ文言を選ばない（候補が2件以上のとき）', () => {
      const atDay = new Date('2024-01-05T12:00:00');
      const prev = healthyMessages[0]!;
      const spy = jest.spyOn(Math, 'random').mockReturnValue(0);
      const next = pickHealthyDailyLogMessage(
        { bodyLengthCm: 0, latestLog: prev },
        atDay
      );
      expect(next).not.toBe(prev);
      spy.mockRestore();
    });
  });

  describe('backgroundGaugeDecayMultiplier', () => {
    const baseState = (startDate: string): AppState => ({
      startDate,
      lastVisitDate: startDate,
      lastGrowthDate: startDate,
      sizeFactor: 1,
      growthAnchorMs: 0,
      bodyLengthCm: 0,
      fullness: 90,
      viscosity: 90,
      condition: 'healthy',
      latestLog: '',
      claimedMilestoneIds: [],
      sessionForegroundMs: 0,
      lastGrowthTickMs: 0,
    });

    test('安定時倍率は 5/144（12h/24h 設計）', () => {
      expect(GAUGE_DECAY_MULT_BACKGROUND_STABLE).toBeCloseTo(5 / 144, 10);
    });

    test('開始から EARLY_CARE_BG_DAYS 未満の暦日は 2 倍', () => {
      const s = baseState('2024-06-01');
      const t0 = new Date('2024-06-01T12:00:00.000Z').getTime();
      const t2 = new Date('2024-06-03T12:00:00.000Z').getTime();
      const t3 = new Date('2024-06-04T12:00:00.000Z').getTime();
      expect(backgroundGaugeDecayMultiplier(s, t0)).toBeCloseTo(
        GAUGE_DECAY_MULT_BACKGROUND_STABLE * EARLY_CARE_BG_EXTRA_MULT,
        10
      );
      expect(backgroundGaugeDecayMultiplier(s, t2)).toBeCloseTo(
        GAUGE_DECAY_MULT_BACKGROUND_STABLE * EARLY_CARE_BG_EXTRA_MULT,
        10
      );
      expect(backgroundGaugeDecayMultiplier(s, t3)).toBeCloseTo(
        GAUGE_DECAY_MULT_BACKGROUND_STABLE,
        10
      );
      expect(EARLY_CARE_BG_DAYS).toBe(3);
    });
  });

  describe('paginateOfflineBacklog', () => {
    const stub = (id: string) =>
      ({ id, targetCm: 0, name: id, tier: 'low' as const, phase: 'intro' as const });

    test('閾値未満は1ページにまとめる', () => {
      const items = Array.from({ length: OFFLINE_BACKLOG_SPLIT_THRESHOLD - 1 }, (_, i) =>
        stub(`m${i}`)
      );
      expect(paginateOfflineBacklog(items)).toEqual([items]);
    });

    test(`${OFFLINE_BACKLOG_SPLIT_THRESHOLD}件以上は ${OFFLINE_BACKLOG_PAGE_SIZE} 件ずつ分割`, () => {
      const n = OFFLINE_BACKLOG_SPLIT_THRESHOLD + 5;
      const items = Array.from({ length: n }, (_, i) => stub(`m${i}`));
      const pages = paginateOfflineBacklog(items);
      expect(pages.length).toBe(Math.ceil(n / OFFLINE_BACKLOG_PAGE_SIZE));
      expect(pages[0]!.length).toBe(OFFLINE_BACKLOG_PAGE_SIZE);
      expect(pages.flat()).toEqual(items);
    });
  });
});
