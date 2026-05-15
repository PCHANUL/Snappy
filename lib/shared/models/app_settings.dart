import '../../core/llm/anthropic_models.dart';
import '../../media/output_media.dart';

enum LLMProviderType { anthropic, openai, google }

class AppSettings {
  const AppSettings({
    required this.provider,
    required this.anthropicModel,
    required this.selectedMediaIds,
    required this.mediaDefinitions,
    required this.onboardingDone,
  });

  final LLMProviderType provider;
  final String anthropicModel;
  final List<String> selectedMediaIds;
  final List<OutputMediaDefinition> mediaDefinitions;
  final bool onboardingDone;

  factory AppSettings.initial({
    required List<OutputMediaDefinition> mediaDefinitions,
  }) {
    return AppSettings(
      provider: LLMProviderType.anthropic,
      anthropicModel: defaultAnthropicModel,
      selectedMediaIds: mediaDefinitions.map((media) => media.id).toList(),
      mediaDefinitions: mediaDefinitions,
      onboardingDone: false,
    );
  }

  AppSettings copyWith({
    LLMProviderType? provider,
    String? anthropicModel,
    List<String>? selectedMediaIds,
    List<OutputMediaDefinition>? mediaDefinitions,
    bool? onboardingDone,
  }) {
    return AppSettings(
      provider: provider ?? this.provider,
      anthropicModel: anthropicModel ?? this.anthropicModel,
      selectedMediaIds: selectedMediaIds ?? this.selectedMediaIds,
      mediaDefinitions: mediaDefinitions ?? this.mediaDefinitions,
      onboardingDone: onboardingDone ?? this.onboardingDone,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'provider': provider.name,
      'anthropicModel': anthropicModel,
      'selectedMediaIds': selectedMediaIds,
      'mediaDefinitions':
          mediaDefinitions.map((media) => media.toJson()).toList(),
      'onboardingDone': onboardingDone,
    };
  }

  factory AppSettings.fromJson(Map<String, dynamic> json) {
    final mediaDefinitions = (json['mediaDefinitions'] as List<dynamic>? ?? [])
        .whereType<Map<String, dynamic>>()
        .map(OutputMediaDefinition.fromJson)
        .toList(growable: false);

    return AppSettings(
      provider: LLMProviderType.values.byName(
        json['provider'] as String? ?? LLMProviderType.anthropic.name,
      ),
      anthropicModel:
          json['anthropicModel'] as String? ?? defaultAnthropicModel,
      selectedMediaIds: (json['selectedMediaIds'] as List<dynamic>? ?? [])
          .whereType<String>()
          .toList(growable: false),
      mediaDefinitions: mediaDefinitions,
      onboardingDone: json['onboardingDone'] as bool? ?? false,
    );
  }
}
