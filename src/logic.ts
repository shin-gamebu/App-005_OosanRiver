import {
  healthyMessages,
  healthyNightMessages,
  healthyAdultPhaseMessages,
} from './healthyMessages';
import { pickTapMessage } from './tapMessages';

// 状態の型定義
export type Condition = 'healthy' | 'weak' | 'dead';

/** 最後の訪問からこの日数で、再訪を促す通知と弱り状態にする。 */
export const DAYS_UNTIL_INACTIVITY_REMINDER = 14;
/** 最後の訪問からこの日数で、死亡状態にする。 */
export const DAYS_UNTIL_DEATH = 30;
export const DEFAULT_OOSAN_NAME = 'サンショ';

export function normalizeOosanName(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_OOSAN_NAME;
  const name = value.trim().replace(/\s+/g, ' ').slice(0, 15);
  return name || DEFAULT_OOSAN_NAME;
}

export interface AppState {
  /** 一緒に暮らすオオサンショウウオの名前。 */
  oosanName?: string;
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
  /** 成長の道のりミッションで報酬を受け取った体長のID。 */
  claimedGrowthMissionIds?: string[];
  /** 成長ミッションで受け取った、ごほうびごはんの残り回数。 */
  bonusFeedCare?: number;
  /** 成長ミッションで受け取った、ごほうびおみずの残り回数。 */
  bonusWaterCare?: number;
  /** フォアグラウンド累計（導入フェーズ用・ms）。1秒あたりの加算は成長倍率に比例する */
  sessionForegroundMs: number;
  /** 最後に成長ティックを処理した時刻（オフライン追い込み用） */
  lastGrowthTickMs: number;
  /** 育成レベル（1〜無制限）。旧セーブでは bodyLengthCm から移行する。 */
  growthLevel?: number;
  /** 現在レベル内でたまっている育成ポイント。 */
  growthPoints?: number;
  /** 1cmごとの育成ゲージへ移行済みかを示す保存データ版。 */
  growthModelVersion?: number;
  /** なつき度として積み上げる、なでた回数。 */
  affection?: number;
  /** なつき度の計算方式。旧セーブを一度だけ移行するために使う。 */
  affectionModelVersion?: number;
  /** 日ごとのお世話回数を集計しているローカル日付。 */
  careDate?: string;
  feedCountToday?: number;
  waterCountToday?: number;
  /** 通常のごはんで今日すでに獲得した体長pt（ごほうびは含めない）。 */
  feedGrowthPointsToday?: number;
  /** 通常のおみずで今日すでに獲得した体長pt（ごほうびは含めない）。 */
  waterGrowthPointsToday?: number;
  /** 通常なでなでを今日何回したか（ミッション報酬分は含めない）。 */
  petNormalCountToday?: number;
  petCountToday?: number;
  /** デイリーミッション内で、その日に一度でも満タンにしたか。 */
  dailyFeedMissionComplete?: boolean;
  dailyWaterMissionComplete?: boolean;
  /** 当日の通常なでなで上限を使い切り、なかよしミッションを達成したか。 */
  dailyPetMissionComplete?: boolean;
  /** なでる5回ミッションの報酬「ごほうびなでなで」を受け取ったか。 */
  dailyPetBonusClaimed?: boolean;
  /** ごほうびなでなでの残り回数。 */
  dailyPetBonusUsesRemaining?: number;
  /** なでる5回ミッションの報酬「ごほうびなでなで」をすべて使ったか。 */
  dailyPetBonusUsed?: boolean;
  dailyCareBonusAwarded?: boolean;
}

/** 伝説の川のヌシに到達する節目の体長（cm）。体長そのものはここで止まらない。 */
export const GROWTH_TARGET_CM = 100;
/** 画面上のキャラクター画像をこれ以上大きくしないための表示上限。 */
export const DISPLAY_LENGTH_CAP_CM = 100;
/** 体長は伸び続けるが、なつき度はLv.100で最大。 */
export const MAX_GROWTH_LEVEL = Number.MAX_SAFE_INTEGER;
export const GROWTH_MODEL_VERSION = 2;
export const MAX_AFFECTION_LEVEL = 100;
/** なつきLv.1〜10で、次のLvに必要ななでなで回数。 */
export const AFFECTION_ACTIONS_PER_LEVEL = 5;
export const MAX_AFFECTION_ACTIONS_PER_LEVEL = 25;
export const AFFECTION_MODEL_VERSION = 5;
/** なかよしミッション報酬で受け取れるごほうびなでなで回数。 */
export const DAILY_PET_BONUS_USES = 3;

/**
 * 10Lvごとに変わる、なつきハートの色。
 * Lv.1〜10 はピンク、Lv.91〜100 はごほうび感のある金色にする。
 */
export const AFFECTION_HEART_COLORS = [
  '#ef7190', // 1〜10: ピンク
  '#f28b72', // 11〜20: コーラル
  '#f1a13f', // 21〜30: オレンジ
  '#e2bd3f', // 31〜40: きいろ
  '#96bd50', // 41〜50: 黄緑
  '#56a978', // 51〜60: みどり
  '#54b9c8', // 61〜70: 水色
  '#528cd1', // 71〜80: 青
  '#9172c6', // 81〜90: むらさき
  '#d6a92b', // 91〜100: 金色
] as const;

