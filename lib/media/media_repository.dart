import 'output_media.dart';

class MediaRepository {
  const MediaRepository();

  List<OutputMediaDefinition> mergeDefaults({
    required List<OutputMediaDefinition> stored,
    required List<OutputMediaDefinition> defaults,
  }) {
    final storedIds = stored.map((media) => media.id).toSet();
    final missingDefaults = defaults
        .where((media) => !storedIds.contains(media.id))
        .toList(growable: false);

    return [...missingDefaults, ...stored];
  }
}
