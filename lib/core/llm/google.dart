import 'llm_provider.dart';

class GoogleProvider implements LLMProvider {
  @override
  String get name => 'Google';

  @override
  String get defaultModel => 'gemini-pro';

  @override
  Future<String> generate({
    required String apiKey,
    required String systemPrompt,
    required String userContent,
    List<ImageData>? images,
    String? model,
  }) {
    throw UnsupportedError('Google 연동은 Phase 2 범위입니다.');
  }

  @override
  Future<bool> validateApiKey(String apiKey) {
    throw UnsupportedError('Google 연동은 Phase 2 범위입니다.');
  }
}
