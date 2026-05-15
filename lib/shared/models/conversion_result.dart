import '../../core/llm/llm_provider.dart';

class ConversionResult {
  const ConversionResult({
    required this.originalText,
    required this.images,
    required this.results,
    required this.createdAt,
  });

  final String originalText;
  final List<ImageData> images;
  final Map<String, MediaResult> results;
  final DateTime createdAt;
}

class MediaResult {
  const MediaResult({
    required this.mediaId,
    required this.mediaName,
    this.text,
    this.error,
    this.metadata,
  });

  final String mediaId;
  final String mediaName;
  final String? text;
  final String? error;
  final Map<String, dynamic>? metadata;
}
