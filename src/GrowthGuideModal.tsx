import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  AFFECTION_STAGES,
  affectionHeartColorForLevel,
  affectionHeartCountForLevel,
  affectionLevelForValue,
  GROWTH_STAGES,
  dailyCareGrowthPointCapForLevel,
  growthMissionRewardKindForCm,
  growthMissionRewardForCm,
  growthPointsRequiredForLevel,
} from './logic';

const AFFECTION_HEART_COLOR_NAMES = [
  'ピンク', 'コーラル', 'オレンジ', 'きいろ', '黄緑',
  'みどり', '水色', '青', 'むらさき', '金色',
] as const;

type Props = {
  visible: boolean;
  onClose: () => void;
  affection: number;
  bodyLengthCm: number;
  oosanName: string;
};

export function GrowthGuideModal({ visible, onClose, affection, bodyLengthCm, oosanName }: Props) {
  const affectionLevel = affectionLevelForValue(affection);
  const affectionMilestone = Math.min(100, Math.ceil(affectionLevel / 10) * 10);
  const affectionHeartCount = affectionHeartCountForLevel(affectionLevel);
  const completedAffectionTens = Math.floor(affectionLevel / 10) * 10;
  const affectionHeartSummary = `${completedAffectionTens > 0 ? `+${completedAffectionTens} ` : ''}${'♥'.repeat(affectionHeartCount)}${'♡'.repeat(10 - affectionHeartCount)}`;
  const affectionHeartColor = affectionHeartColorForLevel(affectionLevel);
  const currentGrowthStage = GROWTH_STAGES.filter((stage) => bodyLengthCm >= stage.cm).at(-1) ?? GROWTH_STAGES[0];
  const nextCm = Math.floor(bodyLengthCm) + 1;
  const nextGrowth = `次の ${nextCm}cm まで あと ${Math.max(0, nextCm - bodyLengthCm).toFixed(1)}cm`;
  const growthLevel = bodyLengthCm < 1 ? 1 : Math.floor(bodyLengthCm) + 1;
  const growthPointsNeeded = growthPointsRequiredForLevel(growthLevel);
  const dailyCareCap = dailyCareGrowthPointCapForLevel(growthLevel);
  const hasAdultRoadUnlocked = bodyLengthCm >= 20;
  const babyGrowthStages = GROWTH_STAGES.filter((stage) => stage.cm <= 20);
  const adultGrowthStages = GROWTH_STAGES.filter((stage) => stage.cm > 20);

  const renderGrowthStage = (stage: (typeof GROWTH_STAGES)[number]) => {
    const isCurrent = stage.cm === currentGrowthStage.cm;
    const isComplete = stage.cm < currentGrowthStage.cm;
    const reward = growthMissionRewardKindForCm(stage.cm);
    const rewardIconCount = Math.max(0, Math.ceil(growthMissionRewardForCm(stage.cm) / 3));
    return (
      <View key={stage.cm} style={[styles.stageRow, isCurrent && styles.stageCurrentRow]}>
        <Text style={[styles.stageLength, isCurrent && styles.stageCurrentText]}>{`${stage.cm}cm`}</Text>
        <Text style={[styles.stageName, isCurrent && styles.stageCurrentText]}>{stage.name}</Text>
        {stage.cm === 20 && (
          <View style={styles.adultStageBadge}>
            <Text style={styles.adultStageBadgeText}>姿が変わる</Text>
          </View>
        )}
        <View style={styles.rewardSlot}>
          {(reward === 'feed' || reward === 'both') && Array.from({ length: rewardIconCount }, (_, index) => <Ionicons key={`feed-${index}`} name="restaurant" size={15} color="#e49b3c" />)}
          {(reward === 'water' || reward === 'both') && Array.from({ length: rewardIconCount }, (_, index) => <Ionicons key={`water-${index}`} name="water" size={15} color="#3baee0" />)}
        </View>
        <View style={styles.stageStatusSlot}>
          {isComplete && <Text style={styles.completeStatus}>✓ 完了</Text>}
          {isCurrent && <Text style={styles.currentStatus}>いまここ</Text>}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="説明を閉じる" />
        <View style={styles.card}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator
            nestedScrollEnabled
          >
            <Text style={styles.title}>体長となつき度</Text>

            <View style={styles.currentCard}>
              <Text style={styles.currentLabel}>いまの {oosanName}</Text>
              <Text style={styles.currentValue}>体長 {bodyLengthCm.toFixed(1)}cm</Text>
              <Text style={styles.currentSub}>{nextGrowth}</Text>
              <Text style={styles.currentSub}>次の1cmまで {growthPointsNeeded}pt</Text>
              <Text style={styles.currentSub}>きょうのお世話上限：ごはん・おみず 各{dailyCareCap}pt</Text>
              <Text style={styles.currentValue}>なつきLv.{affectionLevel} / 100</Text>
              <Text style={[styles.hearts, { color: affectionHeartColor }]}>{affectionHeartSummary}</Text>
            </View>

            <Text style={styles.sectionTitle}>{oosanName}の成長の道のり</Text>
            <Text style={styles.note}>体長は1cmずつ育ち、必要ptは毎cm+1ずつ増え続けます。節目ではお祝いと報酬があります。🍴はごほうびごはん、💧はごほうびおみずです。</Text>
            <View style={styles.stageTable}>
              {babyGrowthStages.map(renderGrowthStage)}
            </View>
            {!hasAdultRoadUnlocked ? (
              <View style={styles.adultRoadLocked}>
                <Ionicons name="lock-closed" size={18} color="#5a9a91" />
                <View style={styles.adultRoadLockedCopy}>
                  <Text style={styles.adultRoadLockedTitle}>まだ見ぬ、成体の道のり</Text>
                  <Text style={styles.adultRoadLockedSub}>20cmの「おとなデビュー」で解放されます</Text>
                </View>
              </View>
            ) : (
              <View style={styles.stageTable}>{adultGrowthStages.map(renderGrowthStage)}</View>
            )}

            <Text style={styles.sectionTitle}>なつき度</Text>
            <Text style={styles.note}>なでると仲良くなれます。ハート10個で1セットを表します。右のハートは、そのLv帯で出る色です。</Text>
            <View style={styles.affectionTable}>
              {AFFECTION_STAGES.map((stage) => {
                const isCurrent = stage.level === 100 ? affectionLevel >= 100 : stage.level === affectionMilestone;
                const isComplete = stage.level < affectionMilestone && !isCurrent;
                const heartColor = affectionHeartColorForLevel(stage.level);
                const heartColorName = AFFECTION_HEART_COLOR_NAMES[Math.ceil(stage.level / 10) - 1] ?? 'ピンク';
                return (
                  <View key={stage.level} style={[styles.affectionRow, isCurrent && styles.affectionCurrentRow]}>
                    <Text style={[styles.affectionStageLevel, isCurrent && styles.affectionCurrentText]}>{`Lv.${stage.level}`}</Text>
                    <Text style={[styles.affectionStageName, isCurrent && styles.affectionCurrentText]}>{stage.name}</Text>
                    <View style={styles.affectionColorSlot}>
                      <Text style={[styles.affectionColorHeart, { color: heartColor }]}>{'♥'}</Text>
                      <Text style={[styles.affectionColorName, isCurrent && styles.affectionCurrentText]}>{heartColorName}</Text>
                    </View>
                    <View style={styles.affectionStatusSlot}>
                      {isComplete && <Text style={styles.affectionCompleteStatus}>✓ 完了</Text>}
                      {isCurrent && <Text style={styles.affectionCurrentStatus}>いまここ</Text>}
                    </View>
                  </View>
                );
              })}
            </View>

            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>閉じる</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 22 },
  card: { width: '100%', height: '84%', borderRadius: 20, backgroundColor: '#f9fffc', overflow: 'hidden' },
  scrollView: { flex: 1 },
  content: { padding: 20, paddingBottom: 24, flexGrow: 1 },
  title: { fontSize: 21, fontWeight: '800', color: '#1b4a46', textAlign: 'center', marginBottom: 14 },
  currentCard: { borderRadius: 14, backgroundColor: '#dff4ed', padding: 14, marginBottom: 16 },
  currentLabel: { fontSize: 12, color: '#43746b', marginBottom: 4 },
  currentValue: { fontSize: 17, fontWeight: '800', color: '#194a43', marginTop: 4 },
  currentSub: { fontSize: 13, color: '#386a61', marginTop: 3 },
  hearts: { fontSize: 18, letterSpacing: 1, color: '#e86e83', marginTop: 3 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1b4a46', marginTop: 8, marginBottom: 6 },
  note: { fontSize: 13, lineHeight: 20, color: '#45655f' },
  pointsTable: { marginTop: 9, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: '#eef8f4' },
  tableLine: { fontSize: 13, lineHeight: 21, color: '#245b52', fontWeight: '600' },
  affectionTable: { marginTop: 9, borderWidth: 1, borderColor: '#f0d8df', borderRadius: 11, overflow: 'hidden' },
  affectionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f4e3e8' },
  affectionCurrentRow: { backgroundColor: '#fff0f4' },
  affectionStageLevel: { width: 42, color: '#bc6177', fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  affectionStageName: { flex: 1, color: '#6a5158', fontSize: 13, fontWeight: '700' },
  affectionColorSlot: { width: 52, alignItems: 'center', justifyContent: 'center' },
  affectionColorHeart: { fontSize: 16, lineHeight: 17, fontWeight: '900' },
  affectionColorName: { marginTop: 1, color: '#8c6a73', fontSize: 8, fontWeight: '800' },
  affectionCurrentText: { color: '#d95776' },
  affectionStatusSlot: { width: 48, alignItems: 'flex-end' },
  affectionCompleteStatus: { color: '#bf7d8d', fontSize: 10, fontWeight: '800' },
  affectionCurrentStatus: { color: '#df5577', fontSize: 10, fontWeight: '900' },
  stageTable: { marginTop: 8, borderWidth: 1, borderColor: '#d2ebe4', borderRadius: 11, overflow: 'hidden' },
  stageRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#dceee9' },
  stageLength: { width: 58, color: '#287568', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  stageName: { flex: 1, color: '#45655f', fontSize: 13, fontWeight: '600' },
  rewardSlot: { width: 64, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 0 },
  stageCurrentRow: { backgroundColor: '#e6f8f2' },
  stageCurrentText: { color: '#168575', fontWeight: '900' },
  stageStatusSlot: { width: 45, alignItems: 'flex-end', marginLeft: 3 },
  completeStatus: { color: '#579f91', fontSize: 10, fontWeight: '800' },
  currentStatus: { color: '#198877', fontSize: 10, fontWeight: '900' },
  adultStageBadge: { borderRadius: 9, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: '#edf8fb', borderWidth: 1, borderColor: '#9ad5e8' },
  adultStageBadgeText: { color: '#287c9b', fontSize: 9, fontWeight: '800' },
  adultRoadLocked: { flexDirection: 'row', alignItems: 'center', marginTop: 9, padding: 12, borderRadius: 11, backgroundColor: '#edf6f3', borderWidth: 1, borderColor: '#cae4dc' },
  adultRoadLockedCopy: { flex: 1, marginLeft: 9 },
  adultRoadLockedTitle: { color: '#3d736a', fontSize: 13, fontWeight: '900' },
  adultRoadLockedSub: { color: '#5a877f', fontSize: 11, marginTop: 2 },
  closeButton: { marginTop: 18, alignSelf: 'center', backgroundColor: '#2d9b91', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 34 },
  closeButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
