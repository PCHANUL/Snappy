import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureStorageService {
  SecureStorageService({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  static const _apiKeyKey = 'snappy.anthropicApiKey';

  final FlutterSecureStorage _storage;

  Future<String?> readApiKey() {
    return _storage.read(key: _apiKeyKey);
  }

  Future<bool> hasApiKey() async {
    final apiKey = await readApiKey();
    return apiKey != null && apiKey.isNotEmpty;
  }

  Future<void> saveApiKey(String apiKey) {
    return _storage.write(key: _apiKeyKey, value: apiKey);
  }

  Future<void> clearApiKey() {
    return _storage.delete(key: _apiKeyKey);
  }
}
