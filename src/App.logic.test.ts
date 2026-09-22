import {
  healthyMessages,
  healthyNightMessages,
  healthyAdultPhaseMessages,
  dailyLogUsesOosanName,
} from './healthyMessages';
import { pickTapMessage, tapMessageGroupForGrowthLevel } from './tapMessages';
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
  applyCareAction,
  applyGrowthMissionBonusCare,
  claimDailyCareMissionReward,
  claimDailyPetMissionReward,
  resetDailyMissionsForDebug,
  careActionsRemainingForGauge,
  careGrowthPointsForGauge,
  growthPointWaitLabel,
  careTimeUntilEmptyLabel,
  affectionLevelForValue,
  affectionHeartColorForLevel,
  affectionEffectHeartCountForLevel,
  affectionHeartCountForLevel,
  affectionStageForLevel,
  affectionActionsRequiredForLevel,
  dailyPetNormalLimitForAffectionValue,
  DEFAULT_OOSAN_NAME,
  normalizeOosanName,
  affectionValueForLevel,
  bodyLengthAtLevel,
  growthPointsRequiredForLevel,
  claimGrowthMissionReward,
  growthMissionIdForCm,
  growthMissionRewardForCm,
  growthMissionDirectPointsForCm,
  dailyCareGrowthPointCapForLevel,
  growthMissionRewardKindForCm,
  viscosityBarColor,
} from './logic';
import {
  paginateOfflineBacklog,
  OFFLINE_BACKLOG_PAGE_SIZE,
  OFFLINE_BACKLOG_SPLIT_THRESHOLD,
  getNextMilestoneLine,
  applyOfflineCatchUp,
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
      expect(n.fullness).toBe(1);
      expect(n.viscosity).toBe(1);
      expect(n.latestLog).toBe(s.latestLog);
    });

    test('0cm 指定でも新しい赤ちゃんの初期体長へ揃える', () => {
      const n = patchStateForDebugBodyLengthCm(createInitialState(), 0, 123);
      expect(n.bodyLengthCm).toBe(0.5);
      expect(n.sessionForegroundMs).toBe(0);
    });

    test('任意のcm指定は、そのcmの0ptから始める', () => {
      const n = patchStateForDebugBodyLengthCm(createInitialState(), 12, 123);
      expect(n.bodyLengthCm).toBe(12);
      expect(n.growthLevel).toBe(13);
      expect(n.growthPoints).toBe(0);
      expect(growthPointsRequiredForLevel(n.growthLevel!)).toBe(17);
    });
  });

  describe('MS_TO_REACH_TARGET_LENGTH', () => {
    test('100cm 到達に必要な経過 ms（0.00001cm/s）', () => {
      expect(MS_TO_REACH_TARGET_LENGTH).toBe(10_000_000_000);
    });
  });

  describe('getOosanLengthCm / getOosanGrowthProgress', () => {
    test('固定レート 0.00001 cm/sで、100cm以降も体長は伸び続ける', () => {
      const t0 = 1_000_000_000_000;
      expect(getOosanLengthCm(t0, t0)).toBe(0);
      expect(getOosanGrowthProgress(t0, t0)).toBe(0);
      expect(getOosanLengthCm(t0, t0 + 1000)).toBeCloseTo(GROWTH_CM_PER_SECOND, 12);
      const secToFull = GROWTH_TARGET_CM / GROWTH_CM_PER_SECOND;
      const halfMs = (secToFull / 2) * 1000;
      expect(getOosanLengthCm(t0, t0 + halfMs)).toBeCloseTo(GROWTH_TARGET_CM / 2, 5);
      expect(getOosanGrowthProgress(t0, t0 + halfMs)).toBeCloseTo(0.5, 5);
      const fullMs = secToFull * 1000;
      expect(getOosanLengthCm(t0, t0 + fullMs)).toBeCloseTo(GROWTH_TARGET_CM, 10);
      expect(getOosanGrowthProgress(t0, t0 + fullMs)).toBe(1);
      expect(getOosanLengthCm(t0, t0 + fullMs + 86400000)).toBeGreaterThan(GROWTH_TARGET_CM);
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
      expect(state.bodyLengthCm).toBe(0.5);
      expect(state.growthLevel).toBe(1);
      expect(state.growthPoints).toBe(0);
      expect(state.affection).toBe(0);
      expect(state.oosanName).toBe(DEFAULT_OOSAN_NAME);
      expect(state.fullness).toBe(1);
      expect(state.viscosity).toBe(1);
      expect(state.latestLog).toBe('川の底で静かに過ごしています。');
      expect(state.claimedMilestoneIds).toEqual([]);
      expect(state.sessionForegroundMs).toBe(0);
      expect(typeof state.lastGrowthTickMs).toBe('number');
    });

    test('ヌメリゲージも残量に応じて水色・黄色・赤へ切り替わる', () => {
      expect(viscosityBarColor(100)).toBe('#3baee0');
      expect(viscosityBarColor(59)).toBe('#ffeb3b');
      expect(viscosityBarColor(29)).toBe('#f44336');
    });
  });

  describe('育成ポイント・なつき度', () => {
    test('体長ごとに次の1cmへ必要なptが決まり、100cm以降も伸び続ける', () => {
      expect(bodyLengthAtLevel(1)).toBe(0.5);
      expect(bodyLengthAtLevel(4)).toBe(3);
      expect(bodyLengthAtLevel(21)).toBe(20);
      expect(bodyLengthAtLevel(101)).toBe(100);
      expect(bodyLengthAtLevel(102)).toBeGreaterThan(100);
      expect(growthPointsRequiredForLevel(1)).toBe(5);
      expect(growthPointsRequiredForLevel(4)).toBe(8); // 3cm→4cm
      expect(growthPointsRequiredForLevel(13)).toBe(17); // 12cm→13cm
      expect(growthPointsRequiredForLevel(101)).toBe(105); // 100cm→101cm
    });

    test('お世話の1日上限は体長帯ごとに上がる', () => {
      expect(dailyCareGrowthPointCapForLevel(1)).toBe(6); // 0.5cm
      expect(dailyCareGrowthPointCapForLevel(6)).toBe(12); // 5cm
      expect(dailyCareGrowthPointCapForLevel(11)).toBe(16); // 10cm
      expect(dailyCareGrowthPointCapForLevel(21)).toBe(18); // 20cm
      expect(dailyCareGrowthPointCapForLevel(51)).toBe(20); // 50cm
      expect(dailyCareGrowthPointCapForLevel(101)).toBe(22); // 100cm
    });

    test('最初の0.5cm→1cmは5ptで、表示体長も0.5cm幅の中で進む', () => {
      const at = new Date('2026-09-17T12:00:00');
      let s: AppState = { ...createInitialState(), fullness: 0, feedGrowthPointsToday: 0 };
      const expectedLengths = [0.6, 0.7, 0.8, 0.9, 1.0];

      for (const expectedLength of expectedLengths) {
        const result = applyCareAction(s, 'feed', at);
        expect(result.growthPointsEarned).toBe(1);
        expect(result.state.bodyLengthCm).toBeCloseTo(expectedLength, 6);
        s = { ...result.state, fullness: 0 };
      }

      expect(s.growthLevel).toBe(2);
      expect(s.growthPoints).toBe(0);
      expect(growthPointsRequiredForLevel(s.growthLevel!)).toBe(6);
    });

    test('FeedとWaterは33.3%ごとに+1Pを得て、3回で満タンへ回復する', () => {
      const at = new Date('2026-09-17T12:00:00');
      let s = { ...createInitialState(), fullness: 92, viscosity: 92 };
      const feed1 = applyCareAction(s, 'feed', at);
      expect(feed1.growthPointsEarned).toBe(1);
      expect(feed1.state.fullness).toBe(100); // 初期値92%からは1回で満タン
      s = feed1.state;
      const water1 = applyCareAction(s, 'water', at);
      expect(water1.growthPointsEarned).toBe(1);
      expect(water1.state.viscosity).toBe(100);
      s = water1.state;
      const feed2 = applyCareAction(s, 'feed', at);
      expect(feed2.growthPointsEarned).toBe(0);

      // 毎秒の減衰で内部値が99.9%になっても、画面が100%表示の間は連打で稼げない。
      const nearlyFull = { ...feed2.state, fullness: 99.9 };
      const repairedNearlyFull = applyCareAction(nearlyFull, 'feed', at);
      expect(repairedNearlyFull.growthPointsEarned).toBe(0);
      expect(repairedNearlyFull.state.fullness).toBe(100);
      expect(repairedNearlyFull.state.dailyFeedMissionComplete).toBe(true);

      // 100%表示になる境界でも、内部値を100へそろえてお世話ミッションを達成する。
      const boundaryFeed = applyCareAction({ ...s, fullness: 66.2, dailyFeedMissionComplete: false }, 'feed', at);
      expect(boundaryFeed.state.fullness).toBe(100);
      expect(boundaryFeed.state.dailyFeedMissionComplete).toBe(true);
      const boundaryWater = applyCareAction({ ...s, viscosity: 66.2, dailyWaterMissionComplete: false }, 'water', at);
      expect(boundaryWater.state.viscosity).toBe(100);
      expect(boundaryWater.state.dailyWaterMissionComplete).toBe(true);

      const lowFullness = applyCareAction({ ...s, fullness: 33 }, 'feed', at);
      expect(lowFullness.growthPointsEarned).toBe(1);
      expect(lowFullness.state.fullness).toBeCloseTo(66.333333, 5);
      const emptyWater = applyCareAction({ ...s, viscosity: 0 }, 'water', at);
      expect(emptyWater.growthPointsEarned).toBe(1);
      expect(emptyWater.state.viscosity).toBeCloseTo(33.333333, 5);
      expect(careGrowthPointsForGauge(100)).toBe(0);
      expect(careGrowthPointsForGauge(91)).toBe(1);
      expect(careGrowthPointsForGauge(90)).toBe(1);
      expect(careGrowthPointsForGauge(67)).toBe(1);
      expect(careGrowthPointsForGauge(66)).toBe(1);
      expect(careGrowthPointsForGauge(33)).toBe(1);
      expect(careActionsRemainingForGauge(100)).toBe(0);
      expect(careActionsRemainingForGauge(99.9)).toBe(0);
      expect(careActionsRemainingForGauge(90)).toBe(1);
      expect(careActionsRemainingForGauge(67)).toBe(1);
      expect(careActionsRemainingForGauge(66)).toBe(2);
      expect(careActionsRemainingForGauge(33)).toBe(3);
      expect(careActionsRemainingForGauge(30)).toBe(3);
      expect(careActionsRemainingForGauge(0)).toBe(3);

      let refilled: AppState = { ...s, fullness: 0, feedGrowthPointsToday: 0 };
      const points: number[] = [];
      for (let index = 0; index < 3; index += 1) {
        const result = applyCareAction(refilled, 'feed', at);
        points.push(result.growthPointsEarned);
        refilled = result.state;
      }
      expect(points).toEqual([1, 1, 1]);
      expect(refilled.fullness).toBe(100);

      const capReached = applyCareAction({ ...s, fullness: 0, feedGrowthPointsToday: 6 }, 'feed', at);
      expect(capReached.growthPointsEarned).toBe(0);
      expect(capReached.state.fullness).toBeCloseTo(33.333333, 5);
    });

    test('なでるはLv帯ごとの通常回数を使い切るとミッション達成になり、報酬の3回を使える', () => {
      const firstDay = new Date('2026-09-17T12:00:00');
      let s = { ...createInitialState(), fullness: 92, viscosity: 92 };
      expect(dailyPetNormalLimitForAffectionValue(0)).toBe(6);
      expect(dailyPetNormalLimitForAffectionValue(affectionValueForLevel(11))).toBe(7);
      expect(dailyPetNormalLimitForAffectionValue(affectionValueForLevel(91))).toBe(15);
      let levelElevenDay: AppState = { ...createInitialState(), affection: affectionValueForLevel(11) };
      for (let index = 0; index < 6; index += 1) levelElevenDay = applyCareAction(levelElevenDay, 'pet', firstDay).state;
      expect(levelElevenDay.dailyPetMissionComplete).toBe(false);
      levelElevenDay = applyCareAction(levelElevenDay, 'pet', firstDay).state;
      expect(levelElevenDay.dailyPetMissionComplete).toBe(true);
      for (const expected of [1, 1, 1, 1, 1, 1]) {
        const result = applyCareAction(s, 'pet', firstDay);
        expect(result.affectionEarned).toBe(expected);
        s = result.state;
      }
      expect(s.petNormalCountToday).toBe(6);
      expect(s.dailyPetMissionComplete).toBe(true);
      // ミッション達成後は、報酬を受け取ってからおまけ3回を使える。
      expect(applyCareAction(s, 'pet', firstDay).affectionEarned).toBe(0);
      s = claimDailyPetMissionReward(s, firstDay).state;
      expect(s.dailyPetBonusUsesRemaining).toBe(3);
      const firstBonusPet = applyCareAction(s, 'pet', firstDay);
      expect(firstBonusPet.affectionEarned).toBe(1);
      expect(firstBonusPet.state.dailyPetBonusUsesRemaining).toBe(2);
      const secondBonusPet = applyCareAction(firstBonusPet.state, 'pet', firstDay);
      expect(secondBonusPet.affectionEarned).toBe(1);
      expect(secondBonusPet.state.dailyPetBonusUsed).toBe(false);
      const thirdBonusPet = applyCareAction(secondBonusPet.state, 'pet', firstDay);
      expect(thirdBonusPet.state.petCountToday).toBe(9);
      expect(thirdBonusPet.state.dailyPetBonusUsed).toBe(true);
      expect(applyCareAction(thirdBonusPet.state, 'pet', firstDay).affectionEarned).toBe(0);
      expect(s.affection).toBe(6);
      const nextDay = applyCareAction(s, 'pet', new Date('2026-09-18T08:00:00'));
      expect(nextDay.affectionEarned).toBe(1);
      expect(affectionLevelForValue(0)).toBe(1);
      expect(affectionActionsRequiredForLevel(1)).toBe(5);
      expect(affectionActionsRequiredForLevel(10)).toBe(5);
      expect(affectionActionsRequiredForLevel(11)).toBe(7);
      expect(affectionActionsRequiredForLevel(21)).toBe(9);
      expect(affectionActionsRequiredForLevel(91)).toBe(23);
      expect(affectionLevelForValue(5)).toBe(2);
      expect(affectionLevelForValue(affectionValueForLevel(20))).toBe(20);
      expect(affectionLevelForValue(affectionValueForLevel(100))).toBe(100);
      expect(affectionLevelForValue(99999)).toBe(100);
      expect(affectionHeartCountForLevel(10)).toBe(0);
      expect(affectionHeartCountForLevel(11)).toBe(1);
      expect(affectionHeartCountForLevel(100)).toBe(0);
      expect(affectionEffectHeartCountForLevel(10)).toBe(1);
      expect(affectionEffectHeartCountForLevel(100)).toBe(1);
      expect(affectionHeartColorForLevel(10)).toBe('#ef7190');
      expect(affectionHeartColorForLevel(11)).toBe('#f28b72');
      expect(affectionHeartColorForLevel(100)).toBe('#d6a92b');
      expect(affectionStageForLevel(1).name).toBe('はじめてのともだち');
      expect(affectionStageForLevel(27).name).toBe('川辺のなかよし');
      expect(affectionStageForLevel(100).name).toBe('川のベストフレンド');
    });

    test('ミッション報酬は受け取るまで自動付与せず、なかよしの追加なでなでも受取後だけ使える', () => {
      const today = new Date('2026-09-18T12:00:00');
      let s = { ...createInitialState(), fullness: 92, viscosity: 92 };
      s = applyCareAction(s, 'feed', today).state;
      const careMission = applyCareAction(s, 'water', today);
      s = careMission.state;
      expect(s.dailyFeedMissionComplete).toBe(true);
      expect(s.dailyWaterMissionComplete).toBe(true);
      expect(careMission.dailyBonusEarned).toBe(false);
      expect(s.dailyCareBonusAwarded).toBe(false);
      expect(s.growthPoints).toBe(2);
      const reward = claimDailyCareMissionReward(s, today);
      s = reward.state;
      expect(reward.claimed).toBe(true);
      expect(s.dailyCareBonusAwarded).toBe(true);
      expect(s.growthPoints).toBe(3);
      expect(claimDailyCareMissionReward(s, today).claimed).toBe(false);
      expect(s.dailyPetMissionComplete).toBe(false);

      for (let index = 0; index < 5; index += 1) {
        s = applyCareAction(s, 'pet', today).state;
      }
      // Lv.1〜10の通常上限は6回なので、5回ではまだ達成にならない。
      expect(s.dailyPetMissionComplete).toBe(false);
      expect(s.dailyPetBonusUsed).toBe(false);
      expect(s.petCountToday).toBe(5);
      // 6回目で通常なでなでを使い切り、報酬を受け取れる。
      s = applyCareAction(s, 'pet', today).state;
      expect(s.petNormalCountToday).toBe(6);
      expect(s.dailyPetMissionComplete).toBe(true);
      expect(applyCareAction(s, 'pet', today).state.petCountToday).toBe(6);
      const petReward = claimDailyPetMissionReward(s, today);
      expect(petReward.claimed).toBe(true);
      s = petReward.state;
      expect(s.dailyPetBonusClaimed).toBe(true);
      expect(claimDailyPetMissionReward(s, today).claimed).toBe(false);
      const firstBonusPet = applyCareAction(s, 'pet', today);
      expect(firstBonusPet.state.dailyPetBonusUsed).toBe(false);
      const secondBonusPet = applyCareAction(firstBonusPet.state, 'pet', today);
      expect(secondBonusPet.state.dailyPetBonusUsed).toBe(false);
      const thirdBonusPet = applyCareAction(secondBonusPet.state, 'pet', today);
      expect(thirdBonusPet.state.dailyPetBonusUsed).toBe(true);
      expect(thirdBonusPet.state.petCountToday).toBe(9);
      expect(applyCareAction(thirdBonusPet.state, 'pet', today).affectionEarned).toBe(0);
    });


    test('デバッグのミッションリセットは当日の進行を未達成へ戻す', () => {
      const today = new Date('2026-09-18T12:00:00');
      const completed = {
        ...createInitialState(),
        fullness: 100,
        viscosity: 100,
        petCountToday: 6,
        dailyFeedMissionComplete: true,
        dailyWaterMissionComplete: true,
        dailyPetMissionComplete: true,
        dailyPetBonusUsed: true,
        dailyCareBonusAwarded: true,
      };
      const reset = resetDailyMissionsForDebug(completed, today);
      expect(reset.fullness).toBe(0);
      expect(reset.viscosity).toBe(0);
      expect(reset.petCountToday).toBe(0);
      expect(reset.dailyCareBonusAwarded).toBe(false);
      expect(reset.dailyPetBonusUsed).toBe(false);
    });

    test('デバッグで空に戻した後も、ごはん・おみずを満タンにすればお世話ミッションを再達成できる', () => {
      const today = new Date('2026-09-18T12:00:00');
      let s = resetDailyMissionsForDebug({
        ...createInitialState(),
        fullness: 100,
        viscosity: 100,
        dailyFeedMissionComplete: true,
        dailyWaterMissionComplete: true,
        dailyCareBonusAwarded: true,
      }, today);
      // 0→33.3→66.7→100 の3回で満タン。
      for (let index = 0; index < 3; index += 1) s = applyCareAction(s, 'feed', today).state;
      for (let index = 0; index < 3; index += 1) s = applyCareAction(s, 'water', today).state;
      expect(s.fullness).toBe(100);
      expect(s.viscosity).toBe(100);
      expect(s.dailyFeedMissionComplete).toBe(true);
      expect(s.dailyWaterMissionComplete).toBe(true);
      expect(claimDailyCareMissionReward(s, today).claimed).toBe(true);
    });

    test('成長の道のりの報酬は固定のごほうびお世話3回分になり、到達後に一度だけ受け取れる', () => {
      const reached = { ...createInitialState(), bodyLengthCm: 8, growthLevel: 9, growthPoints: 0, viscosity: 0 };
      expect(growthMissionRewardForCm(8)).toBe(3);
      expect(growthMissionRewardKindForCm(8)).toBe('water');
      expect(growthMissionRewardKindForCm(20)).toBe('both');
      expect(growthMissionRewardKindForCm(25)).toBe('feed');
      expect(growthMissionRewardKindForCm(35)).toBe('water');
      expect(growthMissionRewardKindForCm(50)).toBe('both');
      expect(growthMissionRewardKindForCm(150)).toBe('both');
      expect(growthMissionRewardForCm(50)).toBe(6);
      expect(growthMissionRewardForCm(100)).toBe(6);
      expect(growthMissionRewardForCm(150)).toBe(6);
      expect(growthMissionDirectPointsForCm(4)).toBe(1);
      expect(growthMissionDirectPointsForCm(5)).toBe(2);
      expect(growthMissionDirectPointsForCm(10)).toBe(3);
      expect(growthMissionDirectPointsForCm(19)).toBe(4);
      expect(growthMissionDirectPointsForCm(20)).toBe(3);
      expect(growthMissionDirectPointsForCm(25)).toBe(1);
      expect(growthMissionDirectPointsForCm(50)).toBe(6);
      expect(growthMissionDirectPointsForCm(100)).toBe(10);
      expect(growthMissionDirectPointsForCm(150)).toBe(15);
      const claimed = claimGrowthMissionReward(reached, 8);
      expect(claimed.claimed).toBe(true);
      expect(claimed.reward).toBe('water');
      expect(claimed.state.viscosity).toBe(0);
      expect(claimed.state.bonusWaterCare).toBe(3);
      expect(claimed.state.growthPoints).toBe(2);
      const used = applyGrowthMissionBonusCare(claimed.state, 'water');
      expect(used.used).toBe(true);
      expect(used.state.viscosity).toBe(0);
      expect(used.state.bonusWaterCare).toBe(2);
      expect(used.state.growthPoints).toBe(3);
      expect(claimed.state.claimedGrowthMissionIds).toContain(growthMissionIdForCm(8));
      expect(claimGrowthMissionReward(claimed.state, 8).claimed).toBe(false);
      expect(claimGrowthMissionReward(reached, 11).claimed).toBe(false);
    });

    test('旧10Lv方式のなつき度は、見た目のLvを保って100Lv方式へ移行する', () => {
      const migrated = migrateAppState({ affection: 35 } as Record<string, unknown>);
      expect(affectionLevelForValue(migrated.affection ?? 0)).toBe(4);
      expect(migrated.affectionModelVersion).toBe(5);
    });
  });

  describe('タップ時のひとこと', () => {
    test('育成Lvごとに専用の文言グループを選ぶ', () => {
      expect(tapMessageGroupForGrowthLevel(1).name).toBe('うまれたて');
      expect(tapMessageGroupForGrowthLevel(9).name).toBe('沢のちびっこ');
      expect(tapMessageGroupForGrowthLevel(10).name).toBe('おとなデビュー');
      expect(tapMessageGroupForGrowthLevel(70).name).toBe('ヌシへの道');
      expect(tapMessageGroupForGrowthLevel(100).name).toBe('伝説の川のヌシ');
    });

    test('直前と同じひとことを続けて選ばない', () => {
      const group = tapMessageGroupForGrowthLevel(1);
      const message = pickTapMessage({ growthLevel: 1, latestLog: group.messages[0] }, () => 0);
      expect(message).not.toBe(group.messages[0]);
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

    test('フェーズラベルは成長の道のり表と同じ段階名になる', () => {
      expect(getGrowthPhaseLabel(0)).toBe('うまれたて');
      expect(getGrowthPhaseLabel(19.999)).toBe('明日はおとな');
      expect(getGrowthPhaseLabel(20)).toBe('おとなデビュー');
      expect(getGrowthPhaseLabel(50)).toBe('ヌシへの道');
      expect(getGrowthPhaseLabel(100)).toBe('伝説の川のヌシ');
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
      expect(m.bodyLengthCm).toBe(0.5);
      expect(m.growthLevel).toBe(1);
      expect(m.fullness).toBe(1);
      expect(m.viscosity).toBe(1);
      expect(m.oosanName).toBe(DEFAULT_OOSAN_NAME);
      expect(normalizeOosanName('  かわいい\nサンショ  ')).toBe('かわいい サンショ');
      expect(normalizeOosanName('')).toBe(DEFAULT_OOSAN_NAME);
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

    test('初日も成長段階ごとの共通セリフを返す', () => {
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
      expect(tapMessageGroupForGrowthLevel(1).messages).toContain(log);
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
      expect([...tapMessageGroupForGrowthLevel(state.growthLevel ?? 1).messages, ...healthyMessages]).toContain(log);
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
      const pool = new Set([...tapMessageGroupForGrowthLevel(state.growthLevel ?? 1).messages, ...healthyMessages]);
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
      const pool = new Set([...tapMessageGroupForGrowthLevel(state.growthLevel ?? 1).messages, ...healthyMessages]);
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

    test('日々のひとことは一部の日常・成長文だけ名前入りにし、雑学は名前なしにする', () => {
      expect(dailyLogUsesOosanName('岩の陰で休んでいます。')).toBe(true);
      expect(dailyLogUsesOosanName('少しずつ、着実に大きくなっています。')).toBe(true);
      expect(dailyLogUsesOosanName('知ってる？実はカエルやイモリの仲間なんだよ。')).toBe(false);
      expect(dailyLogUsesOosanName('夜行性だから、今は元気だよ！')).toBe(false);
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

    test('安定時倍率は1（おなか・ヌメリとも12時間設計）', () => {
      expect(GAUGE_DECAY_MULT_BACKGROUND_STABLE).toBe(1);
    });

    test('開始直後も減少が速くならず、常に同じ倍率', () => {
      const s = baseState('2024-06-01');
      const t0 = new Date('2024-06-01T12:00:00.000Z').getTime();
      const t2 = new Date('2024-06-03T12:00:00.000Z').getTime();
      const t3 = new Date('2024-06-04T12:00:00.000Z').getTime();
      expect(backgroundGaugeDecayMultiplier(s, t0)).toBe(GAUGE_DECAY_MULT_BACKGROUND_STABLE);
      expect(backgroundGaugeDecayMultiplier(s, t2)).toBe(GAUGE_DECAY_MULT_BACKGROUND_STABLE);
      expect(backgroundGaugeDecayMultiplier(s, t3)).toBe(GAUGE_DECAY_MULT_BACKGROUND_STABLE);
      expect(EARLY_CARE_BG_DAYS).toBe(0);
      expect(EARLY_CARE_BG_EXTRA_MULT).toBe(1);
    });
  });

  describe('おなか・ヌメリの経過時間', () => {
    const rate = 1 / 432;

    test('タイマーが遅れても実際の経過時間ぶん減り、同じ時刻では二重に減らない', () => {
      const start = Date.now();
      const state = { ...createInitialState(), fullness: 100, viscosity: 100, lastGrowthTickMs: start };
      const afterFourMinutes = applyOfflineCatchUp(state, start + 4 * 60_000, rate, rate);
      expect(afterFourMinutes.fullness).toBeCloseTo(100 - 240 / 432, 6);
      expect(afterFourMinutes.viscosity).toBeCloseTo(100 - 240 / 432, 6);
      expect(careGrowthPointsForGauge(afterFourMinutes.fullness)).toBe(1);
      expect(applyOfflineCatchUp(afterFourMinutes, start + 4 * 60_000, rate, rate).fullness)
        .toBeCloseTo(afterFourMinutes.fullness, 6);
    });

    test('毎秒更新と中断後の追いつきで、同じ経過時間なら同じ残量になる', () => {
      const start = Date.now();
      const state = { ...createInitialState(), fullness: 100, viscosity: 100, lastGrowthTickMs: start };
      let stepped = state;
      for (let second = 1; second <= 240; second++) {
        stepped = applyOfflineCatchUp(stepped, start + second * 1000, rate, rate);
      }
      const resumed = applyOfflineCatchUp(state, start + 240_000, rate, rate);
      expect(stepped.fullness).toBeCloseTo(resumed.fullness, 6);
      expect(stepped.viscosity).toBeCloseTo(resumed.viscosity, 6);
    });

    test('残り時間の表示は100%から1分ずつ減る', () => {
      expect(growthPointWaitLabel(100, 432)).toBe('あと4分で+1pt');
      expect(growthPointWaitLabel(99.9, 432)).toBe('あと3分で+1pt');
      expect(growthPointWaitLabel(99.7, 432)).toBe('あと2分で+1pt');
      expect(growthPointWaitLabel(99.49, 432)).toBe('+1pt！');
    });

    test('空になるまでの目安は時間・分・秒で表示する', () => {
      expect(careTimeUntilEmptyLabel(100, 432)).toBe('空まであと12時間0分0秒');
      expect(careTimeUntilEmptyLabel(50, 432)).toBe('空まであと6時間0分0秒');
      expect(careTimeUntilEmptyLabel(0.1, 432)).toBe('空まであと44秒');
      expect(careTimeUntilEmptyLabel(1, 432)).toBe('空まであと7分12秒');
      expect(careTimeUntilEmptyLabel(0, 432)).toBe('空っぽ');
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
