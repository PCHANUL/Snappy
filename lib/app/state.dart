import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../core/llm/anthropic.dart';
import '../core/llm/llm_provider.dart';
import '../core/prompts/media_presets.dart';
import '../core/prompts/prompt_builder.dart';
import '../core/storage/prefs_storage.dart';
import '../core/storage/secure_storage.dart';
import '../media/output_media.dart';
import '../shared/models/app_settings.dart';
import '../shared/models/app_state.dart';
import '../shared/models/conversion_result.dart';

final dioProvider = Provider<Dio>((ref) => Dio());
final uuidProvider = Provider<Uuid>((ref) => const Uuid());
final secureStorageProvider = Provider<SecureStorageService>(
  (ref) => SecureStorageService(),
);
final prefsStorageProvider = Provider<PrefsStorageService>(
  (ref) => PrefsStorageService(),
);
final promptBuilderProvider = Provider<PromptBuilder>((ref) => PromptBuilder());
final anthropicProvider = Provider<LLMProvider>(
  (ref) => AnthropicProvider(ref.watch(dioProvider)),
);

final snappyControllerProvider =
    AsyncNotifierProvider<SnappyController, AppState>(SnappyController.new);

class SnappyController extends AsyncNotifier<AppState> {
  @override
  Future<AppState> build() async {
    final settings = await ref.watch(prefsStorageProvider).loadSettings();
    final hasApiKey = await ref.watch(secureStorageProvider).hasApiKey();

    return AppState(settings: settings, hasApiKey: hasApiKey);
  }

  AppState get _current {
    final value = state.asData?.value;
    if (value != null) {
      return value;
    }

    final mediaDefinitions = defaultMediaPresets();
    return AppState(
      settings: AppSettings.initial(mediaDefinitions: mediaDefinitions),
      hasApiKey: false,
    );
  }

  Future<void> _saveSettings(AppSettings settings) async {
    await ref.read(prefsStorageProvider).saveSettings(settings);
    state = AsyncData(
      _current.copyWith(settings: settings, errorMessage: null),
    );
  }

  Future<void> completeOnboarding() async {
    await _saveSettings(_current.settings.copyWith(onboardingDone: true));
  }

  Future<bool> validateAndSaveApiKey(String apiKey) async {
    final trimmedKey = apiKey.trim();
    if (trimmedKey.isEmpty) {
      state = AsyncData(_current.copyWith(errorMessage: 'API 키를 입력하세요.'));
      return false;
    }

    final isValid =
        await ref.read(anthropicProvider).validateApiKey(trimmedKey);
    if (!isValid) {
      state = AsyncData(
        _current.copyWith(errorMessage: 'Anthropic API 키를 확인할 수 없습니다.'),
      );
      return false;
    }

    await ref.read(secureStorageProvider).saveApiKey(trimmedKey);
    state = AsyncData(_current.copyWith(hasApiKey: true, errorMessage: null));
    return true;
  }

  Future<void> clearApiKey() async {
    await ref.read(secureStorageProvider).clearApiKey();
    state = AsyncData(_current.copyWith(hasApiKey: false));
  }

  Future<void> updateAnthropicModel(String model) async {
    final trimmedModel = model.trim();
    if (trimmedModel.isEmpty) {
      state = AsyncData(_current.copyWith(errorMessage: '모델 ID를 입력하세요.'));
      return;
    }

    await _saveSettings(
      _current.settings.copyWith(anthropicModel: trimmedModel),
    );
  }

  Future<void> setMediaSelected(String mediaId, bool selected) async {
    final settings = _current.settings;
    final nextSelectedIds = [...settings.selectedMediaIds];

    if (selected && !nextSelectedIds.contains(mediaId)) {
      nextSelectedIds.add(mediaId);
    }

    if (!selected && nextSelectedIds.length > 1) {
      nextSelectedIds.remove(mediaId);
    }

    await _saveSettings(settings.copyWith(selectedMediaIds: nextSelectedIds));
  }

  Future<void> saveMedia({
    String? id,
    required String name,
    required String outputFormat,
    required String llmSkill,
    MediaTuning tuning = const MediaTuning(),
  }) async {
    final settings = _current.settings;
    final now = DateTime.now();
    final mediaDefinitions = [...settings.mediaDefinitions];
    final index = id == null
        ? -1
        : mediaDefinitions.indexWhere((media) => media.id == id);

    if (index == -1) {
      final mediaId = ref.read(uuidProvider).v4();
      mediaDefinitions.add(
        OutputMediaDefinition(
          id: mediaId,
          name: name,
          outputFormat: outputFormat,
          llmSkill: llmSkill,
          tuning: tuning,
          createdAt: now,
          updatedAt: now,
        ),
      );
      await _saveSettings(
        settings.copyWith(
          mediaDefinitions: mediaDefinitions,
          selectedMediaIds: [...settings.selectedMediaIds, mediaId],
        ),
      );
      return;
    }

    mediaDefinitions[index] = mediaDefinitions[index].copyWith(
      name: name,
      outputFormat: outputFormat,
      llmSkill: llmSkill,
      tuning: tuning,
      updatedAt: now,
    );
    await _saveSettings(settings.copyWith(mediaDefinitions: mediaDefinitions));
  }

