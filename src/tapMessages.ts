/**
 * オオサンショウウオを直接なでた時に表示する短いひとこと。
 * 育成Lvごとに、成長に合った雰囲気と生態の豆知識を切り替える。
 */
export const TAP_MESSAGE_GROUPS = [
  {
    minLevel: 1,
    maxLevel: 3,
    name: 'うまれたて',
    messages: [
      '新しい住処を見つけました。',
      'えらをひらひら。水の流れを感じています。',
      '小さな石のすき間が、今日のお気に入り。',
      '川底の砂がひんやりして気持ちよさそう。',
      '小さな前あしで、そっと水をかいています。',
      '水草の影で、ひと休みしています。',
    ],
  },
  {
    minLevel: 4,
    maxLevel: 9,
    name: '沢のちびっこ',
    messages: [
      '岩の模様にまぎれて、かくれんぼ中。',
      '前あしの指は4本、後ろあしの指は5本です。',
      '流れが強すぎない場所を、のんびり探検中。',
      '昼は岩陰のような暗く狭い場所が落ち着きます。',
      'じっと待つのも、オオサンショウウオの得意技。',
      '川底を歩いて、新しい石を見つけました。',
    ],
  },
  {
    minLevel: 10,
    maxLevel: 39,
    name: 'おとなデビュー',
    messages: [
      '大人の姿になりました。川の中で暮らします。',
      '一生を水の中で過ごす、大きな両生類です。',
      'ときどき水面に口を出して、空気を吸います。',
      '夜になると、いっそう活発になります。',
      '魚やサワガニなどを待ち伏せして食べます。',
      '流れる川の中流から上流が、主な住処です。',
    ],
  },
  {
    minLevel: 40,
    maxLevel: 69,
    name: '川の若者',
    messages: [
      '川の流れを読みながら、ゆっくり泳いでいます。',
      '視力より、水の振動や気配を頼りにしています。',
      '昼の岩陰から、夜の川へ出かける準備中。',
      '日本に昔から暮らす、国の特別天然記念物です。',
      '皮ふから出るぬめりが、体を守っています。',
      '大きな口で、獲物をすばやく丸のみします。',
    ],
  },
  {
    minLevel: 70,
    maxLevel: 99,
    name: 'ヌシへの道',
    messages: [
      '深い淵の静けさが、よく似合う大きさです。',
      '繁殖の季節には、オスが巣穴で卵を守ります。',
      '川をきれいに保つことが、仲間を守ることにつながります。',
      '約2300万年前から姿が変わらないともいわれます。',
      '世界最大級の両生類へ、ゆっくり近づいています。',
      '川の底で、今日も静かに見回り中。',
    ],
  },
  {
    minLevel: 100,
    maxLevel: 100,
    name: '伝説の川のヌシ',
    messages: [
      '伝説の川のヌシは、今日も川を見守っています。',
      '世界最大級の両生類。全長150cmを超える例もあります。',
      '「生きた化石」と呼ばれることもある、不思議ないきものです。',
      '長い時間をかけて育った、かけがえのない仲間です。',
      '川の流れも、季節の気配も、すっかりお見通し。',
      'これからも、ゆっくり一緒に暮らしていこう。',
    ],
  },
] as const;

export type TapMessageGroup = (typeof TAP_MESSAGE_GROUPS)[number];

export function tapMessageGroupForGrowthLevel(level: number): TapMessageGroup {
  const clamped = Math.max(1, Math.floor(level));
  return TAP_MESSAGE_GROUPS.find((group) => clamped >= group.minLevel && clamped <= group.maxLevel)
    ?? TAP_MESSAGE_GROUPS[TAP_MESSAGE_GROUPS.length - 1]!;
}

/** 直前のログと重複しない候補から、タップ用のひとことを1つ選ぶ。 */
export function pickTapMessage(
  state: { growthLevel?: number; latestLog?: string },
  random: () => number = Math.random
): string {
  const group = tapMessageGroupForGrowthLevel(state.growthLevel ?? 1);
  const withoutPrevious = group.messages.filter((message) => message !== state.latestLog);
  const candidates = withoutPrevious.length > 0 ? withoutPrevious : group.messages;
  return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]!;
}

/**
 * 日々のひとこと・直接タップで共通に使うセリフ。
 * 成長段階に応じた反応と、日常・成長・雑学のひとことを同じ候補群へ混ぜる。
 */
export function pickOosanMessage(
  state: { growthLevel?: number; latestLog?: string },
  random: () => number = Math.random
): string {
  const pool = [...healthyMessages];
  const candidates = pool.filter((message) => message !== state.latestLog);
  const selectable = candidates.length > 0 ? candidates : pool;
  return selectable[Math.min(selectable.length - 1, Math.floor(random() * selectable.length))]!;
}

/** 共通セリフのうち、名前を主語にする自然な文だけを判定する。 */
export function oosanMessageUsesName(message: string): boolean {
  // 成長段階ごとの反応は、アプリ起動・なでるボタン専用なので全て名前入りにする。
  return dailyLogUsesOosanName(message) || TAP_MESSAGE_GROUPS.some((group) => (group.messages as readonly string[]).includes(message));
}
import { dailyLogUsesOosanName, healthyMessages } from './healthyMessages';