/** なつき度の段階。画面のポップアップと案内表で同じ呼び名を使う。 */
export const AFFECTION_STAGES = [
  { level: 10, countLabel: 'Lv.1〜10', name: 'はじめてのともだち' },
  { level: 20, countLabel: 'Lv.11〜20', name: 'そばにいたい' },
  { level: 30, countLabel: 'Lv.21〜30', name: '川辺のなかよし' },
  { level: 40, countLabel: 'Lv.31〜40', name: '心ゆるす仲' },
  { level: 50, countLabel: 'Lv.41〜50', name: 'かけがえのない相棒' },
  { level: 60, countLabel: 'Lv.51〜60', name: '淵の相談役' },
  { level: 70, countLabel: 'Lv.61〜70', name: '川の親友' },
  { level: 80, countLabel: 'Lv.71〜80', name: '水辺の家族' },
  { level: 90, countLabel: 'Lv.81〜90', name: '伝説の相棒' },
  { level: 100, countLabel: 'Lv.91〜100', name: '川のベストフレンド' },
] as const;

/** 体長ごとの成長段階。成長ポップアップとガイドで共通して使う。 */
export const GROWTH_STAGES = [
  { cm: 0.5, name: 'うまれたて' },
  { cm: 1, name: 'えらひらひら' },
  { cm: 2, name: '沢のちびっこ' },
  { cm: 3, name: '流れの練習' },
  { cm: 4, name: '水草かくれんぼ' },
  { cm: 5, name: '石ころの友だち' },
  { cm: 6, name: '小石のすきま' },
  { cm: 7, name: '水草のトンネル' },
  { cm: 8, name: '川底さんぽ' },
  { cm: 9, name: '流れにのって' },
  { cm: 10, name: '沢のかけっこ' },
  { cm: 11, name: '沢の探検家' },
  { cm: 12, name: '水音をたどって' },
  { cm: 13, name: '岩かげのひみつ' },
  { cm: 14, name: '夜の川辺' },
  { cm: 15, name: '深みをのぞいて' },
  { cm: 16, name: '深みの手前' },
  { cm: 17, name: 'おとな準備中' },
  { cm: 18, name: 'おとなの気配' },
  { cm: 19, name: '明日はおとな' },
  { cm: 20, name: 'おとなデビュー' },
  { cm: 25, name: '川の見習い' },
  { cm: 30, name: '川の若者' },
  { cm: 35, name: '流れの案内人' },
  { cm: 40, name: 'たくましく成長' },
  { cm: 45, name: '大きな背中' },
  { cm: 50, name: 'ヌシへの道' },
  { cm: 55, name: '流れを読む者' },
  { cm: 60, name: '淵の番人' },
  { cm: 65, name: '川の古株' },
  { cm: 70, name: '川底の長' },
  { cm: 75, name: '深みの主' },
  { cm: 80, name: '古のオオサンショウウオ' },
  { cm: 85, name: '川の語り部' },
  { cm: 90, name: '伝説の気配' },
  { cm: 95, name: '伝説の入り口' },
  { cm: 100, name: '伝説の川のヌシ' },
  { cm: 105, name: '大河へのあこがれ' },
  { cm: 110, name: '大河のぬし' },
  { cm: 115, name: '川底の賢者' },
  { cm: 120, name: '太古の面影' },
  { cm: 125, name: '大きな川の主' },
  { cm: 130, name: '伝説をこえて' },
  { cm: 135, name: '深淵の大ヌシ' },
  { cm: 140, name: '川の守り神' },
  { cm: 145, name: '最大級の風格' },
  { cm: 150, name: '伝説の川の大ヌシ' },
] as const;

export type GrowthMissionRewardKind = 'feed' | 'water' | 'both' | 'none';

/** 成長の道のりで受け取れる、ごほうびお世話の種類。 */
export function growthMissionRewardKindForCm(cm: number): GrowthMissionRewardKind {
  if (cm >= 20 && cm % 10 === 0) return 'both';
  // 成体以降の5cm中間節目は、ごはん・おみずを交互に受け取る。
  if (cm >= 25 && cm <= 145 && cm % 10 === 5) return Math.floor((cm - 25) / 10) % 2 === 0 ? 'feed' : 'water';
  // 赤ちゃん期は毎cmで、ごはん・おみずを交互に受け取る。
  if (cm >= 1 && cm <= 19) return cm % 2 === 1 ? 'feed' : 'water';
  return 'none';
}

/** ごほうびごはん／おみずとして受け取る使用回数。 */
export function growthMissionRewardForCm(cm: number): number {
  const kind = growthMissionRewardKindForCm(cm);
  if (kind === 'none') return 0;
  // 50cm・100cm・150cmは大きな節目。ごほうびお世話を各6回分にする。
  return [50, 100, 150].includes(cm) ? 6 : 3;
}

/**
 * ミッション受取時に直接加わる体長pt。
 * 体が大きくなるほど次の1cmに必要なptも増えるため、節目の報酬も少しずつ増やす。
 * ごほうびお世話の回数分は、この値とは別に1回=1ptとして受け取れる。
 */
