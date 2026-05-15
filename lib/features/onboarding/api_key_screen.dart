import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/state.dart';

class ApiKeyScreen extends ConsumerStatefulWidget {
  const ApiKeyScreen({super.key});

  @override
  ConsumerState<ApiKeyScreen> createState() => _ApiKeyScreenState();
}

class _ApiKeyScreenState extends ConsumerState<ApiKeyScreen> {
  final _controller = TextEditingController();
  bool _saving = false;
  bool _obscure = true;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final asyncState = ref.watch(snappyControllerProvider);
    final errorMessage = asyncState.asData?.value.errorMessage;

    return Scaffold(
      appBar: AppBar(title: const Text('API 키 입력')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'Anthropic API 키',
            style: Theme.of(
              context,
            ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          Text(
            'Snappy는 사용자의 키로 Claude를 호출합니다. 키는 이 디바이스 보안 저장소에만 보관됩니다.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 24),
          TextField(
            controller: _controller,
            obscureText: _obscure,
            decoration: InputDecoration(
              labelText: 'Anthropic API 키',
              prefixIcon: const Icon(Icons.key),
              suffixIcon: IconButton(
                tooltip: _obscure ? '키 보기' : '키 숨기기',
                icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off),
                onPressed: () => setState(() => _obscure = !_obscure),
              ),
            ),
            textInputAction: TextInputAction.done,
            onSubmitted: (_) => _saveKey(),
          ),
          if (errorMessage != null) ...[
            const SizedBox(height: 12),
            Text(
              errorMessage,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: 20),
          FilledButton.icon(
            icon: _saving
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.verified_user),
            label: const Text('검증 후 저장'),
            onPressed: _saving ? null : _saveKey,
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            icon: const Icon(Icons.open_in_new),
            label: const Text('Anthropic 콘솔 열기'),
            onPressed: () => launchUrl(
              Uri.parse('https://console.anthropic.com/settings/keys'),
              mode: LaunchMode.externalApplication,
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _saveKey() async {
    setState(() => _saving = true);
    final saved = await ref
        .read(snappyControllerProvider.notifier)
        .validateAndSaveApiKey(_controller.text);
    if (!mounted) {
      return;
    }
    setState(() => _saving = false);
    if (saved) {
      context.go('/home');
    }
  }
}
