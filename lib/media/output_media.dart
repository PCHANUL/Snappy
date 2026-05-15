enum SentenceLength {
  short('짧게'),
  normal('보통'),
  long('길게');

  const SentenceLength(this.label);

  final String label;
}

enum EmojiLevel {
  none('없음'),
  low('적게'),
  normal('보통'),
  high('많이');

  const EmojiLevel(this.label);

  final String label;
}

enum CtaLevel {
  none('없음'),
  soft('약하게'),
  strong('강하게');

  const CtaLevel(this.label);

  final String label;
}

class MediaTuning {
  const MediaTuning({
    this.sentenceLength = SentenceLength.normal,
    this.emojiLevel = EmojiLevel.normal,
    this.ctaLevel = CtaLevel.soft,
    this.hashtagCount = 0,
    this.bannedPhrases = '',
    this.requiredElements = '',
    this.styleNote = '',
  });

  final SentenceLength sentenceLength;
  final EmojiLevel emojiLevel;
  final CtaLevel ctaLevel;
  final int hashtagCount;
  final String bannedPhrases;
  final String requiredElements;
  final String styleNote;

  MediaTuning copyWith({
    SentenceLength? sentenceLength,
    EmojiLevel? emojiLevel,
    CtaLevel? ctaLevel,
    int? hashtagCount,
    String? bannedPhrases,
    String? requiredElements,
    String? styleNote,
  }) {
    return MediaTuning(
      sentenceLength: sentenceLength ?? this.sentenceLength,
      emojiLevel: emojiLevel ?? this.emojiLevel,
      ctaLevel: ctaLevel ?? this.ctaLevel,
      hashtagCount: hashtagCount ?? this.hashtagCount,
      bannedPhrases: bannedPhrases ?? this.bannedPhrases,
      requiredElements: requiredElements ?? this.requiredElements,
      styleNote: styleNote ?? this.styleNote,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'sentenceLength': sentenceLength.name,
      'emojiLevel': emojiLevel.name,
      'ctaLevel': ctaLevel.name,
      'hashtagCount': hashtagCount,
      'bannedPhrases': bannedPhrases,
      'requiredElements': requiredElements,
      'styleNote': styleNote,
    };
  }

  factory MediaTuning.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return const MediaTuning();
    }

    return MediaTuning(
      sentenceLength: _enumByName(
        SentenceLength.values,
        json['sentenceLength'] as String?,
        SentenceLength.normal,
      ),
      emojiLevel: _enumByName(
        EmojiLevel.values,
        json['emojiLevel'] as String?,
        EmojiLevel.normal,
      ),
      ctaLevel: _enumByName(
        CtaLevel.values,
        json['ctaLevel'] as String?,
        CtaLevel.soft,
      ),
      hashtagCount: json['hashtagCount'] as int? ?? 0,
      bannedPhrases: json['bannedPhrases'] as String? ?? '',
      requiredElements: json['requiredElements'] as String? ?? '',
      styleNote: json['styleNote'] as String? ?? '',
    );
  }

  String summary() {
    final parts = [
      '문장 ${sentenceLength.label}',
      '이모지 ${emojiLevel.label}',
      'CTA ${ctaLevel.label}',
      if (hashtagCount > 0) '해시태그 $hashtagCount개',
      if (bannedPhrases.trim().isNotEmpty) '금지 표현 있음',
      if (requiredElements.trim().isNotEmpty) '필수 요소 있음',
    ];

    return parts.join(' · ');
  }
}

class OutputMediaDefinition {
  const OutputMediaDefinition({
    required this.id,
    required this.name,
    required this.outputFormat,
    required this.llmSkill,
    this.tuning = const MediaTuning(),
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String name;
  final String outputFormat;
  final String llmSkill;
  final MediaTuning tuning;
  final DateTime createdAt;
  final DateTime updatedAt;

  OutputMediaDefinition copyWith({
    String? id,
    String? name,
    String? outputFormat,
    String? llmSkill,
    MediaTuning? tuning,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return OutputMediaDefinition(
      id: id ?? this.id,
      name: name ?? this.name,
      outputFormat: outputFormat ?? this.outputFormat,
      llmSkill: llmSkill ?? this.llmSkill,
      tuning: tuning ?? this.tuning,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'outputFormat': outputFormat,
      'llmSkill': llmSkill,
      'tuning': tuning.toJson(),
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }

  factory OutputMediaDefinition.fromJson(Map<String, dynamic> json) {
    return OutputMediaDefinition(
      id: json['id'] as String,
      name: json['name'] as String,
      outputFormat: json['outputFormat'] as String,
      llmSkill: json['llmSkill'] as String,
      tuning: MediaTuning.fromJson(json['tuning'] as Map<String, dynamic>?),
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }
}

T _enumByName<T extends Enum>(List<T> values, String? name, T fallback) {
  for (final value in values) {
    if (value.name == name) {
      return value;
    }
  }
  return fallback;
}