export function growthMissionDirectPointsForCm(cm: number): number {
  if (cm >= 1 && cm <= 4) return 1;
  if (cm >= 5 && cm <= 9) return 2;
  if (cm >= 10 && cm <= 14) return 3;
  if (cm >= 15 && cm <= 19) return 4;

  // 成体以降は、5cm中間の節目より10cmごとの大きな節目を少し豪華にする。
  if (cm >= 25 && cm <= 45 && cm % 10 === 5) return 1;
  if (cm >= 20 && cm <= 40 && cm % 10 === 0) return 3;
  if (cm === 50) return 6;
  if (cm >= 55 && cm <= 95 && cm % 10 === 5) return 2;
  if (cm >= 60 && cm <= 90 && cm % 10 === 0) return 5;
  if (cm === 100) return 10;
  if (cm >= 105 && cm <= 145 && cm % 10 === 5) return 3;
  if (cm >= 110 && cm <= 140 && cm % 10 === 0) return 7;
  if (cm === 150) return 15;
  return 0;
}

export const growthMissionIdForCm = (cm: number): string => `growth-stage-${cm}`;

/**
 * 育成Lvは内部的な「次の1cmへ進む段階」。
 * Lv.1 は 0.5cm、Lv.2 は 1cm、以後は Lv-1 cm に対応する。
 * 表示は体長そのものなので、ユーザーには毎回「○cm → ○+1cm」のゲージとして見える。
 */
export function bodyLengthAtLevel(level: number): number {
  const clamped = Math.max(1, Math.floor(level));
  return clamped === 1 ? 0.5 : clamped - 1;
}

/**
 * 現在の体長から次の1cmへ進むための育成ポイント。
 * 赤ちゃん期でも遊びごたえを出すため最初から5ptにし、1cm成長するごとに1ptずつ増やす。
 */
export function growthPointsRequiredForLevel(level: number): number {
  const cm = bodyLengthAtLevel(level);
  // 0.5→1cm は5pt、1→2cm は6pt。以後も次の1cmごとに必要ptを1増やす。
  return Math.max(5, Math.floor(cm) + 5);
}

/**
 * 現在のなつきLvから、次のLvに必要ななでなで回数を返す。
 * Lv.1〜10 は5回、以後10Lvごとに2回ずつ増える。
 */
export function affectionActionsRequiredForLevel(level: number): number {
  const band = Math.floor((Math.max(1, Math.floor(level)) - 1) / 10);
  return Math.min(MAX_AFFECTION_ACTIONS_PER_LEVEL, AFFECTION_ACTIONS_PER_LEVEL + band * 2);
}

/** 通常なでなではLv.1〜10で1日6回。以後、10Lvごとに1回増える。 */
export function dailyPetNormalLimitForAffectionValue(affection: number): number {
  const level = affectionLevelForValue(affection);
  return Math.min(15, 5 + Math.ceil(level / 10));
}

/** 指定Lvの開始時点までに必要な累計なでなで回数。 */
export function affectionValueForLevel(level: number): number {
  const target = Math.max(1, Math.min(MAX_AFFECTION_LEVEL, Math.floor(level)));
  let total = 0;
  for (let current = 1; current < target; current += 1) total += affectionActionsRequiredForLevel(current);
  return total;
}

/** Lv.100 に到達するために必要な、なでた回数。 */
export const MAX_AFFECTION = affectionValueForLevel(MAX_AFFECTION_LEVEL);

export function affectionProgressForValue(affection: number): { level: number; progress: number; required: number } {
  const clamped = Math.max(0, Math.min(MAX_AFFECTION, Math.floor(affection)));
  let accumulated = 0;
  for (let level = 1; level < MAX_AFFECTION_LEVEL; level += 1) {
    const required = affectionActionsRequiredForLevel(level);
    if (clamped < accumulated + required) return { level, progress: clamped - accumulated, required };
    accumulated += required;
  }
  return { level: MAX_AFFECTION_LEVEL, progress: 0, required: 0 };
}

export function affectionLevelForValue(affection: number): number {
  return affectionProgressForValue(affection).level;
}

/** なつきゲージで塗りつぶすハート数。1の位が0なら、次の10Lvセットの空枠を表示する。 */
export function affectionHeartCountForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_AFFECTION_LEVEL, Math.floor(level)));
  return clamped % 10;
}

/** なでた時の演出用。節目でもハートが消えないよう最低1個は出す。 */
export function affectionEffectHeartCountForLevel(level: number): number {
  return Math.max(1, affectionHeartCountForLevel(level));
}

/** 10Lvごとの色を返す。 */
export function affectionHeartColorForLevel(level: number): string {
  const clamped = Math.max(1, Math.min(MAX_AFFECTION_LEVEL, Math.floor(level)));
  const colorIndex = Math.ceil(clamped / 10) - 1;
  return AFFECTION_HEART_COLORS[colorIndex] ?? AFFECTION_HEART_COLORS[AFFECTION_HEART_COLORS.length - 1]!;
}

export function affectionStageForLevel(level: number) {
  const clamped = Math.max(1, Math.floor(level));
  const milestone = Math.ceil(clamped / 10) * 10;
  return AFFECTION_STAGES.find((stage) => stage.level === milestone) ?? AFFECTION_STAGES[AFFECTION_STAGES.length - 1]!;
}

