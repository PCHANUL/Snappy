import '../../media/output_media.dart';
import '../llm/llm_provider.dart';

class PromptBuilder {
  String buildSystemPrompt({
    required OutputMediaDefinition media,
  }) {
    return '''
당신은 Snappy의 컨텐츠 변환 엔진입니다.
사용자가 제공한 원본 컨텐츠를 하나의 출력 매체에 맞게 재작성하세요.

공통 규칙:
- 원본의 사실 관계를 임의로 추가하지 마세요.
- 출력은 바로 복사해서 게시할 수 있는 최종본으로 작성하세요.
- 불확실한 내용은 단정하지 마세요.
- 사용자가 요청하지 않은 설명문을 앞뒤에 붙이지 마세요.

매체 이름: ${media.name}
출력 형식: ${media.outputFormat}
LLM 스킬: ${media.llmSkill}
미세 조정:
${_buildTuningRules(media.tuning)}
''';
  }

  String buildUserContent({
    required String originalText,
    List<ImageData> images = const [],
  }) {
    final imageHint =
        images.isEmpty ? '첨부 이미지 없음' : '첨부 이미지 ${images.length}장을 함께 참고하세요.';

    return '''
원본 텍스트:
$originalText

이미지 정보:
$imageHint
''';
  }

  String _buildTuningRules(MediaTuning tuning) {
    final rules = [
      '- 문장 길이: ${_sentenceLengthRule(tuning.sentenceLength)}',
      '- 이모지 사용: ${_emojiRule(tuning.emojiLevel)}',
      '- CTA: ${_ctaRule(tuning.ctaLevel)}',
      '- 해시태그: ${tuning.hashtagCount > 0 ? '${tuning.hashtagCount}개를 포함하세요.' : '포함하지 마세요.'}',
      if (tuning.bannedPhrases.trim().isNotEmpty)
        '- 금지 표현: ${tuning.bannedPhrases.trim()}',
      if (tuning.requiredElements.trim().isNotEmpty)
        '- 필수 요소: ${tuning.requiredElements.trim()}',
      if (tuning.styleNote.trim().isNotEmpty)
        '- 문체 메모: ${tuning.styleNote.trim()}',
    ];

    return rules.join('\n');
  }

  String _sentenceLengthRule(SentenceLength value) {
    return switch (value) {
      SentenceLength.short => '짧은 문장 위주로 간결하게 작성하세요.',
      SentenceLength.normal => '문장 길이는 자연스럽게 유지하세요.',
      SentenceLength.long => '충분한 설명을 포함해 긴 문장도 허용하세요.',
    };
  }

  String _emojiRule(EmojiLevel value) {
    return switch (value) {
      EmojiLevel.none => '이모지를 사용하지 마세요.',
      EmojiLevel.low => '이모지는 필요한 경우에만 적게 사용하세요.',
      EmojiLevel.normal => '매체에 어울리는 수준으로 사용하세요.',
      EmojiLevel.high => '이모지를 적극적으로 사용하세요.',
    };
  }

  String _ctaRule(CtaLevel value) {
    return switch (value) {
      CtaLevel.none => '행동 유도 문장을 넣지 마세요.',
      CtaLevel.soft => '부담스럽지 않은 행동 유도 문장을 포함하세요.',
      CtaLevel.strong => '명확하고 강한 행동 유도 문장을 포함하세요.',
    };
  }
}
