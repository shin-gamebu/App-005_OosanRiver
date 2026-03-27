import React, { useCallback } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { legalUrls } from './legalLinks';

type Props = {
  visible: boolean;
  onClose: () => void;
};

async function openExternalUrl(url: string): Promise<void> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      Alert.alert('開けませんでした', 'この端末では URL を開けない可能性があります。');
      return;
    }
    await Linking.openURL(url);
  } catch {
    Alert.alert('エラー', 'ブラウザを開けませんでした。');
  }
}

export function LegalInfoModal({ visible, onClose }: Props) {
  const row = useCallback(
    (label: string, url: string) => (
      <Pressable
        key={label}
        style={({ pressed }) => [styles.linkRow, pressed && styles.linkRowPressed]}
        onPress={() => void openExternalUrl(url)}
      >
        <Text style={styles.linkLabel}>{label}</Text>
        <Text style={styles.linkChevron}>›</Text>
      </Pressable>
    ),
    []
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>ご利用情報</Text>
          <Text style={styles.note}>
            利用規約・プライバシーポリシー・お問い合わせはブラウザで開きます。URL
            は公開準備中の仮置きです。
          </Text>
          {row('利用規約', legalUrls.termsOfService)}
          {row('プライバシーポリシー', legalUrls.privacyPolicy)}
          {row('お問い合わせ', legalUrls.contact)}
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>閉じる</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 16,
    padding: 20,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 8px 32px rgba(0,0,0,0.12)' } as object)
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
          elevation: 8,
        }),
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a2a3a',
    marginBottom: 10,
  },
  note: {
    fontSize: 13,
    lineHeight: 20,
    color: 'rgba(0,0,0,0.55)',
    marginBottom: 16,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  linkRowPressed: {
    backgroundColor: 'rgba(0,100,180,0.06)',
  },
  linkLabel: {
    fontSize: 16,
    color: '#0d4a7a',
    fontWeight: '600',
  },
  linkChevron: {
    fontSize: 22,
    color: 'rgba(0,0,0,0.35)',
    fontWeight: '300',
  },
  closeBtn: {
    marginTop: 18,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 28,
  },
  closeBtnText: {
    fontSize: 15,
    color: 'rgba(0,0,0,0.5)',
    fontWeight: '600',
  },
});
