import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../media/media_repository.dart';
import '../../shared/models/app_settings.dart';
import '../prompts/media_presets.dart';

class PrefsStorageService {
  static const _settingsKey = 'snappy.appSettings.v1';

  final MediaRepository _mediaRepository = const MediaRepository();

  Future<AppSettings> loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_settingsKey);
    final defaults = defaultMediaPresets();

    if (raw == null || raw.isEmpty) {
      return AppSettings.initial(mediaDefinitions: defaults);
    }

    try {
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      final stored = AppSettings.fromJson(decoded);
      final mediaDefinitions = _mediaRepository.mergeDefaults(
        stored: stored.mediaDefinitions,
        defaults: defaults,
      );
      final selectedMediaIds = stored.selectedMediaIds
          .where((id) => mediaDefinitions.any((media) => media.id == id))
          .toList(growable: true);

      if (selectedMediaIds.isEmpty && mediaDefinitions.isNotEmpty) {
        selectedMediaIds.add(mediaDefinitions.first.id);
      }

      return stored.copyWith(
        mediaDefinitions: mediaDefinitions,
        selectedMediaIds: selectedMediaIds,
      );
    } catch (_) {
      return AppSettings.initial(mediaDefinitions: defaults);
    }
  }

  Future<void> saveSettings(AppSettings settings) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_settingsKey, jsonEncode(settings.toJson()));
  }
}
