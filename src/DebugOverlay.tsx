import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Pressable,
  Keyboard,
  ScrollView,
  Platform,
} from 'react-native';
import { useDebugTime } from './DebugTimeContext';
import {
  DEFAULT_NIGHT_CARE_MULTIPLIER,
  affectionValueForLevel,
  MAX_AFFECTION_LEVEL,
  GROWTH_CM_PER_SECOND,
  GROWTH_TARGET_CM,
} from './logic';

/**
 * 通常の開発サーバーでは常に表示する。TestFlight で育成や通知を確認する
 * 専用ビルドだけは、EAS の testflight-debug プロファイルからこの値を埋め込む。
 * App Store 提出版（production）にはこの環境変数を設定しないため表示されない。
 */
const IS_DEBUG_BUILD =
  __DEV__ || process.env.EXPO_PUBLIC_ENABLE_TEST_DEBUG === 'true';

function offsetForLocalToday(hour: number, minute: number): number {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime() - Date.now();
}

export type DebugGaugePatch = {
  fullness?: number;
  viscosity?: number;
};

type Props = {
  onApplyBodyLengthCm: (cm: number) => void;
  onApplyAffection: (value: number) => void;
  onResetPetCount: () => void;
  onResetDailyMissions: () => void;
  onApplyGauges: (patch: DebugGaugePatch) => void;
  onSetDead: () => void;
  onSendCareAlert: () => void;
  onSendInactivityReminder: () => void;
  onSendThirtyDayReminder: () => void;
};

/**
 * 開発中とTestFlight確認専用ビルドでのみ描画。公開用ビルドでは null。
 */
export function DebugOverlay({
  onApplyBodyLengthCm,
  onApplyAffection,
  onResetPetCount,
  onResetDailyMissions,
  onApplyGauges,
  onSetDead,
  onSendCareAlert,
  onSendInactivityReminder,
  onSendThirtyDayReminder,
}: Props) {
  if (!IS_DEBUG_BUILD) {
    return null;
  }
  return (
    <DebugOverlayInner
      onApplyBodyLengthCm={onApplyBodyLengthCm}
      onApplyAffection={onApplyAffection}
      onResetPetCount={onResetPetCount}
      onResetDailyMissions={onResetDailyMissions}
      onApplyGauges={onApplyGauges}
      onSetDead={onSetDead}
      onSendCareAlert={onSendCareAlert}
      onSendInactivityReminder={onSendInactivityReminder}
      onSendThirtyDayReminder={onSendThirtyDayReminder}
    />
  );
}

