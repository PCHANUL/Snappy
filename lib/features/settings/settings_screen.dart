import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/state.dart';
import '../../core/llm/anthropic_models.dart';
import '../../shared/widgets/async_state_view.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _modelController = TextEditingController();
  String? _loadedModel;

  @override
  void dispose() {
    _modelController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final asyncState = ref.watch(snappyControllerProvider);

    return AsyncStateView(
      value: asyncState,
      data: (appState) {
        _syncModelController(appState.settings.anthropicModel);
        final selectedPresetModel = anthropicModelOptions.any(
          (option) => option.id == appState.settings.anthropicModel,
        )
            ? appState.settings.anthropicModel
            : null;

        return Scaffold(
          appBar: AppBar(title: const Text('설정')),
          body: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Card(
                child: ListTile(
                  leading: const Icon(Icons.key_outlined),
                  title: const Text('Anthropic API 키'),
                  subtitle: Text(appState.hasApiKey ? '저장됨' : '입력 필요'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.go('/api-key'),
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.layers_outlined),
                  title: const Text('매체 관리'),
                  subtitle: Text(
                    '${appState.settings.mediaDefinitions.length}개',
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.go('/media'),
                ),
              ),
              const SizedBox(height: 12),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      DropdownButtonFormField<String>(
                        initialValue: selectedPresetModel,
                        decoration: const InputDecoration(
                          labelText: 'Claude 모델',
                          prefixIcon: Icon(Icons.memory_outlined),
                        ),
                        hint: const Text('모델 프리셋 선택'),
                        items: [
                          for (final model in anthropicModelOptions)
                            DropdownMenuItem(
                              value: model.id,
                              child: Text(model.label),
                            ),
                        ],
                        onChanged: (value) {
                          if (value == null) {
                            return;
                          }
                          _modelController.text = value;
                          ref
                              .read(snappyControllerProvider.notifier)
                              .updateAnthropicModel(value);
                        },
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _modelController,
                        decoration: const InputDecoration(
                          labelText: '모델 ID',
                          prefixIcon: Icon(Icons.tag_outlined),
                          hintText: defaultAnthropicModel,
                        ),
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: _saveModel,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '권장 모델: $defaultAnthropicModel\n별칭: $defaultAnthropicModelAlias',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      if (_modelController.text.isNotEmpty &&
                          !supportedAnthropicModelIds.contains(
                            _modelController.text.trim(),
                          )) ...[
                        const SizedBox(height: 8),
                        Text(
                          '현재 입력한 모델 ID는 앱에 등록된 Anthropic 모델 목록에 없습니다. 프리셋 재선택을 권장합니다.',
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ],
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          TextButton.icon(
                            icon: const Icon(Icons.restart_alt_outlined),
                            label: const Text('기본값 복원'),
                            onPressed: () {
                              _modelController.text = defaultAnthropicModel;
                              _saveModel(defaultAnthropicModel);
                            },
                          ),
                          TextButton.icon(
                            icon: const Icon(Icons.save_outlined),
                            label: const Text('모델 저장'),
                            onPressed: () => _saveModel(_modelController.text),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              if (appState.hasApiKey) ...[
                const SizedBox(height: 24),
                OutlinedButton.icon(
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('API 키 삭제'),
                  onPressed: () =>
                      ref.read(snappyControllerProvider.notifier).clearApiKey(),
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  void _syncModelController(String model) {
    if (_loadedModel == model) {
      return;
    }
    _loadedModel = model;
    _modelController.text = model;
  }

  void _saveModel(String model) {
    ref.read(snappyControllerProvider.notifier).updateAnthropicModel(model);
  }
}
