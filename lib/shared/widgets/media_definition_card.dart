import 'package:flutter/material.dart';

import '../../media/output_media.dart';

class MediaDefinitionCard extends StatelessWidget {
  const MediaDefinitionCard({
    required this.media,
    this.selected = false,
    this.onSelectedChanged,
    this.onDuplicate,
    this.onEdit,
    this.onDelete,
    this.showSelectionControl = false,
    super.key,
  });

  final OutputMediaDefinition media;
  final bool selected;
  final ValueChanged<bool>? onSelectedChanged;
  final VoidCallback? onDuplicate;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;
  final bool showSelectionControl;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        media.name,
                        style:
                            Theme.of(context).textTheme.titleMedium?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                      ),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          if (showSelectionControl)
                            FilterChip(
                              label: const Text('변환 대상'),
                              selected: selected,
                              onSelected: onSelectedChanged,
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(media.outputFormat),
            const SizedBox(height: 8),
            Text(
              media.llmSkill,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Text(
              media.tuning.summary(),
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                  ),
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                IconButton(
                  tooltip: '복제',
                  icon: const Icon(Icons.copy_all_outlined),
                  onPressed: onDuplicate,
                ),
                IconButton(
                  tooltip: '편집',
                  icon: const Icon(Icons.edit_outlined),
                  onPressed: onEdit,
                ),
                IconButton(
                  tooltip: '삭제',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: onDelete,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
