import 'app_settings.dart';
import 'conversion_result.dart';

class AppState {
  const AppState({
    required this.settings,
    required this.hasApiKey,
    this.currentResult,
    this.isConverting = false,
    this.errorMessage,
  });

  final AppSettings settings;
  final bool hasApiKey;
  final ConversionResult? currentResult;
  final bool isConverting;
  final String? errorMessage;

  AppState copyWith({
    AppSettings? settings,
    bool? hasApiKey,
    ConversionResult? currentResult,
    bool? isConverting,
    String? errorMessage,
  }) {
    return AppState(
      settings: settings ?? this.settings,
      hasApiKey: hasApiKey ?? this.hasApiKey,
      currentResult: currentResult ?? this.currentResult,
      isConverting: isConverting ?? this.isConverting,
      errorMessage: errorMessage,
    );
  }
}
