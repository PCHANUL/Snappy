import 'package:flutter_test/flutter_test.dart';
import 'package:snappy/core/prompts/media_presets.dart';
import 'package:snappy/core/prompts/prompt_builder.dart';

void main() {
  test('builds a media specific system prompt', () {
    final media = defaultMediaPresets().first;
    final prompt = PromptBuilder().buildSystemPrompt(media: media);

    expect(prompt, contains('매체 이름: 인스타그램'));
    expect(prompt, contains('출력 형식: 캡션 본문 + 해시태그 20개'));
    expect(prompt, contains('LLM 스킬:'));
    expect(prompt, contains('미세 조정:'));
    expect(prompt, contains('문장 길이: 짧은 문장 위주'));
    expect(prompt, contains('해시태그: 20개를 포함하세요.'));
  });

  test('includes image count in user content', () {
    final userContent = PromptBuilder().buildUserContent(
      originalText: '새 메뉴 출시',
    );

    expect(userContent, contains('새 메뉴 출시'));
    expect(userContent, contains('첨부 이미지 없음'));
  });
}
