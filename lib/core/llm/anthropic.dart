import 'package:dio/dio.dart';

import 'anthropic_models.dart';
import 'llm_provider.dart';

class AnthropicProvider implements LLMProvider {
  AnthropicProvider(this._dio);

  static const _messagesEndpoint = 'https://api.anthropic.com/v1/messages';
  static const _modelsEndpoint = 'https://api.anthropic.com/v1/models';

  final Dio _dio;

  @override
  String get name => 'Anthropic';

  @override
  String get defaultModel => defaultAnthropicModel;

  @override
  Future<String> generate({
    required String apiKey,
    required String systemPrompt,
    required String userContent,
    List<ImageData>? images,
    String? model,
  }) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        _messagesEndpoint,
        options: Options(
          headers: _headers(apiKey),
        ),
        data: {
          'model': model ?? defaultModel,
          'max_tokens': 1800,
          'system': systemPrompt,
          'messages': [
            {
              'role': 'user',
              'content': [
                for (final image in images ?? const <ImageData>[])
                  {
                    'type': 'image',
                    'source': {
                      'type': 'base64',
                      'media_type': image.mimeType,
                      'data': image.base64Data,
                    },
                  },
                {'type': 'text', 'text': userContent},
              ],
            },
          ],
        },
      );

      final content = response.data?['content'] as List<dynamic>? ?? [];
      final textBlocks = content
          .whereType<Map<String, dynamic>>()
          .where((block) => block['type'] == 'text')
          .map((block) => block['text'] as String? ?? '')
          .where((text) => text.isNotEmpty)
          .toList(growable: false);

      if (textBlocks.isEmpty) {
        throw StateError('Claude 응답에 텍스트가 없습니다.');
      }

      return textBlocks.join('\n\n').trim();
    } on DioException catch (error) {
      throw _mapDioException(error);
    }
  }

  @override
  Future<bool> validateApiKey(String apiKey) async {
    try {
      await _dio.get<Map<String, dynamic>>(
        _modelsEndpoint,
        queryParameters: {'limit': 1},
        options: Options(headers: _headers(apiKey)),
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  Map<String, String> _headers(String apiKey) {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    };
  }

  AnthropicRequestException _mapDioException(DioException error) {
    final responseData = error.response?.data;
    final responseMap =
        responseData is Map<String, dynamic> ? responseData : null;
    final errorMap = responseMap?['error'] is Map<String, dynamic>
        ? responseMap!['error'] as Map<String, dynamic>
        : null;
    final statusCode = error.response?.statusCode;
    final errorCode = errorMap?['type'] as String?;
    final apiMessage = errorMap?['message'] as String?;
    final requestId = error.response?.headers.value('request-id');

    return AnthropicRequestException(
      message: _friendlyMessage(
        statusCode: statusCode,
        errorCode: errorCode,
        apiMessage: apiMessage,
      ),
      statusCode: statusCode,
      errorCode: errorCode,
      apiMessage: apiMessage,
      requestId: requestId,
    );
  }

  String _friendlyMessage({
    required int? statusCode,
    required String? errorCode,
    required String? apiMessage,
  }) {
    if (statusCode == 400) {
      final lowerMessage = (apiMessage ?? '').toLowerCase();
      if (lowerMessage.contains('model')) {
        return 'Claude 모델 ID가 올바르지 않습니다. 설정에서 모델 프리셋을 다시 선택하거나 `$defaultAnthropicModel` 값을 사용하세요.';
      }
      if (lowerMessage.contains('image')) {
        return '첨부 이미지 형식 또는 크기가 Claude 요청 규격과 맞지 않습니다.';
      }
      return 'Anthropic 요청 형식이 올바르지 않습니다.';
    }

    if (statusCode == 401 || statusCode == 403) {
      return 'Anthropic API 키가 유효하지 않거나 권한이 없습니다.';
    }

    if (statusCode == 404) {
      return '요청한 Claude 모델이나 API 경로를 찾을 수 없습니다. 설정의 모델 ID를 확인하고 `$defaultAnthropicModel` 또는 `$defaultAnthropicModelAlias`로 다시 시도하세요.';
    }

    if (statusCode == 413) {
      return '입력 텍스트 또는 이미지가 너무 큽니다.';
    }

    if (statusCode == 429) {
      return '요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.';
    }

    if (statusCode != null && statusCode >= 500) {
      return 'Anthropic 서버에서 오류가 발생했습니다. 잠시 후 다시 시도하세요.';
    }

    if (errorCode == 'invalid_request_error') {
      return 'Anthropic 요청 값이 올바르지 않습니다.';
    }

    return 'Anthropic API 호출에 실패했습니다.';
  }
}

class AnthropicRequestException implements Exception {
  const AnthropicRequestException({
    required this.message,
    this.statusCode,
    this.errorCode,
    this.apiMessage,
    this.requestId,
  });

  final String message;
  final int? statusCode;
  final String? errorCode;
  final String? apiMessage;
  final String? requestId;

  Map<String, dynamic> toMetadata() {
    return {
      if (statusCode != null) 'statusCode': statusCode,
      if (errorCode != null) 'errorCode': errorCode,
      if (apiMessage != null) 'apiMessage': apiMessage,
      if (requestId != null) 'requestId': requestId,
    };
  }

  @override
  String toString() => message;
}
