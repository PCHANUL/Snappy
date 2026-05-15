import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/state.dart';
import '../../shared/widgets/async_state_view.dart';

class ResultScreen extends ConsumerWidget {
  const ResultScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncState = ref.watch(snappyControllerProvider);

    return AsyncStateView(
      value: asyncState,
      data: (appState) {
        final result = appState.currentResult;

        if (result == null) {
          return Scaffold(
            appBar: AppBar(title: const Text('결과')),
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.article_outlined, size: 48),
                    const SizedBox(height: 16),
                    const Text('아직 생성된 결과가 없습니다.'),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () => context.go('/home'),
                      child: const Text('입력 화면으로 이동'),
                    ),
                  ],
                ),
              ),
            ),
          );
        }

        final mediaResults = result.results.values.toList(growable: false);

        if (mediaResults.isEmpty) {
          return Scaffold(
            appBar: AppBar(title: const Text('결과')),
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline, size: 48),
                    const SizedBox(height: 16),
                    const Text('선택된 매체 결과가 없습니다.'),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: () => context.go('/home'),
                      child: const Text('입력 화면으로 이동'),
                    ),
                  ],
                ),
              ),
            ),
          );
        }

        return DefaultTabController(
          length: mediaResults.length,
          child: Scaffold(
            appBar: AppBar(
              title: const Text('결과'),
              actions: [
                IconButton(
                  tooltip: '전체 다시 생성',
                  icon: appState.isConverting
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.refresh),
                  onPressed: appState.isConverting
                      ? null
                      : () => ref
                          .read(snappyControllerProvider.notifier)
                          .regenerateCurrentResult(),
                ),
              ],
              bottom: TabBar(
                isScrollable: true,
                tabs: [
                  for (final mediaResult in mediaResults)
                    Tab(text: mediaResult.mediaName),
                ],
              ),
            ),
            body: TabBarView(
              children: [
                for (final mediaResult in mediaResults)
                  ListView(
                    padding: const EdgeInsets.all(20),
                    children: [
                      if (mediaResult.error != null)
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  mediaResult.error!,
                                  style: TextStyle(
                                    color: Theme.of(context).colorScheme.error,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                if (mediaResult.metadata
                                    case final metadata?) ...[
                                  const SizedBox(height: 12),
                                  if (metadata['apiMessage'] is String)
                                    Text(metadata['apiMessage'] as String),
                                  if (metadata['statusCode'] != null ||
                                      metadata['errorCode'] != null)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 8),
                                      child: Text(
                                        [
                                          if (metadata['statusCode'] != null)
                                            'status ${metadata['statusCode']}',
                                          if (metadata['errorCode'] != null)
                                            metadata['errorCode'] as String,
                                        ].join(' / '),
                                        style: Theme.of(
                                          context,
                                        ).textTheme.bodySmall,
                                      ),
                                    ),
                                ],
                              ],
                            ),
                          ),
                        )
                      else if ((mediaResult.text ?? '').trim().isEmpty)
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Text(
                              '응답은 성공했지만 표시할 텍스트가 없습니다.',
                              style: TextStyle(
                                color: Theme.of(context).colorScheme.error,
                              ),
                            ),
                          ),
                        )
                      else
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: MarkdownBody(data: mediaResult.text ?? ''),
                          ),
                        ),
                      const SizedBox(height: 16),
                      FilledButton.icon(
                        icon: const Icon(Icons.copy),
                        label: const Text('복사'),
                        onPressed: mediaResult.text == null
                            ? null
                            : () async {
                                await Clipboard.setData(
                                  ClipboardData(text: mediaResult.text!),
                                );
                                if (!context.mounted) {
                                  return;
                                }
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('복사했습니다.')),
                                );
                              },
                      ),
                    ],
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}