  Future<void> duplicateMedia(OutputMediaDefinition media) async {
    await saveMedia(
      name: '${media.name} 복사본',
      outputFormat: media.outputFormat,
      llmSkill: media.llmSkill,
      tuning: media.tuning,
    );
  }

  Future<void> deleteMedia(String mediaId) async {
    final settings = _current.settings;
    final target = settings.mediaDefinitions
        .where((media) => media.id == mediaId)
        .firstOrNull;

    if (target == null) {
      return;
    }

    final mediaDefinitions = settings.mediaDefinitions
        .where((media) => media.id != mediaId)
        .toList(growable: false);
    final selectedMediaIds = settings.selectedMediaIds
        .where((id) => id != mediaId)
        .toList(growable: true);

    if (selectedMediaIds.isEmpty && mediaDefinitions.isNotEmpty) {
      selectedMediaIds.add(mediaDefinitions.first.id);
    }

    await _saveSettings(
      settings.copyWith(
        mediaDefinitions: mediaDefinitions,
        selectedMediaIds: selectedMediaIds,
      ),
    );
  }

  Future<bool> convert({
    required String originalText,
    List<ImageData> images = const [],
  }) async {
    final trimmedText = originalText.trim();
    if (trimmedText.isEmpty) {
      state = AsyncData(_current.copyWith(errorMessage: '원본 텍스트를 입력하세요.'));
      return false;
    }

    final apiKey = await ref.read(secureStorageProvider).readApiKey();
    if (apiKey == null || apiKey.isEmpty) {
      state = AsyncData(
        _current.copyWith(errorMessage: 'Anthropic API 키를 먼저 입력하세요.'),
      );
      return false;
    }

    final current = _current;
    final settings = current.settings;
    final selectedMedia = settings.mediaDefinitions
        .where((media) => settings.selectedMediaIds.contains(media.id))
        .toList(growable: false);

    if (selectedMedia.isEmpty) {
      state = AsyncData(current.copyWith(errorMessage: '매체를 1개 이상 선택하세요.'));
      return false;
    }

    state = AsyncData(current.copyWith(isConverting: true, errorMessage: null));

    final promptBuilder = ref.read(promptBuilderProvider);
    final provider = ref.read(anthropicProvider);

    final resultEntries = await Future.wait(
      selectedMedia.map((media) async {
        try {
          final generatedText = await provider.generate(
            apiKey: apiKey,
            systemPrompt: promptBuilder.buildSystemPrompt(
              media: media,
            ),
            userContent: promptBuilder.buildUserContent(
              originalText: trimmedText,
              images: images,
            ),
            images: images,
            model: settings.anthropicModel,
          );

          return MapEntry(
            media.id,
            MediaResult(
              mediaId: media.id,
              mediaName: media.name,
              text: generatedText,
            ),
          );
        } catch (error) {
          final normalizedError = _normalizeError(error);
          return MapEntry(
            media.id,
            MediaResult(
              mediaId: media.id,
              mediaName: media.name,
              error: normalizedError.message,
              metadata: normalizedError.metadata,
            ),
          );
        }
      }),
    );

    final result = ConversionResult(
      originalText: trimmedText,
      images: images,
      results: Map.fromEntries(resultEntries),
      createdAt: DateTime.now(),
    );

    state = AsyncData(
      _current.copyWith(
        currentResult: result,
        isConverting: false,
        errorMessage: null,
        settings: settings,
      ),
    );

    return true;
  }

  Future<bool> regenerateCurrentResult() async {
    final result = _current.currentResult;
    if (result == null) {
      return false;
    }

    return convert(
      originalText: result.originalText,
      images: result.images,
    );
  }
}

class _NormalizedError {
  const _NormalizedError({
    required this.message,
    this.metadata,
  });

  final String message;
  final Map<String, dynamic>? metadata;
}

_NormalizedError _normalizeError(Object error) {
  if (error is AnthropicRequestException) {
    return _NormalizedError(
      message: error.message,
      metadata: error.toMetadata(),
    );
  }

  if (error is DioException) {
    return _NormalizedError(
      message: '네트워크 요청 중 오류가 발생했습니다.',
      metadata: {
        if (error.response?.statusCode != null)
          'statusCode': error.response?.statusCode,
      },
    );
  }

  return _NormalizedError(message: error.toString());
}

extension _IterableFirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