export function localDateKey(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, '0');
  const d = String(at.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function levelAndPointsForBodyLength(bodyLengthCm: number): { level: number; points: number } {
  const cm = Math.max(0.5, bodyLengthCm);
  // 最初だけ 0.5cm→1cm の半cm区間。体長とptの対応もこの幅に合わせる。
  if (cm < 1) {
    return {
      level: 1,
      points: ((cm - 0.5) / 0.5) * growthPointsRequiredForLevel(1),
    };
  }
  const wholeCm = Math.floor(cm);
  const level = wholeCm + 1;
  const fraction = Math.max(0, Math.min(0.999999, cm - wholeCm));
  return { level, points: fraction * growthPointsRequiredForLevel(level) };
}

export type CareAction = 'feed' | 'water' | 'pet';

export type CareActionResult = {
  state: AppState;
  growthPointsEarned: number;
  affectionEarned: number;
  levelUps: number;
  dailyBonusEarned: boolean;
};

export const CARE_POINT_UNLOCK_PERCENT = 99.5;

/** 次に通常のお世話で体長ptを得られるまでの目安。小数のゲージ値から計算する。 */
export function growthPointWaitLabel(gaugePercent: number, secondsPerOnePercent: number): string {
  const seconds = Math.max(0, gaugePercent - CARE_POINT_UNLOCK_PERCENT) * secondsPerOnePercent;
  if (seconds <= 1) return '+1pt！';
  const totalMinutes = Math.ceil(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `あと${hours}時間で+1pt` : `あと${minutes}分で+1pt`;
}

/** ゲージが0%になるまでの目安を、時・分・秒で表示する。 */
export function careTimeUntilEmptyLabel(gaugePercent: number, secondsPerOnePercent: number): string {
  if (gaugePercent <= 0) return '空っぽ';
  const totalSeconds = Math.ceil(Math.min(100, gaugePercent) * secondsPerOnePercent);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `空まであと${hours}時間${minutes}分${seconds}秒`;
  if (minutes > 0) return `空まであと${minutes}分${seconds}秒`;
  return `空まであと${seconds}秒`;
}

/** おなか／ヌメリを満タンへ戻すのに必要な、残りお世話回数（最大3回）。 */
export function careActionsRemainingForGauge(gaugePercent: number): number {
  const clamped = Math.max(0, Math.min(100, gaugePercent));
  if (clamped >= CARE_POINT_UNLOCK_PERCENT) return 0;
  // 回復量と同じ33.3%単位で、残りの獲得可能ptを数える。
  // 0%→33.3%→66.7%→100% の各タップと、+3/+2/+1の表示が一致する。
  return Math.max(0, Math.min(3, Math.ceil((100 - clamped) / (100 / 3) - 0.000001)));
}

/**
 * 体長+1ptは、ゲージが満タンでない時だけ獲得できる。
 * 満タン直後のわずかな減少を連打しても、ポイントは増えない。
 */
export function careGrowthPointsForGauge(gaugePercent: number, growthLevel: number = 1): number {
  void growthLevel;
  return careActionsRemainingForGauge(gaugePercent) > 0 ? 1 : 0;
}

/**
 * ごはん／おみずは毎回33.3%ずつ回復する。3回で満タンになる。
 */
function replenishCareGauge(gaugePercent: number): number {
  const replenished = Math.min(100, gaugePercent + 100 / 3);
  // 画面が100%と表示する範囲は、内部値も100%へそろえて判定の食い違いを防ぐ。
  return replenished >= CARE_POINT_UNLOCK_PERCENT ? 100 : replenished;
}

/**
 * 通常のお世話で、種類ごとに1日獲得できる体長ptの上限。
 * ごほうびお世話・ミッションの直接ptは対象外。体が育つほど、1日の世話で得られる
 * 成長の余地も少しずつ広がるようにする。
 */
export function dailyCareGrowthPointCapForLevel(level: number): number {
  const cm = bodyLengthAtLevel(level);
  // 生まれたては一気に伸びすぎないよう、最初の数cmは控えめにする。
  if (cm < 5) return 6;
  if (cm < 10) return 12;
  if (cm < 20) return 16;
  if (cm < 50) return 18;
  if (cm < 100) return 20;
  return 22;
}

function withCurrentCareDay(state: AppState, at: Date): AppState {
  const careDate = localDateKey(at);
  if (state.careDate === careDate) return state;
  return {
    ...state,
    careDate,
    feedCountToday: 0,
    waterCountToday: 0,
    feedGrowthPointsToday: 0,
    waterGrowthPointsToday: 0,
    petNormalCountToday: 0,
    petCountToday: 0,
    dailyFeedMissionComplete: false,
    dailyWaterMissionComplete: false,
    dailyPetMissionComplete: false,
    dailyPetBonusClaimed: false,
    dailyPetBonusUsesRemaining: 0,
    dailyPetBonusUsed: false,
    dailyCareBonusAwarded: false,
  };
}

function syncBodyLength(level: number, points: number): number {
  const needed = growthPointsRequiredForLevel(level);
  const fraction = needed > 0 ? Math.max(0, Math.min(1, points / needed)) : 0;
  // 0.5cm→1cmだけは、1ptあたり0.1cmになるように0.5cm幅で補間する。
  const intervalCm = level === 1 ? 0.5 : 1;
  return bodyLengthAtLevel(level) + fraction * intervalCm;
}

function addGrowthPoints(state: AppState, amount: number): { state: AppState; levelUps: number } {
  let level = Math.max(1, state.growthLevel ?? 1);
  let points = Math.max(0, state.growthPoints ?? 0) + amount;
  let levelUps = 0;
  while (points >= growthPointsRequiredForLevel(level)) {
    const needed = growthPointsRequiredForLevel(level);
    if (points < needed) break;
    points -= needed;
    level += 1;
    levelUps += 1;
  }
  return {
    state: { ...state, growthLevel: level, growthPoints: points, bodyLengthCm: syncBodyLength(level, points) },
    levelUps,
  };
}

/** 成長の道のりの到達報酬を、体長ごとに一度だけ受け取る。 */
export function claimGrowthMissionReward(state: AppState, cm: number): {
  state: AppState;
  claimed: boolean;
  amount: number;
  directPoints: number;
  reward: GrowthMissionRewardKind;
} {
  const id = growthMissionIdForCm(cm);
  const reward = growthMissionRewardKindForCm(cm);
  const amount = growthMissionRewardForCm(cm);
  const directPoints = growthMissionDirectPointsForCm(cm);
  const stageExists = GROWTH_STAGES.some((stage) => stage.cm === cm);
  if (!stageExists || amount <= 0 || state.bodyLengthCm + 1e-9 < cm || (state.claimedGrowthMissionIds ?? []).includes(id)) {
    return { state, claimed: false, amount: 0, directPoints: 0, reward: 'none' };
  }
  // 報酬はすぐにptへ変えず、対応する通常ボタンを3回だけ「ごほうび」に変える。
  // ごほうび使用時はゲージを変えず、1回につき体長+1ptを得る。
  const rewardedState = {
      ...state,
      claimedGrowthMissionIds: [...(state.claimedGrowthMissionIds ?? []), id],
      bonusFeedCare: (state.bonusFeedCare ?? 0) + (reward === 'feed' || reward === 'both' ? amount : 0),
      bonusWaterCare: (state.bonusWaterCare ?? 0) + (reward === 'water' || reward === 'both' ? amount : 0),
    };
  const grown = addGrowthPoints(rewardedState, directPoints);
  return {
    state: grown.state,
    claimed: true,
    amount,
    directPoints,
    reward,
  };
}

/** ごほうびごはん／おみずを1回使う。ゲージは変えず、体長ptだけを得る。 */
export function applyGrowthMissionBonusCare(
  state: AppState,
  kind: 'feed' | 'water'
): { state: AppState; used: boolean; levelUps: number } {
  const key = kind === 'feed' ? 'bonusFeedCare' : 'bonusWaterCare';
  const remaining = Math.max(0, Math.floor(state[key] ?? 0));
  if (remaining <= 0 || state.condition === 'dead') return { state, used: false, levelUps: 0 };
  const grown = addGrowthPoints({ ...state, [key]: remaining - 1 }, 1);
  return { state: grown.state, used: true, levelUps: grown.levelUps };
}

/**
 * お世話による成長・なつきの更新。
 * Feed / Water は1回ごとに約3分の1を回復する。
 * +1ptはゲージが1/3以上減った区切りを越えた時だけ得られ、残量0%なら3回で3pt得る。
 */
export function applyCareAction(state: AppState, action: CareAction, at: Date = new Date()): CareActionResult {
  if (state.condition === 'dead') {
    return { state, growthPointsEarned: 0, affectionEarned: 0, levelUps: 0, dailyBonusEarned: false };
  }
  let next = withCurrentCareDay(state, at);
  let growthPointsEarned = 0;
  let affectionEarned = 0;
  let dailyBonusEarned = false;

  if (action === 'feed') {
    const count = next.feedCountToday ?? 0;
    const earnedToday = next.feedGrowthPointsToday ?? 0;
    const dailyCap = dailyCareGrowthPointCapForLevel(next.growthLevel ?? 1);
    growthPointsEarned = earnedToday < dailyCap
      ? careGrowthPointsForGauge(next.fullness, next.growthLevel ?? 1)
      : 0;
    const nextFullness = replenishCareGauge(next.fullness);
    next = {
      ...next,
      fullness: nextFullness,
      feedCountToday: Math.min(3, count + 1),
      feedGrowthPointsToday: Math.min(dailyCap, earnedToday + growthPointsEarned),
      dailyFeedMissionComplete: next.dailyFeedMissionComplete || nextFullness >= CARE_POINT_UNLOCK_PERCENT,
    };
  } else if (action === 'water') {
    const count = next.waterCountToday ?? 0;
    const earnedToday = next.waterGrowthPointsToday ?? 0;
    const dailyCap = dailyCareGrowthPointCapForLevel(next.growthLevel ?? 1);
    growthPointsEarned = earnedToday < dailyCap
      ? careGrowthPointsForGauge(next.viscosity, next.growthLevel ?? 1)
      : 0;
    const nextViscosity = replenishCareGauge(next.viscosity);
    next = {
      ...next,
      viscosity: nextViscosity,
      waterCountToday: Math.min(3, count + 1),
      waterGrowthPointsToday: Math.min(dailyCap, earnedToday + growthPointsEarned),
      dailyWaterMissionComplete: next.dailyWaterMissionComplete || nextViscosity >= CARE_POINT_UNLOCK_PERCENT,
    };
  } else {
    const normalLimit = dailyPetNormalLimitForAffectionValue(next.affection ?? 0);
    const normalCount = Math.max(0, Math.min(normalLimit, next.petNormalCountToday ?? Math.min(next.petCountToday ?? 0, normalLimit)));
    // 旧セーブの「受取済み・未使用」は、従来どおり残り1回として扱う。
    const bonusUsesRemaining = Math.max(0, Math.min(
      DAILY_PET_BONUS_USES,
      next.dailyPetBonusUsesRemaining ?? (next.dailyPetBonusClaimed === true && !next.dailyPetBonusUsed ? 1 : 0),
    ));
    const usesBonus = bonusUsesRemaining > 0;
    const canPet = usesBonus || normalCount < normalLimit;
    affectionEarned = canPet && (next.affection ?? 0) < MAX_AFFECTION ? 1 : 0;
    const nextNormalCount = normalCount + (canPet && !usesBonus ? 1 : 0);
    const nextBonusUsesRemaining = bonusUsesRemaining - (canPet && usesBonus ? 1 : 0);
    // なかよしミッションは、そのLv帯に応じた通常なでなでを使い切ると達成。
    // 報酬を受取済みなら、Lvアップで上限が増えても達成状態は保つ。
    const completesPetMission = next.dailyPetBonusClaimed === true || nextNormalCount >= normalLimit;
    next = {
      ...next,
      petNormalCountToday: nextNormalCount,
      petCountToday: canPet ? (next.petCountToday ?? 0) + 1 : (next.petCountToday ?? 0),
      affection: Math.min(MAX_AFFECTION, Math.max(0, next.affection ?? 0) + affectionEarned),
      dailyPetMissionComplete: completesPetMission,
      dailyPetBonusUsesRemaining: nextBonusUsesRemaining,
      dailyPetBonusUsed: next.dailyPetBonusClaimed === true && nextBonusUsesRemaining <= 0,
    };
  }

  // お世話ミッションの報酬は、ミッション画面で「受け取る」を押すまで付与しない。
  const grown = addGrowthPoints(next, growthPointsEarned);
  return { ...grown, growthPointsEarned, affectionEarned, dailyBonusEarned };
}

export type DailyCareMissionClaimResult = {
  state: AppState;
  claimed: boolean;
  levelUps: number;
};

/** お世話ミッションの報酬（体長+1pt）を、当日1回だけ受け取る。 */
export function claimDailyCareMissionReward(state: AppState, at: Date = new Date()): DailyCareMissionClaimResult {
  const next = withCurrentCareDay(state, at);
  const missionComplete = next.dailyFeedMissionComplete === true && next.dailyWaterMissionComplete === true;
  if (!missionComplete || next.dailyCareBonusAwarded) {
    return { state: next, claimed: false, levelUps: 0 };
  }
  const claimed = addGrowthPoints({ ...next, dailyCareBonusAwarded: true }, 1);
  return { state: claimed.state, claimed: true, levelUps: claimed.levelUps };
}

/** なかよしミッションの報酬（ごほうびなでなで3回）を、当日1回だけ受け取る。 */
export function claimDailyPetMissionReward(state: AppState, at: Date = new Date()): { state: AppState; claimed: boolean } {
  const next = withCurrentCareDay(state, at);
  if (!next.dailyPetMissionComplete || next.dailyPetBonusClaimed || next.dailyPetBonusUsed) {
    return { state: next, claimed: false };
  }
  return {
    state: { ...next, dailyPetBonusClaimed: true, dailyPetBonusUsed: false, dailyPetBonusUsesRemaining: DAILY_PET_BONUS_USES },
    claimed: true,
  };
}

/** 開発用: 当日のミッションを未達成へ戻し、最初から確認できる状態にする。 */
export function resetDailyMissionsForDebug(state: AppState, at: Date = new Date()): AppState {
  let next = withCurrentCareDay(state, at);
  return {
    ...next,
    fullness: 0,
    viscosity: 0,
    feedCountToday: 0,
    waterCountToday: 0,
    feedGrowthPointsToday: 0,
    waterGrowthPointsToday: 0,
    petNormalCountToday: 0,
    petCountToday: 0,
    dailyFeedMissionComplete: false,
    dailyWaterMissionComplete: false,
    dailyPetMissionComplete: false,
    dailyPetBonusClaimed: false,
    dailyPetBonusUsesRemaining: 0,
    dailyPetBonusUsed: false,
    dailyCareBonusAwarded: false,
  };
}

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
  return cm;
};

/** 画像スケール用 0〜1（体長が TARGET_CM に達すると 1） */
export const getOosanGrowthProgress = (
  growthAnchorMs: number,
  nowMs: number = Date.now()
): number => {
  return Math.min(1, getOosanLengthCm(growthAnchorMs, nowMs) / GROWTH_TARGET_CM);
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

/** 画面右上の段階名。成長の道のり表と同じ名称を返す。 */
export const getGrowthPhaseLabel = (bodyLengthCm: number): string => {
  const currentStage = GROWTH_STAGES
    .filter((stage) => bodyLengthCm >= stage.cm)
    .at(-1);
  return currentStage?.name ?? GROWTH_STAGES[0].name;
};

/** 満腹度バー色（緑→黄→赤） */
export const fullnessBarColor = (fullness: number): string => {
  if (fullness >= 60) return '#4caf50';
  if (fullness >= 30) return '#ffeb3b';
  return '#f44336';
};

/** ヌメリ度バー色（水色→黄→赤）。おなかと同じ残量の目安で注意色に切り替える。 */
export const viscosityBarColor = (viscosity: number): string => {
  if (viscosity >= 60) return '#3baee0';
  if (viscosity >= 30) return '#ffeb3b';
  return '#f44336';
};

// 初期状態を生成
export const createInitialState = (): AppState => {
  const today = new Date().toISOString().split('T')[0];
  const now = Date.now();
  return {
    oosanName: DEFAULT_OOSAN_NAME,
    startDate: today,
    lastVisitDate: today,
    lastGrowthDate: today,
    sizeFactor: 1.0,
    growthAnchorMs: now,
    bodyLengthCm: bodyLengthAtLevel(1),
    // 初めて会う時は、最初のお世話がすぐ分かるように少しだけ空腹・乾き気味にする。
    fullness: 1,
    viscosity: 1,
    condition: 'healthy',
    latestLog: '川の底で静かに過ごしています。',
    claimedMilestoneIds: [],
    claimedGrowthMissionIds: [],
    bonusFeedCare: 0,
    bonusWaterCare: 0,
    sessionForegroundMs: 0,
    lastGrowthTickMs: now,
    growthLevel: 1,
    growthPoints: 0,
    growthModelVersion: GROWTH_MODEL_VERSION,
    affection: 0,
    affectionModelVersion: AFFECTION_MODEL_VERSION,
    careDate: localDateKey(),
    feedCountToday: 0,
    waterCountToday: 0,
    feedGrowthPointsToday: 0,
    waterGrowthPointsToday: 0,
    petNormalCountToday: 0,
    petCountToday: 0,
    dailyFeedMissionComplete: false,
    dailyWaterMissionComplete: false,
    dailyPetMissionComplete: false,
    dailyPetBonusClaimed: false,
    dailyPetBonusUsesRemaining: 0,
    dailyPetBonusUsed: false,
    dailyCareBonusAwarded: false,
  };
};

/**
 * デバッグで体長を上書きするときに更新するフィールドだけを揃える。
 * 次の目標（体長・sessionForegroundMs・claimed）と 1 秒ティック（アンカー・lastGrowthTick）が噛み合うようにする。
 * デバッグ開始時にも最初のお世話を試せるよう、満腹度・ヌメリ度は1%に戻す。
 */
export function patchStateForDebugBodyLengthCm(
  s: AppState,
  bodyLengthCm: number,
  atMs: number = Date.now()
): AppState {
  // デバッグでは「12cmなら 12cm・0/必要pt」から確実に試せるよう、cm単位へ揃える。
  const clamped = bodyLengthCm < 1 ? 0.5 : Math.floor(bodyLengthCm);
  const progress = levelAndPointsForBodyLength(clamped);
  const sessionForegroundMs =
    bodyLengthCm < 1 ? 0 : Math.round((clamped / GROWTH_CM_PER_SECOND) * 1000);
  return {
    ...s,
    bodyLengthCm: clamped,
    fullness: 1,
    viscosity: 1,
    growthLevel: progress.level,
    growthPoints: 0,
    growthModelVersion: GROWTH_MODEL_VERSION,
    claimedMilestoneIds: [],
    claimedGrowthMissionIds: [],
    bonusFeedCare: 0,
    bonusWaterCare: 0,
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
  merged.oosanName = normalizeOosanName(raw.oosanName);
  const hasOneCentimeterGrowth =
    raw.growthModelVersion === GROWTH_MODEL_VERSION &&
    typeof raw.growthLevel === 'number' &&
    Number.isFinite(raw.growthLevel) &&
    typeof raw.growthPoints === 'number' &&
    Number.isFinite(raw.growthPoints);
  if (hasOneCentimeterGrowth) {
    const level = Math.max(1, Math.floor(raw.growthLevel as number));
    const maximum = growthPointsRequiredForLevel(level);
    const points = Math.max(0, Math.min(maximum - 1, raw.growthPoints as number));
    merged.growthLevel = level;
    merged.growthPoints = points;
    merged.bodyLengthCm = syncBodyLength(level, points);
  } else {
    const legacyLength =
      typeof raw.bodyLengthCm === 'number' && Number.isFinite(raw.bodyLengthCm)
        ? raw.bodyLengthCm
        : 0;
    const progress = levelAndPointsForBodyLength(legacyLength);
    merged.growthLevel = progress.level;
    merged.growthPoints = progress.points;
    merged.bodyLengthCm = syncBodyLength(progress.level, progress.points);
  }
  merged.growthModelVersion = GROWTH_MODEL_VERSION;
  const rawAffection = typeof raw.affection === 'number' && Number.isFinite(raw.affection)
    ? Math.max(0, Math.floor(raw.affection))
    : 0;
  if (raw.affectionModelVersion === AFFECTION_MODEL_VERSION) {
    merged.affection = Math.min(MAX_AFFECTION, rawAffection);
  } else {
    // 旧版の見た目Lvと、そのLv内の進み具合をできるだけ維持して新しい可変必要回数へ移行する。
    const wasVersion4 = raw.affectionModelVersion === 4;
    const wasVersion3 = raw.affectionModelVersion === 3;
    const wasVersion2 = raw.affectionModelVersion === 2;
    let oldLevel: number;
    let oldProgress: number;
    let oldUnit: number;
    if (wasVersion4 || wasVersion3) {
      let total = 0;
      oldLevel = 1;
      for (; oldLevel < 100; oldLevel += 1) {
        const required = wasVersion4
          ? Math.min(25, Math.max(5, oldLevel + 4))
          : Math.min(15, Math.max(3, oldLevel + 2));
        if (rawAffection < total + required) break;
        total += required;
      }
      oldProgress = rawAffection - total;
      oldUnit = wasVersion4
        ? Math.min(25, Math.max(5, oldLevel + 4))
        : Math.min(15, Math.max(3, oldLevel + 2));
    } else {
      oldUnit = wasVersion2 ? 5 : 10;
      const oldMax = wasVersion2 ? 495 : 100;
      const oldMaxLevel = wasVersion2 ? 100 : 10;
      const oldValue = Math.min(oldMax, rawAffection);
      oldLevel = Math.min(oldMaxLevel, Math.floor(oldValue / oldUnit) + 1);
      oldProgress = oldValue % oldUnit;
    }
    const newRequired = affectionActionsRequiredForLevel(oldLevel);
    merged.affection = Math.min(
      MAX_AFFECTION,
      affectionValueForLevel(oldLevel) + Math.round((oldProgress / oldUnit) * newRequired)
    );
  }
  merged.affectionModelVersion = AFFECTION_MODEL_VERSION;
  const today = localDateKey();
  const careIsToday = raw.careDate === today;
  merged.careDate = today;
  merged.feedCountToday = careIsToday && typeof raw.feedCountToday === 'number'
    ? Math.max(0, Math.min(3, Math.floor(raw.feedCountToday)))
    : 0;
  merged.waterCountToday = careIsToday && typeof raw.waterCountToday === 'number'
    ? Math.max(0, Math.min(3, Math.floor(raw.waterCountToday)))
    : 0;
  const dailyCareCap = dailyCareGrowthPointCapForLevel(merged.growthLevel ?? 1);
  merged.feedGrowthPointsToday = careIsToday && typeof raw.feedGrowthPointsToday === 'number'
    ? Math.max(0, Math.min(dailyCareCap, Math.floor(raw.feedGrowthPointsToday)))
    : 0;
  merged.waterGrowthPointsToday = careIsToday && typeof raw.waterGrowthPointsToday === 'number'
    ? Math.max(0, Math.min(dailyCareCap, Math.floor(raw.waterGrowthPointsToday)))
    : 0;
  const petNormalLimit = dailyPetNormalLimitForAffectionValue(merged.affection ?? 0);
  merged.petNormalCountToday = careIsToday
    ? Math.max(0, Math.min(petNormalLimit, Math.floor(
      typeof raw.petNormalCountToday === 'number' ? raw.petNormalCountToday : raw.petCountToday ?? 0,
    )))
    : 0;
  const legacyBonusRemaining = raw.dailyPetBonusClaimed === true && raw.dailyPetBonusUsed !== true ? 1 : 0;
  merged.dailyPetBonusUsesRemaining = careIsToday
    ? Math.max(0, Math.min(DAILY_PET_BONUS_USES, Math.floor(
      typeof raw.dailyPetBonusUsesRemaining === 'number' ? raw.dailyPetBonusUsesRemaining : legacyBonusRemaining,
    )))
    : 0;
  merged.petCountToday = careIsToday && typeof raw.petCountToday === 'number'
    ? Math.max(0, Math.min(petNormalLimit + DAILY_PET_BONUS_USES, Math.floor(raw.petCountToday)))
    : 0;
  merged.dailyFeedMissionComplete = careIsToday && raw.dailyFeedMissionComplete === true;
  merged.dailyWaterMissionComplete = careIsToday && raw.dailyWaterMissionComplete === true;
  merged.dailyPetMissionComplete = careIsToday && (
    raw.dailyPetBonusClaimed === true ||
    raw.dailyPetBonusUsed === true ||
    (raw.dailyPetMissionComplete === true && (merged.petNormalCountToday ?? 0) >= petNormalLimit)
  );
  merged.dailyPetBonusClaimed = careIsToday && (raw.dailyPetBonusClaimed === true || raw.dailyPetBonusUsed === true);
  merged.dailyPetBonusUsed = careIsToday && merged.dailyPetBonusClaimed === true && merged.dailyPetBonusUsesRemaining <= 0;
  merged.dailyCareBonusAwarded = careIsToday && raw.dailyCareBonusAwarded === true;
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
  merged.claimedGrowthMissionIds = Array.isArray(raw.claimedGrowthMissionIds)
    ? raw.claimedGrowthMissionIds.filter((x): x is string => typeof x === 'string')
    : [];
  merged.bonusFeedCare = typeof raw.bonusFeedCare === 'number' ? Math.max(0, Math.floor(raw.bonusFeedCare)) : 0;
  merged.bonusWaterCare = typeof raw.bonusWaterCare === 'number' ? Math.max(0, Math.floor(raw.bonusWaterCare)) : 0;
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
 * バックグラウンドでも、おなか・ヌメリともに100→0を平均約12時間にそろえる。
 * App.tsx の1%あたり432秒の基準減少量に、そのまま1倍を掛ける。
 */
export const GAUGE_DECAY_MULT_BACKGROUND_STABLE = 1;

/** 開始直後だけ減り方が速くなる特例は使わない。 */
export const EARLY_CARE_BG_DAYS = 0;
export const EARLY_CARE_BG_EXTRA_MULT = 1;

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

  // 健康な日は、成長段階ごとの6文から選ぶ（なでるボタンと同じ反応）。
  return pickTapMessage(state);
};
