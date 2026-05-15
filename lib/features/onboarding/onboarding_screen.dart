import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/state.dart';

class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final _pageController = PageController();
  int _pageIndex = 0;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const pages = [
      _OnboardingPage(
        icon: Icons.auto_awesome,
        title: '하나의 원본을 여러 매체로',
        body: '텍스트와 이미지를 입력하면 선택한 매체 정의에 맞춰 결과를 동시에 생성합니다.',
      ),
      _OnboardingPage(
        icon: Icons.tune,
        title: '매체 규칙을 저장',
        body: '인스타그램, 블로그, 뉴스레터처럼 반복해서 쓰는 출력 형식을 직접 관리합니다.',
      ),
      _OnboardingPage(
        icon: Icons.key,
        title: 'Anthropic BYOK',
        body: '사용자 API 키는 디바이스 보안 저장소에만 저장하고 서버를 거치지 않습니다.',
      ),
    ];

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              Expanded(
                child: PageView(
                  controller: _pageController,
                  onPageChanged: (index) => setState(() => _pageIndex = index),
                  children: pages,
                ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var index = 0; index < pages.length; index++)
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      width: _pageIndex == index ? 24 : 8,
                      height: 8,
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      decoration: BoxDecoration(
                        color: _pageIndex == index
                            ? Theme.of(context).colorScheme.primary
                            : Theme.of(context).colorScheme.outlineVariant,
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                icon: Icon(
                  _pageIndex == pages.length - 1
                      ? Icons.arrow_forward
                      : Icons.chevron_right,
                ),
                label: Text(_pageIndex == pages.length - 1 ? 'API 키 입력' : '다음'),
                onPressed: () async {
                  if (_pageIndex < pages.length - 1) {
                    await _pageController.nextPage(
                      duration: const Duration(milliseconds: 220),
                      curve: Curves.easeOut,
                    );
                    return;
                  }

                  await ref
                      .read(snappyControllerProvider.notifier)
                      .completeOnboarding();

                  if (context.mounted) {
                    context.go('/api-key');
                  }
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _OnboardingPage extends StatelessWidget {
  const _OnboardingPage({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;

    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 56, color: Theme.of(context).colorScheme.primary),
        const SizedBox(height: 32),
        Text(
          title,
          style: textTheme.headlineMedium?.copyWith(
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 16),
        Text(body, style: textTheme.bodyLarge?.copyWith(height: 1.5)),
      ],
    );
  }
}
