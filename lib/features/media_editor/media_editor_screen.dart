import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/state.dart';
import '../../media/output_media.dart';
import '../../shared/widgets/async_state_view.dart';

class MediaEditorScreen extends ConsumerStatefulWidget {
  const MediaEditorScreen({this.mediaId, this.returnTo, super.key});

  final String? mediaId;
  final String? returnTo;

  @override
  ConsumerState<MediaEditorScreen> createState() => _MediaEditorScreenState();
}

class _MediaEditorScreenState extends ConsumerState<MediaEditorScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _formatController = TextEditingController();
  final _skillController = TextEditingController();
  final _hashtagCountController = TextEditingController();
  final _bannedPhrasesController = TextEditingController();
  final _requiredElementsController = TextEditingController();
  final _styleNoteController = TextEditingController();
  SentenceLength _sentenceLength = SentenceLength.normal;
  EmojiLevel _emojiLevel = EmojiLevel.normal;
  CtaLevel _ctaLevel = CtaLevel.soft;
  bool _initialized = false;

  @override
  void dispose() {
    _nameController.dispose();
    _formatController.dispose();
    _skillController.dispose();
    _hashtagCountController.dispose();
    _bannedPhrasesController.dispose();
    _requiredElementsController.dispose();
    _styleNoteController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final asyncState = ref.watch(snappyControllerProvider);

    return AsyncStateView(
      value: asyncState,
      data: (appState) {
        final existingMedia = widget.mediaId == null
            ? null
            : appState.settings.mediaDefinitions
                .where((media) => media.id == widget.mediaId)
                .firstOrNull;

        _initialize(existingMedia);

        return Scaffold(
          appBar: AppBar(title: Text(existingMedia == null ? '새 매체' : '매체 편집')),
          body: Form(
            key: _formKey,
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                TextFormField(
                  controller: _nameController,
                  decoration: const InputDecoration(
                    labelText: '매체 이름',
                    hintText: '예: 동네 커뮤니티',
                  ),
                  validator: _requiredValidator,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _formatController,
                  minLines: 3,
                  maxLines: 6,
                  decoration: const InputDecoration(
                    labelText: '출력 형식',
                    hintText: '예: 제목 + 짧은 본문 + 댓글 유도 문장',
                    alignLabelWithHint: true,
                  ),
                  validator: _requiredValidator,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _skillController,
                  minLines: 5,
                  maxLines: 10,
                  decoration: const InputDecoration(
                    labelText: 'LLM 스킬',
                    hintText: '예: 지역 주민에게 말하듯 자연스럽게 작성하고 과장 표현은 피한다.',
                    alignLabelWithHint: true,
                  ),
                  validator: _requiredValidator,
                ),
                const SizedBox(height: 16),
                Text(
                  '미세 조정',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<SentenceLength>(
                  initialValue: _sentenceLength,
                  decoration: const InputDecoration(
                    labelText: '문장 길이',
                    prefixIcon: Icon(Icons.short_text_outlined),
                  ),
                  items: [
                    for (final value in SentenceLength.values)
                      DropdownMenuItem(value: value, child: Text(value.label)),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => _sentenceLength = value);
                    }
                  },
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<EmojiLevel>(
                  initialValue: _emojiLevel,
                  decoration: const InputDecoration(
                    labelText: '이모지 사용',
                    prefixIcon: Icon(Icons.mood_outlined),
                  ),
                  items: [
                    for (final value in EmojiLevel.values)
                      DropdownMenuItem(value: value, child: Text(value.label)),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => _emojiLevel = value);
                    }
                  },
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<CtaLevel>(
                  initialValue: _ctaLevel,
                  decoration: const InputDecoration(
                    labelText: 'CTA',
                    prefixIcon: Icon(Icons.ads_click_outlined),
                  ),
                  items: [
                    for (final value in CtaLevel.values)
                      DropdownMenuItem(value: value, child: Text(value.label)),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => _ctaLevel = value);
                    }
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _hashtagCountController,
                  decoration: const InputDecoration(
                    labelText: '해시태그 개수',
                    hintText: '예: 10',
                    prefixIcon: Icon(Icons.tag_outlined),
                  ),
                  keyboardType: TextInputType.number,
                  validator: _hashtagValidator,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _bannedPhrasesController,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: '금지 표현',
                    hintText: '예: 무조건, 대박, 역대급',
                    alignLabelWithHint: true,
                  ),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _requiredElementsController,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    labelText: '필수 요소',
                    hintText: '예: 가격, 일정, 링크 안내',
                    alignLabelWithHint: true,
                  ),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _styleNoteController,
                  minLines: 3,
                  maxLines: 6,
                  decoration: const InputDecoration(
                    labelText: '문체 메모',
                    hintText: '예: 담백하게 쓰고 홍보 문구처럼 보이지 않게 한다.',
                    alignLabelWithHint: true,
                  ),
                ),
                const SizedBox(height: 24),
                FilledButton.icon(
                  icon: const Icon(Icons.save_outlined),
                  label: const Text('저장'),
                  onPressed: () async {
                    if (!_formKey.currentState!.validate()) {
                      return;
                    }

                    await ref.read(snappyControllerProvider.notifier).saveMedia(
                          id: existingMedia?.id,
                          name: _nameController.text.trim(),
                          outputFormat: _formatController.text.trim(),
                          llmSkill: _skillController.text.trim(),
                          tuning: MediaTuning(
                            sentenceLength: _sentenceLength,
                            emojiLevel: _emojiLevel,
                            ctaLevel: _ctaLevel,
                            hashtagCount:
                                int.parse(_hashtagCountController.text.trim()),
                            bannedPhrases: _bannedPhrasesController.text.trim(),
                            requiredElements:
                                _requiredElementsController.text.trim(),
                            styleNote: _styleNoteController.text.trim(),
                          ),
                        );

                    if (context.mounted) {
                      context.go(widget.returnTo ?? '/media');
                    }
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _initialize(OutputMediaDefinition? existingMedia) {
    if (_initialized) {
      return;
    }
    _initialized = true;

    _nameController.text = existingMedia?.name ?? '';
    _formatController.text = existingMedia?.outputFormat ?? '';
    _skillController.text = existingMedia?.llmSkill ?? '';
    final tuning = existingMedia?.tuning ?? const MediaTuning();
    _sentenceLength = tuning.sentenceLength;
    _emojiLevel = tuning.emojiLevel;
    _ctaLevel = tuning.ctaLevel;
    _hashtagCountController.text = tuning.hashtagCount.toString();
    _bannedPhrasesController.text = tuning.bannedPhrases;
    _requiredElementsController.text = tuning.requiredElements;
    _styleNoteController.text = tuning.styleNote;
  }

  String? _requiredValidator(String? value) {
    if (value == null || value.trim().isEmpty) {
      return '필수 입력값입니다.';
    }
    return null;
  }

  String? _hashtagValidator(String? value) {
    final trimmedValue = value?.trim() ?? '';
    final count = int.tryParse(trimmedValue);
    if (count == null) {
      return '숫자를 입력하세요.';
    }
    if (count < 0 || count > 50) {
      return '0에서 50 사이로 입력하세요.';
    }
    return null;
  }
}

extension _IterableFirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
