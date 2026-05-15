import 'llm_provider.dart';

class OpenAIProvider implements LLMProvider {
  @override
  String get name => 'OpenAI';

  @override
  String get defaultModel => 'gpt-5';

  @override
  Future<String> generate({
    required String apiKey,
    required String systemPrompt,
    required String userContent,
    List<ImageData>? images,
    String? model,
  }) {
    throw UnsupportedError('OpenAI 연동은 Phase 2 범위입니다.');
  }

  @override
  Future<bool> validateApiKey(String apiKey) {
    throw UnsupportedError('OpenAI 연동은 Phase 2 범위입니다.');
  }
}
