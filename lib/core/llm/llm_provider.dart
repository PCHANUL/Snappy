class ImageData {
  const ImageData({
    required this.id,
    required this.mimeType,
    required this.base64Data,
    this.path,
  });

  final String id;
  final String mimeType;
  final String base64Data;
  final String? path;
}

abstract class LLMProvider {
  String get name;
  String get defaultModel;

  Future<String> generate({
    required String apiKey,
    required String systemPrompt,
    required String userContent,
    List<ImageData>? images,
    String? model,
  });

  Future<bool> validateApiKey(String apiKey);
}
