import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/home/home_screen.dart';
import '../features/media_editor/media_editor_screen.dart';
import '../features/media_list/media_list_screen.dart';
import '../features/onboarding/api_key_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/result/result_screen.dart';
import '../features/settings/settings_screen.dart';
import '../shared/models/app_state.dart';
import 'state.dart';

final routerNotifierProvider = Provider<RouterNotifier>(
  (ref) => RouterNotifier(ref),
);

final routerProvider = Provider<GoRouter>((ref) {
  final routerNotifier = ref.watch(routerNotifierProvider);

  return GoRouter(
    initialLocation: '/home',
    refreshListenable: routerNotifier,
    redirect: routerNotifier.redirect,
    routes: [
      GoRoute(path: '/', redirect: (_, __) => '/home'),
      GoRoute(
        path: '/onboarding',
        builder: (_, __) => const OnboardingScreen(),
      ),
      GoRoute(path: '/api-key', builder: (_, __) => const ApiKeyScreen()),
      GoRoute(path: '/home', builder: (_, __) => const HomeScreen()),
      GoRoute(path: '/result', builder: (_, __) => const ResultScreen()),
      GoRoute(path: '/media', builder: (_, __) => const MediaListScreen()),
      GoRoute(
        path: '/media/new',
        builder: (_, state) => MediaEditorScreen(
          returnTo: state.uri.queryParameters['returnTo'],
        ),
      ),
      GoRoute(
        path: '/media/edit/:mediaId',
        builder: (_, state) => MediaEditorScreen(
          mediaId: state.pathParameters['mediaId'],
          returnTo: state.uri.queryParameters['returnTo'],
        ),
      ),
      GoRoute(path: '/settings', builder: (_, __) => const SettingsScreen()),
    ],
  );
});

class RouterNotifier extends ChangeNotifier {
  RouterNotifier(this._ref) {
    _subscription = _ref.listen<AsyncValue<AppState>>(
      snappyControllerProvider,
      (_, __) => notifyListeners(),
    );
  }

  final Ref _ref;
  late final ProviderSubscription<AsyncValue<AppState>> _subscription;

  String? redirect(BuildContext context, GoRouterState routerState) {
    final appState = _ref.read(snappyControllerProvider).asData?.value;
    if (appState == null) {
      return null;
    }

    final path = routerState.uri.path;
    final isSetupRoute = path == '/onboarding' || path == '/api-key';

    if (!appState.settings.onboardingDone) {
      return path == '/onboarding' ? null : '/onboarding';
    }

    if (!appState.hasApiKey) {
      return path == '/api-key' ? null : '/api-key';
    }

    if (isSetupRoute) {
      return '/home';
    }

    return null;
  }

  @override
  void dispose() {
    _subscription.close();
    super.dispose();
  }
}
