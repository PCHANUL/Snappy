const defaultAnthropicModel = 'claude-sonnet-4-20250514';
const defaultAnthropicModelAlias = 'claude-sonnet-4-0';

const supportedAnthropicModelIds = {
  'claude-opus-4-1-20250805',
  'claude-opus-4-20250514',
  'claude-opus-4-0',
  'claude-sonnet-4-20250514',
  'claude-sonnet-4-0',
  'claude-3-7-sonnet-20250219',
  'claude-3-7-sonnet-latest',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-latest',
  'claude-3-5-haiku-20241022',
  'claude-3-5-haiku-latest',
  'claude-3-haiku-20240307',
};

const anthropicModelOptions = [
  AnthropicModelOption(
    label: 'Claude Sonnet 4',
    id: 'claude-sonnet-4-20250514',
    description: '균형 잡힌 기본 모델',
  ),
  AnthropicModelOption(
    label: 'Claude Opus 4.1',
    id: 'claude-opus-4-1-20250805',
    description: '가장 강한 품질, 비용과 지연 증가',
  ),
  AnthropicModelOption(
    label: 'Claude Opus 4',
    id: 'claude-opus-4-20250514',
    description: '복잡한 추론과 긴 작업',
  ),
  AnthropicModelOption(
    label: 'Claude Sonnet 3.7',
    id: 'claude-3-7-sonnet-20250219',
    description: '이전 세대 고성능 모델',
  ),
  AnthropicModelOption(
    label: 'Claude Haiku 3.5',
    id: 'claude-3-5-haiku-20241022',
    description: '빠르고 저렴한 모델',
  ),
];

class AnthropicModelOption {
  const AnthropicModelOption({
    required this.label,
    required this.id,
    required this.description,
  });

  final String label;
  final String id;
  final String description;
}
