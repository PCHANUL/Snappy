import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/state.dart';
import '../../media/output_media.dart';
import '../../shared/widgets/async_state_view.dart';
import '../../shared/widgets/media_definition_card.dart';

class MediaListScreen extends ConsumerWidget {
  const MediaListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncState = ref.watch(snappyControllerProvider);

    return AsyncStateView(
      value: asyncState,
      data: (appState) {
        final mediaDefinitions = appState.settings.mediaDefinitions;

        return Scaffold(
          appBar: AppBar(
            title: const Text('매체 관리'),
            actions: [
              IconButton(
                tooltip: '새 매체 만들기',
                icon: const Icon(Icons.add),
                onPressed: () => context.go('/media/new'),
              ),
            ],
          ),
          body: ListView.separated(
            padding: const EdgeInsets.all(20),
            itemBuilder: (context, index) {
              final media = mediaDefinitions[index];
              return MediaDefinitionCard(
                media: media,
                onDuplicate: () => ref
                    .read(snappyControllerProvider.notifier)
                    .duplicateMedia(media),
                onEdit: () => context.go('/media/edit/${media.id}'),
                onDelete: () => _confirmDelete(context, ref, media),
              );
            },
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemCount: mediaDefinitions.length,
          ),
          floatingActionButton: FloatingActionButton.extended(
            icon: const Icon(Icons.add),
            label: const Text('새 매체'),
            onPressed: () => context.go('/media/new'),
          ),
        );
      },
    );
  }
}

Future<void> _confirmDelete(
  BuildContext context,
  WidgetRef ref,
  OutputMediaDefinition media,
) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('매체 삭제'),
      content: Text('${media.name} 매체를 삭제할까요?'),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('취소'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('삭제'),
        ),
      ],
    ),
  );

  if (confirmed == true) {
    await ref.read(snappyControllerProvider.notifier).deleteMedia(media.id);
  }
}
