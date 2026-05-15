import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';

import '../../app/state.dart';
import '../../core/llm/llm_provider.dart';
import '../../media/output_media.dart';
import '../../shared/widgets/async_state_view.dart';
import '../../shared/widgets/media_definition_card.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _textController = TextEditingController();
  final _imagePicker = ImagePicker();
  final _uuid = const Uuid();
  final List<ImageData> _images = [];
  bool _pickingImages = false;

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final asyncState = ref.watch(snappyControllerProvider);

    return AsyncStateView(
      value: asyncState,
      data: (appState) {
        final canConvert =
            _textController.text.trim().isNotEmpty && !appState.isConverting;

        return Scaffold(
          appBar: AppBar(
            title: const Text('Snappy'),
            actions: [
              IconButton(
                tooltip: '매체 관리',
                icon: const Icon(Icons.layers_outlined),
                onPressed: () => context.go('/media'),
              ),
              IconButton(
                tooltip: '설정',
                icon: const Icon(Icons.settings_outlined),
                onPressed: () => context.go('/settings'),
              ),
            ],
          ),
          bottomNavigationBar: SafeArea(
            minimum: const EdgeInsets.fromLTRB(20, 12, 20, 20),
            child: FilledButton.icon(
              icon: appState.isConverting
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.auto_awesome),
              label: const Text('변환하기'),
              onPressed: canConvert ? _convert : null,
            ),
          ),
          body: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              TextField(
                controller: _textController,
                minLines: 7,
                maxLines: 14,
                decoration: const InputDecoration(
                  labelText: '원본 텍스트',
                  alignLabelWithHint: true,
                  hintText: '변환할 컨텐츠를 붙여넣으세요.',
                ),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 16),
              _ImagePickerSection(
                images: _images,
                pickingImages: _pickingImages,
                onPickImages: _pickImages,
                onRemoveImage: (image) => setState(() => _images.remove(image)),
              ),
              const SizedBox(height: 20),
              Text(
                '매체 선택',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final media in appState.settings.mediaDefinitions)
                    FilterChip(
                      label: Text(media.name),
                      selected: appState.settings.selectedMediaIds.contains(
                        media.id,
                      ),
                      onSelected: (selected) => ref
                          .read(snappyControllerProvider.notifier)
                          .setMediaSelected(media.id, selected),
                    ),
                ],
              ),
              const SizedBox(height: 20),
              _MediaManagementSection(
                onCreate: () => context.go('/media/new?returnTo=/home'),
                onEdit: (mediaId) =>
                    context.go('/media/edit/$mediaId?returnTo=/home'),
              ),
              if (appState.errorMessage != null) ...[
                const SizedBox(height: 16),
                Text(
                  appState.errorMessage!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 12),
            ],
          ),
        );
      },
    );
  }

  Future<void> _pickImages() async {
    if (_images.length >= 5) {
      return;
    }

    setState(() => _pickingImages = true);
    final pickedImages = await _imagePicker.pickMultiImage();

    for (final pickedImage in pickedImages.take(5 - _images.length)) {
      final bytes = await pickedImage.readAsBytes();
      _images.add(
        ImageData(
          id: _uuid.v4(),
          mimeType: _guessMimeType(pickedImage.path),
          base64Data: base64Encode(bytes),
          path: pickedImage.path,
        ),
      );
    }

    if (mounted) {
      setState(() => _pickingImages = false);
    }
  }

  Future<void> _convert() async {
    final converted = await ref.read(snappyControllerProvider.notifier).convert(
          originalText: _textController.text,
          images: _images,
        );

    if (!mounted) {
      return;
    }

    if (converted) {
      context.go('/result');
      return;
    }

    final errorMessage =
        ref.read(snappyControllerProvider).asData?.value.errorMessage ??
            '변환을 완료하지 못했습니다.';
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(errorMessage)),
    );
  }

  String _guessMimeType(String path) {
    final lowerPath = path.toLowerCase();
    if (lowerPath.endsWith('.png')) {
      return 'image/png';
    }
    if (lowerPath.endsWith('.webp')) {
      return 'image/webp';
    }
    if (lowerPath.endsWith('.gif')) {
      return 'image/gif';
    }
    return 'image/jpeg';
  }
}

class _MediaManagementSection extends ConsumerWidget {
  const _MediaManagementSection({
    required this.onCreate,
    required this.onEdit,
  });

  final VoidCallback onCreate;
  final ValueChanged<String> onEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appState = ref.watch(snappyControllerProvider).asData?.value;
    if (appState == null) {
      return const SizedBox.shrink();
    }

    final mediaDefinitions = appState.settings.mediaDefinitions;
    final selectedIds = appState.settings.selectedMediaIds;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '매체 관리',
                        style:
                            Theme.of(context).textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w700,
                                ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '선택, 복제, 편집, 삭제를 홈에서 바로 처리합니다.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                ActionChip(
                  avatar: const Icon(Icons.add, size: 18),
                  label: const Text('새 매체'),
                  onPressed: onCreate,
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (mediaDefinitions.isEmpty)
              const Text('등록된 매체가 없습니다.')
            else
              Column(
                children: [
                  for (var index = 0;
                      index < mediaDefinitions.length;
                      index++) ...[
                    MediaDefinitionCard(
                      media: mediaDefinitions[index],
                      selected:
                          selectedIds.contains(mediaDefinitions[index].id),
                      showSelectionControl: true,
                      onSelectedChanged: (selected) => ref
                          .read(snappyControllerProvider.notifier)
                          .setMediaSelected(
                            mediaDefinitions[index].id,
                            selected,
                          ),
                      onDuplicate: () => ref
                          .read(snappyControllerProvider.notifier)
                          .duplicateMedia(mediaDefinitions[index]),
                      onEdit: () => onEdit(mediaDefinitions[index].id),
                      onDelete: () => _confirmDelete(
                        context,
                        ref,
                        mediaDefinitions[index],
                      ),
                    ),
                    if (index < mediaDefinitions.length - 1)
                      const SizedBox(height: 12),
                  ],
                ],
              ),
          ],
        ),
      ),
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

class _ImagePickerSection extends StatelessWidget {
  const _ImagePickerSection({
    required this.images,
    required this.pickingImages,
    required this.onPickImages,
    required this.onRemoveImage,
  });

  final List<ImageData> images;
  final bool pickingImages;
  final VoidCallback onPickImages;
  final ValueChanged<ImageData> onRemoveImage;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '이미지 ${images.length}/5',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                IconButton.filledTonal(
                  tooltip: '사진 추가',
                  icon: pickingImages
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.add_photo_alternate_outlined),
                  onPressed:
                      pickingImages || images.length >= 5 ? null : onPickImages,
                ),
              ],
            ),
            if (images.isNotEmpty) ...[
              const SizedBox(height: 12),
              SizedBox(
                height: 84,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemBuilder: (context, index) {
                    final image = images[index];
                    return Stack(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.memory(
                            base64Decode(image.base64Data),
                            width: 84,
                            height: 84,
                            fit: BoxFit.cover,
                          ),
                        ),
                        Positioned(
                          right: 4,
                          top: 4,
                          child: IconButton.filled(
                            visualDensity: VisualDensity.compact,
                            tooltip: '이미지 제거',
                            iconSize: 16,
                            icon: const Icon(Icons.close),
                            onPressed: () => onRemoveImage(image),
                          ),
                        ),
                      ],
                    );
                  },
                  separatorBuilder: (_, __) => const SizedBox(width: 10),
                  itemCount: images.length,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
