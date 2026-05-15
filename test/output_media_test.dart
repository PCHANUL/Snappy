import 'package:flutter_test/flutter_test.dart';
import 'package:snappy/media/output_media.dart';

void main() {
  test('loads media without tuning using default tuning', () {
    final media = OutputMediaDefinition.fromJson({
      'id': 'legacy',
      'name': '레거시 매체',
      'outputFormat': '본문',
      'llmSkill': '담백하게 작성',
      'createdAt': DateTime.utc(2026).toIso8601String(),
      'updatedAt': DateTime.utc(2026).toIso8601String(),
    });

    expect(media.tuning.sentenceLength, SentenceLength.normal);
    expect(media.tuning.emojiLevel, EmojiLevel.normal);
    expect(media.tuning.ctaLevel, CtaLevel.soft);
    expect(media.tuning.hashtagCount, 0);
  });

  test('serializes media tuning', () {
    final media = OutputMediaDefinition(
      id: 'instagram',
      name: '인스타그램',
      outputFormat: '캡션',
      llmSkill: '짧게 작성',
      tuning: const MediaTuning(
        sentenceLength: SentenceLength.short,
        emojiLevel: EmojiLevel.high,
        ctaLevel: CtaLevel.strong,
        hashtagCount: 10,
      ),
      createdAt: DateTime.utc(2026),
      updatedAt: DateTime.utc(2026),
    );

    final json = media.toJson();
    final tuning = json['tuning'] as Map<String, dynamic>;

    expect(tuning['sentenceLength'], 'short');
    expect(tuning['emojiLevel'], 'high');
    expect(tuning['ctaLevel'], 'strong');
    expect(tuning['hashtagCount'], 10);
  });
}