function DebugOverlayInner({
  onApplyBodyLengthCm,
  onApplyAffection,
  onResetPetCount,
  onResetDailyMissions,
  onApplyGauges,
  onSetDead,
  onSendCareAlert,
  onSendInactivityReminder,
  onSendThirtyDayReminder,
}: Props) {
  const {
    setTimeOffsetMs,
    setDebugNightCareMultiplier,
    resetAllDebugSettings,
    timeOffsetMs,
    debugNightCareMultiplier,
    getNow,
  } = useDebugTime();

  const [open, setOpen] = useState(false);
  const [sizeDraft, setSizeDraft] = useState('');
  const [affectionDraft, setAffectionDraft] = useState('');

  /** 体長は入力欄に入れたあと「適用」で反映してメニューを閉じる */
  const applySize = () => {
    Keyboard.dismiss();
    const n = parseFloat(sizeDraft.replace(/,/g, '.'));
    if (!Number.isFinite(n) || n < 0) return;
    onApplyBodyLengthCm(n);
    setOpen(false);
  };

  const fillLengthDraft = (cm: number) => {
    Keyboard.dismiss();
    const text =
      cm === GROWTH_CM_PER_SECOND ? GROWTH_CM_PER_SECOND.toFixed(5) : String(cm);
    setSizeDraft(text);
  };

  const fill199Draft = () => {
    Keyboard.dismiss();
    setSizeDraft('19.9');
  };

  const applyAffection = () => {
    Keyboard.dismiss();
    const n = parseInt(affectionDraft, 10);
    if (!Number.isFinite(n)) return;
    const level = Math.max(1, Math.min(MAX_AFFECTION_LEVEL, n));
    // 内部値は「なでた回数」だが、デバッグ欄は分かりやすくLvを直接受け取る。
    const affectionValue = affectionValueForLevel(level);
    onApplyAffection(affectionValue);
    setOpen(false);
  };

  const resetEverything = () => {
    resetAllDebugSettings();
    setSizeDraft('');
    Keyboard.dismiss();
    setOpen(false);
  };

  const virtualLabel = () => {
    const d = getNow();
    return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d
      .getDate()
      .toString()
      .padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  };

  return (
    <>
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
        accessibilityLabel="デバッグ"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.fabIcon}>⚙️</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.panel} onPress={(e) => e.stopPropagation()}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
            <Text style={styles.panelTitle}>Debug (dev only)</Text>
            <Text style={styles.hint}>
              仮想時刻: {virtualLabel()} · offset {Math.round(timeOffsetMs / 1000)}s · 夜倍率{' '}
              {debugNightCareMultiplier ?? DEFAULT_NIGHT_CARE_MULTIPLIER}
            </Text>

            <Text style={styles.section}>時間（ローカルの今日）</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => {
                  setTimeOffsetMs(offsetForLocalToday(8, 0));
                  setDebugNightCareMultiplier(null);
                  setOpen(false);
                }}
              >
                <Text style={styles.btnText}>朝 8:00</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => {
                  setTimeOffsetMs(offsetForLocalToday(13, 0));
                  setDebugNightCareMultiplier(null);
                  setOpen(false);
                }}
              >
                <Text style={styles.btnText}>昼 13:00</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => {
                  setTimeOffsetMs(offsetForLocalToday(22, 0));
                  setDebugNightCareMultiplier(1.5);
                  setOpen(false);
                }}
              >
                <Text style={styles.btnText}>夜 22:00</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.btn, styles.btnWide]}
              onPress={() => {
                setTimeOffsetMs(0);
                setDebugNightCareMultiplier(null);
                setOpen(false);
              }}
            >
              <Text style={styles.btnText}>Reset 時刻（実時刻に戻す）</Text>
            </TouchableOpacity>

            <Text style={styles.section}>通知テスト</Text>
            <Text style={styles.subHint}>通知を待たずに、その場で表示を確認できます。</Text>
            <TouchableOpacity
              style={[styles.btn, styles.btnWide]}
              onPress={() => {
                onSendCareAlert();
                setOpen(false);
              }}
            >
              <Text style={styles.btnText}>お世話通知を送る</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnWide]}
              onPress={() => {
                onSendInactivityReminder();
                setOpen(false);
              }}
            >
              <Text style={styles.btnText}>14日後の通知を送る</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnWide]}
              onPress={() => {
                onSendThirtyDayReminder();
                setOpen(false);
              }}
            >
              <Text style={styles.btnText}>30日後の通知を送る</Text>
            </TouchableOpacity>

            <Text style={styles.section}>体長 (cm)</Text>
            <Text style={styles.subHint}>選択・入力のあと「適用」で反映して閉じます</Text>
            <View style={styles.presetRow}>
              <TouchableOpacity style={styles.btnPreset} onPress={() => fillLengthDraft(0)}>
                <Text style={styles.btnPresetText}>リセット</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnPreset}
                onPress={() => fillLengthDraft(GROWTH_CM_PER_SECOND)}
              >
                <Text style={styles.btnPresetText}>0.00001cm</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnPreset} onPress={() => fillLengthDraft(1)}>
                <Text style={styles.btnPresetText}>1cm</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnPreset} onPress={() => fillLengthDraft(50)}>
                <Text style={styles.btnPresetText}>50cm</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btnPreset}
                onPress={() => fillLengthDraft(GROWTH_TARGET_CM)}
              >
                <Text style={styles.btnPresetText}>1m</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.inputFlex}
                value={sizeDraft}
                onChangeText={setSizeDraft}
                placeholder="任意の数値"
                placeholderTextColor="rgba(255,255,255,0.4)"
                keyboardType="decimal-pad"
                returnKeyType="done"
                blurOnSubmit
                onSubmitEditing={applySize}
              />
              <TouchableOpacity style={styles.btnDone} onPress={applySize} activeOpacity={0.85}>
                <Text style={styles.btnDoneText}>適用</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.btn, styles.btnWide]} onPress={fill199Draft}>
              <Text style={styles.btnText}>19.9cm（変態直前）</Text>
            </TouchableOpacity>

            <Text style={styles.section}>なつきLv.</Text>
            <Text style={styles.subHint}>1〜100を入力。入力したLvへ直接変更します。</Text>
            <View style={styles.presetRow}>
              <TouchableOpacity style={styles.btnPreset} onPress={() => setAffectionDraft('1')}>
                <Text style={styles.btnPresetText}>Lv.1</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnPreset} onPress={() => setAffectionDraft('5')}>
                <Text style={styles.btnPresetText}>Lv.5</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnPreset} onPress={() => setAffectionDraft('10')}>
                <Text style={styles.btnPresetText}>Lv.10</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.inputFlex}
                value={affectionDraft}
                onChangeText={setAffectionDraft}
                placeholder="なつきLv.（1〜100）"
                placeholderTextColor="rgba(255,255,255,0.4)"
                keyboardType="number-pad"
                returnKeyType="done"
                blurOnSubmit
                onSubmitEditing={applyAffection}
              />
              <TouchableOpacity style={styles.btnDone} onPress={applyAffection} activeOpacity={0.85}>
                <Text style={styles.btnDoneText}>適用</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.btn, styles.btnWide]}
              onPress={() => {
                onResetPetCount();
                setOpen(false);
              }}
            >
              <Text style={styles.btnText}>なでる回数をリセット</Text>
            </TouchableOpacity>

            <Text style={styles.section}>デイリーミッション</Text>
            <Text style={styles.subHint}>お世話・なかよしミッションを、最初から確認できる状態に戻します。</Text>
            <TouchableOpacity
              style={[styles.btn, styles.btnWide]}
              onPress={() => {
                onResetDailyMissions();
                setOpen(false);
              }}
            >
              <Text style={styles.btnText}>今日のミッションをすべて未達成にする</Text>
            </TouchableOpacity>

            <Text style={styles.section}>おなか・ヌメリ（通知・警告の確認用）</Text>
            <Text style={styles.subHint}>0%に戻すと、その項目のミッション進行もやり直せます</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => onApplyGauges({ fullness: 0 })}
              >
                <Text style={styles.btnText}>おなか 0%</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => onApplyGauges({ fullness: 1 })}
              >
                <Text style={styles.btnText}>おなか 1%</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => onApplyGauges({ viscosity: 0 })}
              >
                <Text style={styles.btnText}>ヌメリ 0%</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => onApplyGauges({ viscosity: 1 })}
              >
                <Text style={styles.btnText}>ヌメリ 1%</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.section}>状態</Text>
            <Text style={styles.subHint}>死亡画面と再スタートの確認用です。保存後も死亡状態になります。</Text>
            <TouchableOpacity
              style={[styles.btnDanger, styles.btnWide, styles.btnDangerCompact]}
              onPress={() => {
                Keyboard.dismiss();
                onSetDead();
                setOpen(false);
              }}
            >
              <Text style={styles.btnDangerText}>死亡状態にする</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.btnDanger, styles.btnWide]} onPress={resetEverything}>
              <Text style={styles.btnDangerText}>すべてのデバッグ設定をリセット</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.btnGhost, styles.btnWide]} onPress={() => setOpen(false)}>
              <Text style={styles.btnGhostText}>閉じる</Text>
            </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 62,
    top: Platform.OS === 'ios' ? 56 : 52,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 400,
    elevation: 20,
  },
  fabIcon: {
    fontSize: 22,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-start',
    paddingTop: Platform.OS === 'ios' ? 56 : 48,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  panel: {
    maxHeight: '88%',
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(20,20,24,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  panelTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  hint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginBottom: 14,
  },
  section: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  subHint: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  btn: {
    backgroundColor: 'rgba(100,160,220,0.35)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  btnWide: {
    alignSelf: 'stretch',
    marginRight: 0,
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  btnPreset: {
    backgroundColor: 'rgba(80,120,160,0.4)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  btnPresetText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  inputFlex: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    color: '#fff',
    fontSize: 15,
    marginRight: 8,
  },
  btnDone: {
    backgroundColor: 'rgba(120,200,140,0.5)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    justifyContent: 'center',
  },
  btnDoneText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  btnDanger: {
    backgroundColor: 'rgba(200,80,80,0.45)',
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  btnDangerText: {
    color: '#ffcccc',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  btnDangerCompact: {
    marginTop: 0,
  },
  btnGhost: {
    paddingVertical: 12,
    marginTop: 8,
  },
  btnGhostText: {
    color: 'rgba(255,255,255,0.65)',
    textAlign: 'center',
    fontSize: 14,
  },
});
