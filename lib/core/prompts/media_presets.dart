import '../../media/output_media.dart';

List<OutputMediaDefinition> defaultMediaPresets() {
  final now = DateTime.fromMillisecondsSinceEpoch(0);

  return [
    OutputMediaDefinition(
      id: 'preset_instagram',
      name: '인스타그램',
      outputFormat: '캡션 본문 + 해시태그 20개',
      llmSkill: '첫 줄은 강한 후킹 문장으로 시작하고, 짧은 문단과 적절한 이모지를 사용한다.',
      tuning: const MediaTuning(
        sentenceLength: SentenceLength.short,
        emojiLevel: EmojiLevel.normal,
        ctaLevel: CtaLevel.soft,
        hashtagCount: 20,
      ),
      createdAt: now,
      updatedAt: now,
    ),
    OutputMediaDefinition(
      id: 'preset_blog',
      name: '블로그',
      outputFormat: '제목 + 긴 본문 + 검색 키워드',
      llmSkill: '정보성 구조로 작성하고, 소제목을 3개 이상 포함하며 검색 유입을 고려한다.',
      tuning: const MediaTuning(
        sentenceLength: SentenceLength.long,
        emojiLevel: EmojiLevel.none,
        ctaLevel: CtaLevel.soft,
        hashtagCount: 0,
      ),
      createdAt: now,
      updatedAt: now,
    ),
    OutputMediaDefinition(
      id: 'preset_newsletter',
      name: '뉴스레터',
      outputFormat: '제목 + 도입부 + 본문 + CTA',
      llmSkill: '구독자에게 직접 말하듯 작성하고, 마지막에 명확한 행동 유도를 포함한다.',
      tuning: const MediaTuning(
        sentenceLength: SentenceLength.normal,
        emojiLevel: EmojiLevel.low,
        ctaLevel: CtaLevel.strong,
        hashtagCount: 0,
      ),
      createdAt: now,
      updatedAt: now,
    ),
  ];
}
