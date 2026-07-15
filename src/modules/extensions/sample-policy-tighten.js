export const id = 'sample-policy-tighten';
export const meta = {
  version: '1.0.0',
  source: 'bundled',
  description: 'Example extension: require delegate role for petitions to demonstrate extensibility.',
  docs: 'Enable with CIRCLE_EXTENSIONS=sample-policy-tighten',
};

export function extendActionRules(rules) {
  return {
    ...rules,
    petition: {
      ...rules.petition,
      minRole: 'delegate',
    },
  };
}
